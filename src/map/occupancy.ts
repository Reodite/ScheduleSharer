import type { DayCode, MeetingPattern, Person, Section } from '../types';
import type { Term } from '../features/terms';
import { expandBlocks } from '../calendar/buildCalendar';

/** One person sitting in one class at the probed moment. */
export interface MapAttendee {
  person: Person;
  section: Section;
  pattern: MeetingPattern;
}

export interface CampusOccupancy {
  /** buildingCode -> people in class there, sorted by handle */
  byBuilding: Map<string, MapAttendee[]>;
  /** in class, but the meeting carries no building code (online/TBA) */
  unlocated: MapAttendee[];
  /** people in class anywhere right now (deduped) */
  busyCount: number;
}

/**
 * Who is inside which building at (day, minute)? Term filtering matches the
 * calendar: a section shows if its date range overlaps the selected term.
 * A person double-booked into one building is listed once (soonest-ending
 * class wins — same rule as the "Right now" panel).
 */
export function occupancyAt(
  people: Person[],
  term: Term | null,
  day: DayCode,
  minute: number,
): CampusOccupancy {
  const byBuilding = new Map<string, MapAttendee[]>();
  const unlocated: MapAttendee[] = [];
  const busy = new Set<string>();

  for (const block of expandBlocks(people, term)) {
    if (block.day !== day) continue;
    if (minute < block.startMin || minute >= block.endMin) continue;
    const attendee: MapAttendee = { person: block.person, section: block.section, pattern: block.pattern };
    busy.add(block.person.id);
    const code = block.pattern.buildingCode;
    if (!code) {
      if (!unlocated.some((a) => a.person.id === block.person.id)) unlocated.push(attendee);
      continue;
    }
    const list = byBuilding.get(code);
    if (!list) {
      byBuilding.set(code, [attendee]);
    } else {
      const existing = list.findIndex((a) => a.person.id === block.person.id);
      if (existing === -1) list.push(attendee);
      else if (block.pattern.endMin < list[existing].pattern.endMin) list[existing] = attendee;
    }
  }

  for (const list of byBuilding.values()) {
    list.sort((a, b) => a.person.handle.localeCompare(b.person.handle));
  }
  unlocated.sort((a, b) => a.person.handle.localeCompare(b.person.handle));

  return { byBuilding, unlocated, busyCount: busy.size };
}

/** 'CPSC_V 221' -> 'CPSC 221'; falls back to a clipped title */
export function courseLabel(section: Section): string {
  if (section.courseCode) return section.courseCode.replace(/_V(?=\s)/, '');
  return section.title.length > 26 ? `${section.title.slice(0, 24)}…` : section.title;
}
