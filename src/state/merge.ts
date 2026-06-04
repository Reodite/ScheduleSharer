import type { GroupState, Person } from '../types';
import { SCHEMA_VERSION } from '../types';

function normHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

/**
 * Newest-wins pick between a local and an incoming record for the same person,
 * but never lose a locally-stored photo to an image-less link import
 * (links always strip imageDataUrl).
 */
function pickNewest(local: Person, incoming: Person): Person {
  const winner = incoming.updatedAt > local.updatedAt ? incoming : local;
  const result: Person = {
    ...winner,
    // Local-only UI preference survives imports.
    enabled: local.enabled,
  };
  if (!result.avatar.imageDataUrl && local.avatar.imageDataUrl) {
    result.avatar = {
      ...result.avatar,
      kind: 'image',
      imageDataUrl: local.avatar.imageDataUrl,
    };
  }
  return result;
}

/**
 * Merge an incoming GroupState (from a share link or JSON import) into local state.
 * Union of people: match by id first, then by normalized handle; newest updatedAt
 * wins; unmatched incoming people are appended. Never drops a schedule.
 */
export function mergeGroups(local: GroupState, incoming: GroupState): GroupState {
  const people: Person[] = [...local.people];
  const byId = new Map(people.map((p, i) => [p.id, i]));
  const byHandle = new Map(people.map((p, i) => [normHandle(p.handle), i]));

  for (const inc of incoming.people) {
    const idx = byId.get(inc.id) ?? byHandle.get(normHandle(inc.handle));
    if (idx !== undefined) {
      people[idx] = pickNewest(people[idx], inc);
    } else {
      people.push({ ...inc, enabled: true });
      byId.set(inc.id, people.length - 1);
      byHandle.set(normHandle(inc.handle), people.length - 1);
    }
  }

  return { schemaVersion: SCHEMA_VERSION, people };
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
