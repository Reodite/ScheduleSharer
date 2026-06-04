import type { MeetingPattern, Person, Section } from '../types';
import { dateInRange, dayCodeOf, minutesNow, toISODate } from '../util/time';

export interface ClassRef {
  section: Section;
  pattern: MeetingPattern;
}

export interface NowStatus {
  person: Person;
  /** class in session right now, if any */
  current: ClassRef | null;
  /** next class later today, if any */
  next: ClassRef | null;
}

/**
 * Live status per person. A section only counts if today falls inside its
 * [termStart, termEnd] — so last term's courses don't show as "in class".
 * (Per-meeting dates were dropped for link size, so reading-break gaps
 * within a term are not detected.)
 */
export function whoIsFreeNow(people: Person[], now: Date): NowStatus[] {
  const iso = toISODate(now);
  const day = dayCodeOf(now);
  const nowMin = minutesNow(now);

  const statuses = people
    .filter((p) => p.schedule)
    .map((person) => {
      let current: ClassRef | null = null;
      let next: ClassRef | null = null;
      for (const section of person.schedule!.sections) {
        if (section.termStart && section.termEnd && !dateInRange(iso, section.termStart, section.termEnd)) {
          continue;
        }
        for (const pattern of section.meetings) {
          if (!pattern.days.includes(day)) continue;
          if (nowMin >= pattern.startMin && nowMin < pattern.endMin) {
            if (!current || pattern.endMin < current.pattern.endMin) current = { section, pattern };
          } else if (pattern.startMin > nowMin) {
            if (!next || pattern.startMin < next.pattern.startMin) next = { section, pattern };
          }
        }
      }
      return { person, current, next };
    });

  // free people first, then by soonest class end
  return statuses.sort((a, b) => {
    if (!a.current !== !b.current) return a.current ? 1 : -1;
    if (a.current && b.current) return a.current.pattern.endMin - b.current.pattern.endMin;
    return a.person.handle.localeCompare(b.person.handle);
  });
}
