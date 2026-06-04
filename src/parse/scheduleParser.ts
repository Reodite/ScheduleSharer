import type { Schedule, Section } from '../types';
import type { SheetGrid, SheetRow } from './xlsxReader';
import { readXlsx } from './xlsxReader';
import { parseMeetingPatterns } from './meetingParser';
import { computeSectionId } from './sectionId';

const HEADER_LABELS = {
  course: 'Course',
  gradingBasis: 'Grading Basis',
  credits: 'Credits',
  section: 'Section',
  status: 'Section Status',
  component: 'Instructional Format',
  instructor: 'Instructor',
  meetings: 'Meeting Patterns',
} as const;

type HeaderKey = keyof typeof HEADER_LABELS;

/**
 * Find the header row (the one containing both 'Course' and 'Meeting Patterns')
 * and map each header label to its column letter. Workday prepends a 2-row
 * title preamble, so never assume fixed positions.
 */
function findHeader(grid: SheetGrid): { rowNum: number; cols: Partial<Record<HeaderKey, string>> } | null {
  for (const row of grid.rows) {
    const values = Object.entries(row.cells);
    const hasCourse = values.some(([, v]) => v.trim() === HEADER_LABELS.course);
    const hasMeetings = values.some(([, v]) => v.trim() === HEADER_LABELS.meetings);
    if (!hasCourse || !hasMeetings) continue;

    const cols: Partial<Record<HeaderKey, string>> = {};
    for (const [col, v] of values) {
      const label = v.trim();
      for (const [key, expected] of Object.entries(HEADER_LABELS) as [HeaderKey, string][]) {
        if (label === expected) cols[key] = col;
      }
    }
    return { rowNum: row.rowNum, cols };
  }
  return null;
}

function cell(row: SheetRow, col: string | undefined): string {
  return col ? (row.cells[col] ?? '').trim() : '';
}

/** 'CPSC_V 221 - Basic Algorithms and Data Structures' -> [code, title] */
function splitCourse(value: string): [string, string] {
  const idx = value.indexOf(' - ');
  if (idx === -1) return [value, ''];
  return [value.slice(0, idx).trim(), value.slice(idx + 3).trim()];
}

function parseRow(row: SheetRow, cols: Partial<Record<HeaderKey, string>>): Section | null {
  const courseRaw = cell(row, cols.course);
  const meetingsRaw = cols.meetings ? (row.cells[cols.meetings] ?? '') : '';
  if (!courseRaw) return null;

  const [courseCode, courseTitle] = splitCourse(courseRaw);

  // 'CPSC_V 221-L2A - Basic Algorithms...' -> label 'CPSC_V 221-L2A', code 'L2A'
  const sectionRaw = cell(row, cols.section);
  const [sectionLabel] = splitCourse(sectionRaw);
  const sectionCode = sectionLabel.startsWith(`${courseCode}-`)
    ? sectionLabel.slice(courseCode.length + 1)
    : sectionLabel;

  const instructors = cell(row, cols.instructor)
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const creditsRaw = cell(row, cols.credits);
  const credits = creditsRaw ? parseFloat(creditsRaw) : undefined;

  const base = {
    courseCode,
    courseTitle,
    sectionCode,
    sectionLabel,
    component: cell(row, cols.component),
    status: cell(row, cols.status) || undefined,
    credits: Number.isFinite(credits) ? credits : undefined,
    instructors,
    gradingBasis: cell(row, cols.gradingBasis) || undefined,
    meetings: parseMeetingPatterns(meetingsRaw),
  };
  return { ...base, id: computeSectionId(base) };
}

export function parseScheduleGrid(grid: SheetGrid, sourceFileName?: string): Schedule {
  const header = findHeader(grid);
  if (!header) {
    throw new Error(
      'Could not find the schedule table — is this a Workday "View Student Registration Saved Schedule" export?',
    );
  }

  const sections: Section[] = [];
  for (const row of grid.rows) {
    if (row.rowNum <= header.rowNum) continue;
    const section = parseRow(row, header.cols);
    if (section) sections.push(section);
  }

  if (sections.length === 0) {
    throw new Error('No course sections found in this file.');
  }

  return { sections, sourceFileName, importedAt: new Date().toISOString() };
}

export function parseScheduleXlsx(buf: ArrayBuffer, sourceFileName?: string): Schedule {
  return parseScheduleGrid(readXlsx(buf), sourceFileName);
}
