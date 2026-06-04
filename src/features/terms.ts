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
 * Derive academic terms from the section date ranges present in the group.
 * Buckets by (year, season-of-start): Sep–Dec Fall, Jan–Apr Spring, May–Aug
 * Summer.
 */
export function deriveTerms(people: Person[]): Term[] {
  const buckets = new Map<string, Term>();
  for (const person of people) {
    for (const section of person.schedule?.sections ?? []) {
      const { termStart, termEnd } = section;
      if (!termStart || !termEnd) continue;
      const year = parseInt(termStart.slice(0, 4), 10);
      const month = parseInt(termStart.slice(5, 7), 10);
      const season = seasonOf(month);
      const key = `${year}-${season.name.toLowerCase()}`;
      const existing = buckets.get(key);
      if (existing) {
        if (termStart < existing.start) existing.start = termStart;
        if (termEnd > existing.end) existing.end = termEnd;
      } else {
        buckets.set(key, { key, label: `${season.name} ${year}`, start: termStart, end: termEnd });
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
