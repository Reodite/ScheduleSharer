import type { DayCode, MeetingPattern } from '../types';

const DAY_CODES = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
const DATE_RANGE_RE = /^(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})$/;
const TIME_RANGE_RE =
  /^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)$/i;
const BUILDING_RE = /^(.*)\(([A-Z0-9]{2,6})\)$/;

/**
 * A parsed pattern line. Date bounds are carried separately from the
 * MeetingPattern: the schedule parser folds them into the section's
 * termStart/termEnd and then discards them (weekly day+time is all the
 * calendar needs, and dates bloat share links).
 */
export interface ParsedMeeting {
  pattern: MeetingPattern;
  startDate?: string;
  endDate?: string;
}

/** '12:30', 'p.m.' -> 750. Handles noon (12 p.m. -> 720) and midnight (12 a.m. -> 0). */
export function toMinutes(hourStr: string, minStr: string | undefined, meridiem: string): number {
  const h = parseInt(hourStr, 10) % 12;
  const m = minStr ? parseInt(minStr, 10) : 0;
  const pm = /^p/i.test(meridiem);
  return (pm ? h + 12 : h) * 60 + m;
}

/**
 * Parse one Workday Meeting Patterns cell. Cells contain one or MORE pattern
 * lines separated by blank lines (schedules split around reading break), each
 * shaped like:
 *   2027-01-06 - 2027-02-10 | Mon Wed | 9:30 a.m. - 11:00 a.m. | UBCV | Buchanan Building (BUCH) | Floor: 3 | Room: D322
 * Segments are classified by shape, not position, so missing pieces degrade gracefully.
 */
export function parseMeetingPatterns(cell: string): ParsedMeeting[] {
  return cell
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseOnePattern)
    .filter((p): p is ParsedMeeting => p !== null);
}

function parseOnePattern(raw: string): ParsedMeeting | null {
  const pattern: MeetingPattern = {
    days: [],
    startMin: -1,
    endMin: -1,
    raw,
  };
  let startDate: string | undefined;
  let endDate: string | undefined;

  for (const segment of raw.split('|').map((s) => s.trim())) {
    if (!segment) continue;

    const dateMatch = segment.match(DATE_RANGE_RE);
    if (dateMatch) {
      startDate = dateMatch[1];
      endDate = dateMatch[2];
      continue;
    }

    const timeMatch = segment.match(TIME_RANGE_RE);
    if (timeMatch) {
      pattern.startMin = toMinutes(timeMatch[1], timeMatch[2], timeMatch[3]);
      pattern.endMin = toMinutes(timeMatch[4], timeMatch[5], timeMatch[6]);
      continue;
    }

    const tokens = segment.split(/\s+/);
    if (tokens.length > 0 && tokens.every((t) => DAY_CODES.has(t))) {
      pattern.days = tokens as DayCode[];
      continue;
    }

    if (segment.startsWith('Floor:')) {
      pattern.floor = segment.slice('Floor:'.length).trim();
      continue;
    }
    if (segment.startsWith('Room:')) {
      pattern.room = segment.slice('Room:'.length).trim();
      continue;
    }

    const buildingMatch = segment.match(BUILDING_RE);
    if (buildingMatch) {
      pattern.buildingName = buildingMatch[1].trim();
      pattern.buildingCode = buildingMatch[2];
      continue;
    }

    // short all-caps token like 'UBCV' = campus; anything else stays only in `raw`
    if (/^[A-Z]{3,6}$/.test(segment) && !pattern.campus) {
      pattern.campus = segment;
    }
  }

  // A pattern is only renderable with a time and at least one day.
  if (pattern.startMin < 0 || pattern.endMin < 0 || pattern.days.length === 0) return null;
  return { pattern, startDate, endDate };
}
