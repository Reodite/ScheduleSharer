import type { DayCode, MeetingPattern, Person, Section } from '../types';
import { DAY_ORDER } from '../types';
import type { Term } from '../features/terms';

/** One person's presence at one weekly meeting slot. */
export interface BlockInstance {
  day: DayCode;
  startMin: number;
  endMin: number;
  section: Section;
  person: Person;
  pattern: MeetingPattern;
}

/** A rendered calendar block — identical slots across people collapse into one. */
export interface MergedBlock {
  key: string;
  day: DayCode;
  startMin: number;
  endMin: number;
  section: Section;
  people: Person[];
  pattern: MeetingPattern;
  /** distinct rooms for this slot — usually one, but a lab can span two */
  rooms: string[];
  /** column slot within an overlap cluster (different courses colliding) */
  col: number;
  cols: number;
}

function overlapsTerm(section: Section, term: Term | null): boolean {
  if (!term) return true;
  // sections without dates (defensive) always show
  if (!section.termStart || !section.termEnd) return true;
  return section.termStart <= term.end && section.termEnd >= term.start;
}

/** Expand enabled people's schedules into per-day block instances for a term. */
export function expandBlocks(people: Person[], term: Term | null): BlockInstance[] {
  const blocks: BlockInstance[] = [];
  for (const person of people) {
    if (!person.enabled || !person.schedule) continue;
    for (const section of person.schedule.sections) {
      if (!overlapsTerm(section, term)) continue;
      for (const pattern of section.meetings) {
        for (const day of pattern.days) {
          blocks.push({ day, startMin: pattern.startMin, endMin: pattern.endMin, section, person, pattern });
        }
      }
    }
  }
  return blocks;
}

/**
 * Collapse identical (day, section, time) slots into one block listing every
 * participant. Room is deliberately NOT part of the key: when Workday lists a
 * single meeting in two rooms (e.g. a lab spanning C324/C326), that's one time
 * commitment, not two — collapse it and collect the rooms instead of rendering
 * overlapping duplicate blocks.
 */
export function mergeBlocks(instances: BlockInstance[]): MergedBlock[] {
  const groups = new Map<string, MergedBlock>();
  for (const inst of instances) {
    const key = [inst.day, inst.section.id, inst.startMin, inst.endMin].join('|');
    const room = inst.pattern.room ?? '';
    const existing = groups.get(key);
    if (existing) {
      if (!existing.people.some((p) => p.id === inst.person.id)) existing.people.push(inst.person);
      if (room && !existing.rooms.includes(room)) existing.rooms.push(room);
    } else {
      groups.set(key, {
        key,
        day: inst.day,
        startMin: inst.startMin,
        endMin: inst.endMin,
        section: inst.section,
        people: [inst.person],
        pattern: inst.pattern,
        rooms: room ? [room] : [],
        col: 0,
        cols: 1,
      });
    }
  }
  const merged = [...groups.values()];
  for (const block of merged) {
    block.people.sort((a, b) => a.handle.localeCompare(b.handle));
    block.rooms.sort();
  }
  return merged;
}

/**
 * Google-Calendar-style overlap layout: within each day, transitively
 * overlapping blocks form a cluster; each block takes the leftmost free
 * column, and every block in the cluster shares the cluster's column count.
 */
export function layoutDay(blocks: MergedBlock[]): MergedBlock[] {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  let cluster: MergedBlock[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -1;

  const closeCluster = () => {
    for (const b of cluster) b.cols = columnEnds.length;
    cluster = [];
    columnEnds = [];
  };

  for (const block of sorted) {
    if (cluster.length > 0 && block.startMin >= clusterEnd) closeCluster();
    let col = columnEnds.findIndex((end) => end <= block.startMin);
    if (col === -1) {
      col = columnEnds.length;
      columnEnds.push(block.endMin);
    } else {
      columnEnds[col] = block.endMin;
    }
    block.col = col;
    cluster.push(block);
    clusterEnd = Math.max(clusterEnd, block.endMin);
  }
  closeCluster();
  return sorted;
}

export interface CalendarModel {
  /** days to render — Mon–Fri unless weekend meetings exist */
  days: DayCode[];
  /** axis bounds in minutes, padded to the hour */
  dayStartMin: number;
  dayEndMin: number;
  blocksByDay: Map<DayCode, MergedBlock[]>;
}

export function buildCalendar(people: Person[], term: Term | null): CalendarModel {
  const merged = mergeBlocks(expandBlocks(people, term));

  const hasWeekend = merged.some((b) => b.day === 'Sat' || b.day === 'Sun');
  const days = hasWeekend ? DAY_ORDER : DAY_ORDER.slice(0, 5);

  let min = 8 * 60;
  let max = 21 * 60;
  for (const b of merged) {
    if (b.startMin < min) min = Math.floor(b.startMin / 60) * 60;
    if (b.endMin > max) max = Math.ceil(b.endMin / 60) * 60;
  }

  const blocksByDay = new Map<DayCode, MergedBlock[]>();
  for (const day of days) {
    blocksByDay.set(
      day,
      layoutDay(merged.filter((b) => b.day === day)),
    );
  }

  return { days, dayStartMin: min, dayEndMin: max, blocksByDay };
}
