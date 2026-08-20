import type { Person } from '../types';

function normHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

/**
 * Display names with a disambiguating suffix when two distinct people ended up
 * with the same handle (we keep both rather than dropping a schedule).
 */
export function displayHandles(people: Person[]): Map<string, string> {
  const counts = new Map<string, number>();
  const result = new Map<string, string>();
  for (const p of people) {
    const key = normHandle(p.handle);
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    result.set(p.id, n === 1 ? p.handle : `${p.handle} (${n})`);
  }
  return result;
}
