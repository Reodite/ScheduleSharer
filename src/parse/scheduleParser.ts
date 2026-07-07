import type { MeetingPattern, Schedule, Section } from '../types';
import type { SheetGrid, SheetRow } from './xlsxReader';
import { readXlsx } from './xlsxReader';
import { parseMeetingPatterns } from './meetingParser';
import { computeSectionId } from './sectionId';
import { dateFromSerial } from './serialDate';

// Each key maps to the header label(s) that can name that column. Workday has
// two schedule exports: the single-table "View Student Registration Saved
// Schedule" (course column literally 'Course') and the multi-table "View My
// Courses" ('Course Listing', plus a 'Registration Status' column).
const HEADER_LABELS = {
  course: ['Course', 'Course Listing'],
  component: ['Instructional Format'],
  instructor: ['Instructor'],
  startDate: ['Start Date'],
  endDate: ['End Date'],
  meetings: ['Meeting Patterns'],
  registration: ['Registration Status'],
} as const satisfies Record<string, readonly string[]>;

type HeaderKey = keyof typeof HEADER_LABELS;

interface HeaderRow {
  rowNum: number;
  cols: Partial<Record<HeaderKey, string>>;
}

/** Map a row's cells to column letters by header label (leftmost match wins). */
function mapHeaderCols(row: SheetRow): Partial<Record<HeaderKey, string>> {
  const cols: Partial<Record<HeaderKey, string>> = {};
  for (const [col, v] of Object.entries(row.cells)) {
    const label = v.trim();
    for (const key of Object.keys(HEADER_LABELS) as HeaderKey[]) {
      if (cols[key]) continue;
      if ((HEADER_LABELS[key] as readonly string[]).includes(label)) cols[key] = col;
    }
  }
  return cols;
}

/**
 * Find every header row (each containing both a course column and 'Meeting
 * Patterns'). The "Saved Schedule" export has one; "View My Courses" has one
 * per table (Enrolled / Waitlisted / Dropped-Withdrawn), and each table shifts
 * its columns, so a per-table mapping is required — never assume fixed positions.
 */
function findHeaders(grid: SheetGrid): HeaderRow[] {
  const headers: HeaderRow[] = [];
  for (const row of grid.rows) {
    const cols = mapHeaderCols(row);
    if (cols.course && cols.meetings) headers.push({ rowNum: row.rowNum, cols });
  }
  return headers;
}

function cell(row: SheetRow, col: string | undefined): string {
  return col ? (row.cells[col] ?? '').trim() : '';
}

/** 'CPSC_V 221 - Basic Algorithms and Data Structures' -> [code, title] */
function splitCourse(courseCell: string): [string, string] {
  const idx = courseCell.indexOf(' - ');
  if (idx === -1) return ['', courseCell];
  return [courseCell.slice(0, idx).trim(), courseCell.slice(idx + 3).trim()];
}

/** Excel serial cell -> ISO date, if the cell holds a number */
function serialCell(row: SheetRow, col: string | undefined): string | undefined {
  const v = cell(row, col);
  const n = parseFloat(v);
  return v && Number.isFinite(n) ? dateFromSerial(n) : undefined;
}

function meetingKey(m: MeetingPattern): string {
  return [m.days.join(''), m.startMin, m.endMin, m.buildingCode ?? '', m.room ?? '', m.floor ?? ''].join(',');
}

function parseRow(row: SheetRow, cols: Partial<Record<HeaderKey, string>>): Section | null {
  const courseRaw = cell(row, cols.course);
  const meetingsRaw = cols.meetings ? (row.cells[cols.meetings] ?? '') : '';
  if (!courseRaw) return null;

  // "View My Courses" lists Waitlisted and Dropped/Withdrawn courses in their
  // own tables — keep only confirmed enrollments. When a table has no
  // 'Registration Status' column (the old single-table export), keep every row.
  if (cols.registration && cell(row, cols.registration) !== 'Registered') return null;

  const instructors = cell(row, cols.instructor)
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Fold per-pattern date ranges into one section-level range (we keep dates
  // only for term bucketing), then dedupe the date-stripped patterns: a
  // reading-break split collapses back into a single weekly meeting.
  const parsed = parseMeetingPatterns(meetingsRaw);
  let termStart = serialCell(row, cols.startDate);
  let termEnd = serialCell(row, cols.endDate);
  for (const p of parsed) {
    if (p.startDate && (!termStart || p.startDate < termStart)) termStart = p.startDate;
    if (p.endDate && (!termEnd || p.endDate > termEnd)) termEnd = p.endDate;
  }
  const meetings: MeetingPattern[] = [];
  const seen = new Set<string>();
  for (const p of parsed) {
    const key = meetingKey(p.pattern);
    if (seen.has(key)) continue;
    seen.add(key);
    meetings.push(p.pattern);
  }

  const [courseCode, title] = splitCourse(courseRaw);
  const base = {
    courseCode,
    title,
    component: cell(row, cols.component),
    instructors,
    termStart,
    termEnd,
    meetings,
  };
  return { ...base, id: computeSectionId(base) };
}

export function parseScheduleGrid(grid: SheetGrid, sourceFileName?: string): Schedule {
  const headers = findHeaders(grid);
  if (headers.length === 0) {
    throw new Error(
      'Could not find the schedule table — is this a Workday "View My Courses" or "View Student Registration Saved Schedule" export?',
    );
  }

  // Parse each table with its own column mapping; a table's rows run from just
  // after its header to just before the next table's header.
  const sections: Section[] = [];
  for (let i = 0; i < headers.length; i++) {
    const { rowNum, cols } = headers[i];
    const nextRowNum = i + 1 < headers.length ? headers[i + 1].rowNum : Infinity;
    for (const row of grid.rows) {
      if (row.rowNum <= rowNum || row.rowNum >= nextRowNum) continue;
      const section = parseRow(row, cols);
      if (section) sections.push(section);
    }
  }

  if (sections.length === 0) {
    throw new Error('No course sections found in this file.');
  }

  return { sections, sourceFileName, importedAt: new Date().toISOString() };
}

export function parseScheduleXlsx(buf: ArrayBuffer, sourceFileName?: string): Schedule {
  return parseScheduleGrid(readXlsx(buf), sourceFileName);
}
