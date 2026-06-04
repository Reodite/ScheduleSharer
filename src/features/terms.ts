import type { Person } from '../types';

export interface Term {
  key: string; // '2026-fall'
  label: string; // 'Fall 2026'
  start: string; // ISO, min meeting start in bucket
  end: string; // ISO, max meeting end in bucket
}

function seasonOf(month: number): { name: string; order: number } {
  if (month >= 9) return { name: 'Fall', order: 2 };
  if (month >= 5) return { name: 'Summer', order: 1 };
  return { name: 'Spring', order: 0 };
}

/**
 * Derive academic terms from the meeting date ranges present in the group.
 * Buckets by (year, season-of-start): Sep–Dec Fall, Jan–Apr Spring, May–Aug
 * Summer. A reading-break second half (starting in Feb) lands in the same
 * Spring bucket as its first half.
 */
export function deriveTerms(people: Person[]): Term[] {
  const buckets = new Map<string, Term>();
  for (const person of people) {
    for (const section of person.schedule?.sections ?? []) {
      for (const m of section.meetings) {
        if (!m.startDate || !m.endDate) continue;
        const year = parseInt(m.startDate.slice(0, 4), 10);
        const month = parseInt(m.startDate.slice(5, 7), 10);
        const season = seasonOf(month);
        const key = `${year}-${season.name.toLowerCase()}`;
        const existing = buckets.get(key);
        if (existing) {
          if (m.startDate < existing.start) existing.start = m.startDate;
          if (m.endDate > existing.end) existing.end = m.endDate;
        } else {
          buckets.set(key, { key, label: `${season.name} ${year}`, start: m.startDate, end: m.endDate });
        }
      }
    }
  }
  return [...buckets.values()].sort((a, b) => a.start.localeCompare(b.start));
}

/** Term containing today, else the nearest upcoming, else the latest. */
export function defaultTermKey(terms: Term[], todayIso: string): string | null {
  if (terms.length === 0) return null;
  const current = terms.find((t) => todayIso >= t.start && todayIso <= t.end);
  if (current) return current.key;
  const upcoming = terms.find((t) => t.start > todayIso);
  if (upcoming) return upcoming.key;
  return terms[terms.length - 1].key;
}
