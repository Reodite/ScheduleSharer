import type { DayCode } from '../types';
import type { BlockInstance } from '../calendar/buildCalendar';

export interface FreeInterval {
  day: DayCode;
  startMin: number;
  endMin: number;
}

export const FREE_WINDOW_START = 8 * 60;
export const FREE_WINDOW_END = 20 * 60;
export const MIN_FREE_LENGTH = 30;

/**
 * Intervals where EVERY selected person is free: union all busy intervals per
 * day, coalesce overlaps, then take the complement within the working window.
 * Slivers shorter than MIN_FREE_LENGTH are dropped — a 10-minute gap isn't a
 * usable lunch slot.
 */
export function commonFreeIntervals(
  blocks: BlockInstance[],
  days: DayCode[],
  windowStart = FREE_WINDOW_START,
  windowEnd = FREE_WINDOW_END,
  minLength = MIN_FREE_LENGTH,
): FreeInterval[] {
  const free: FreeInterval[] = [];
  for (const day of days) {
    const busy = blocks
      .filter((b) => b.day === day)
      .map((b) => ({ start: b.startMin, end: b.endMin }))
      .sort((a, b) => a.start - b.start);

    // coalesce overlapping/adjacent busy intervals
    const merged: { start: number; end: number }[] = [];
    for (const interval of busy) {
      const last = merged[merged.length - 1];
      if (last && interval.start <= last.end) {
        last.end = Math.max(last.end, interval.end);
      } else {
        merged.push({ ...interval });
      }
    }

    // complement within the window
    let cursor = windowStart;
    for (const interval of merged) {
      if (interval.start > cursor) free.push({ day, startMin: cursor, endMin: Math.min(interval.start, windowEnd) });
      cursor = Math.max(cursor, interval.end);
      if (cursor >= windowEnd) break;
    }
    if (cursor < windowEnd) free.push({ day, startMin: cursor, endMin: windowEnd });
  }
  return free.filter((f) => f.endMin - f.startMin >= minLength && f.endMin > f.startMin);
}
