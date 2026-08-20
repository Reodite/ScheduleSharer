import type { Group, GroupState, Library, Person } from '../types';
import { freshGroup, MAX_GROUPS, SCHEMA_VERSION } from '../types';

export type ImportOutcome = 'updated' | 'added' | 'full';

function normHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

/**
 * Newest-wins pick between a roster record and an incoming one for the same
 * person. The roster id always survives (group members reference it), and a
 * locally-stored photo is never lost to an image-less link import (links
 * always strip imageDataUrl).
 */
function pickNewest(local: Person, incoming: Person): Person {
  const winner = incoming.updatedAt > local.updatedAt ? incoming : local;
  const result: Person = { ...winner, id: local.id, enabled: true };
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
 * Upsert incoming people into the roster: match by id first, then by
 * normalized handle (same friend re-imported from a new device); newest
 * updatedAt wins; unmatched people are appended. Returns the new roster
 * plus, for each incoming person, the roster id their record landed on —
 * group membership must reference THAT id, not the incoming one.
 */
export function upsertPeople(
  roster: Person[],
  incoming: Person[],
): { people: Person[]; resolvedIds: string[] } {
  const people = [...roster];
  const byId = new Map(people.map((p, i) => [p.id, i]));
  const byHandle = new Map(people.map((p, i) => [normHandle(p.handle), i]));
  const resolvedIds: string[] = [];

  for (const inc of incoming) {
    const idx = byId.get(inc.id) ?? byHandle.get(normHandle(inc.handle));
    if (idx !== undefined) {
      people[idx] = pickNewest(people[idx], inc);
      resolvedIds.push(people[idx].id);
    } else {
      people.push({ ...inc, enabled: true });
      byId.set(inc.id, people.length - 1);
      byHandle.set(normHandle(inc.handle), people.length - 1);
      resolvedIds.push(inc.id);
    }
  }
  return { people, resolvedIds };
}

/** Add ids to a group's membership (deduped, enabled); existing members untouched. */
function unionMembers(group: Group, ids: string[]): Group {
  const have = new Set(group.members.map((m) => m.personId));
  const added: string[] = [];
  for (const id of ids) {
    if (have.has(id)) continue;
    have.add(id);
    added.push(id);
  }
  if (added.length === 0) return group;
  return { ...group, members: [...group.members, ...added.map((personId) => ({ personId, enabled: true }))] };
}

/**
 * Route an incoming group payload (share link or JSON import). The PEOPLE
 * always land in the roster, whatever happens to the group:
 *  - known groupId  -> that group adopts the name, members are unioned, it
 *                      becomes active
 *  - no groupId     -> legacy payload: members union into the active group
 *  - unknown id     -> cached as a new (active) group, unless the cache is
 *                      at MAX_GROUPS — then only the roster import happens
 */
export function importIntoLibrary(
  lib: Library,
  incoming: GroupState,
): { lib: Library; outcome: ImportOutcome } {
  const { people, resolvedIds } = upsertPeople(lib.people, incoming.people);

  const targetId = incoming.groupId && lib.groups.some((g) => g.groupId === incoming.groupId)
    ? incoming.groupId
    : !incoming.groupId
      ? lib.activeId
      : null;

  if (targetId !== null) {
    return {
      lib: {
        ...lib,
        activeId: targetId,
        people,
        groups: lib.groups.map((g) =>
          g.groupId === targetId ? { ...unionMembers(g, resolvedIds), name: incoming.name || g.name } : g,
        ),
      },
      outcome: 'updated',
    };
  }

  if (lib.groups.length >= MAX_GROUPS) return { lib: { ...lib, people }, outcome: 'full' };

  const group = unionMembers({ groupId: incoming.groupId, name: incoming.name, members: [] }, resolvedIds);
  return {
    lib: { ...lib, activeId: group.groupId, people, groups: [...lib.groups, group] },
    outcome: 'added',
  };
}

/** Import people only (profile links) — the roster absorbs them, groups are untouched. */
export function importPeople(lib: Library, incoming: Person[]): Library {
  return { ...lib, people: upsertPeople(lib.people, incoming).people };
}

/**
 * Delete a group; its people STAY in the roster (they may be in other
 * groups). Never leaves the library without a group or an active id.
 */
export function deleteFromLibrary(lib: Library, groupId: string): Library {
  const groups = lib.groups.filter((g) => g.groupId !== groupId);
  if (groups.length === 0) {
    const fresh = freshGroup('My schedule');
    return { ...lib, activeId: fresh.groupId, groups: [fresh] };
  }
  return {
    ...lib,
    activeId: lib.activeId === groupId ? groups[0].groupId : lib.activeId,
    groups,
  };
}

/**
 * Clone a group under a fresh groupId — same members, named "<name> (copy)",
 * inserted right after the source and made active. The roster is untouched
 * (members are references). No-op at the cap or for an unknown id.
 */
export function duplicateInLibrary(lib: Library, groupId: string): Library {
  if (lib.groups.length >= MAX_GROUPS) return lib;
  const i = lib.groups.findIndex((g) => g.groupId === groupId);
  if (i === -1) return lib;
  const src = lib.groups[i];
  const copy: Group = {
    groupId: crypto.randomUUID(),
    name: `${src.name || 'Untitled schedule'} (copy)`,
    members: src.members.map((m) => ({ ...m })),
  };
  const groups = [...lib.groups];
  groups.splice(i + 1, 0, copy);
  return { ...lib, activeId: copy.groupId, groups };
}

/** Remove a person from the roster AND from every group referencing them. */
export function removeFromRoster(lib: Library, personId: string): Library {
  return {
    ...lib,
    people: lib.people.filter((p) => p.id !== personId),
    pinnedIds: lib.pinnedIds.filter((id) => id !== personId),
    groups: lib.groups.map((g) =>
      g.members.some((m) => m.personId === personId)
        ? { ...g, members: g.members.filter((m) => m.personId !== personId) }
        : g,
    ),
  };
}

/** Pin/unpin a roster person to the top of the People list. */
export function togglePin(lib: Library, personId: string): Library {
  if (!lib.people.some((p) => p.id === personId)) return lib;
  return {
    ...lib,
    pinnedIds: lib.pinnedIds.includes(personId)
      ? lib.pinnedIds.filter((id) => id !== personId)
      : [...lib.pinnedIds, personId],
  };
}

export function activeGroup(lib: Library): Group {
  return lib.groups.find((g) => g.groupId === lib.activeId) ?? lib.groups[0];
}

/**
 * Materialize a group into the wire shape the calendar, links, and exports
 * consume: roster people embedded, with the membership's enabled flag
 * applied. Dangling references are skipped.
 */
export function resolveGroup(lib: Library, group: Group): GroupState {
  const byId = new Map(lib.people.map((p) => [p.id, p]));
  const people: Person[] = [];
  for (const m of group.members) {
    const p = byId.get(m.personId);
    if (p) people.push({ ...p, enabled: m.enabled });
  }
  return { schemaVersion: SCHEMA_VERSION, groupId: group.groupId, name: group.name, people };
}

/**
 * v2 storage flatten: groups used to embed their people. Hoist everyone into
 * the roster (dedupe by id/handle, newest updatedAt wins) and rewrite groups
 * as member references, keeping each group's per-person enabled preference.
 */
export function migrateV2Groups(oldGroups: GroupState[], activeId?: string): Library {
  let people: Person[] = [];
  const groups: Group[] = [];
  for (const g of oldGroups.slice(0, MAX_GROUPS)) {
    const up = upsertPeople(people, g.people);
    people = up.people;
    const seen = new Set<string>();
    const members: Group['members'] = [];
    up.resolvedIds.forEach((id, i) => {
      if (seen.has(id)) return;
      seen.add(id);
      members.push({ personId: id, enabled: g.people[i].enabled });
    });
    groups.push({ groupId: g.groupId || crypto.randomUUID(), name: g.name, members });
  }
  if (groups.length === 0) {
    const fresh = freshGroup('My schedule');
    return { activeId: fresh.groupId, people, groups: [fresh], pinnedIds: [] };
  }
  const active = activeId && groups.some((g) => g.groupId === activeId) ? activeId : groups[0].groupId;
  return { activeId: active, people, groups, pinnedIds: [] };
}
