import type { GroupState, Library } from '../types';
import { emptyGroup, MAX_GROUPS } from '../types';
import { mergeGroups } from './merge';

export type ImportOutcome = 'updated' | 'added' | 'full';

/**
 * Route an incoming group (share link or JSON import) into the library:
 *  - known groupId  -> merge into that cached schedule and make it active
 *  - no groupId     -> legacy payload: merge into the active schedule
 *  - unknown id     -> cache as a new schedule (active), unless the cache
 *                      is at MAX_GROUPS, in which case nothing changes
 */
export function importIntoLibrary(
  lib: Library,
  incoming: GroupState,
): { lib: Library; outcome: ImportOutcome } {
  const targetId = incoming.groupId && lib.groups.some((g) => g.groupId === incoming.groupId)
    ? incoming.groupId
    : !incoming.groupId
      ? lib.activeId
      : null;

  if (targetId !== null) {
    return {
      lib: {
        activeId: targetId,
        groups: lib.groups.map((g) => (g.groupId === targetId ? mergeGroups(g, incoming) : g)),
      },
      outcome: 'updated',
    };
  }

  if (lib.groups.length >= MAX_GROUPS) return { lib, outcome: 'full' };

  return {
    lib: {
      activeId: incoming.groupId,
      groups: [...lib.groups, { ...incoming, people: incoming.people.map((p) => ({ ...p, enabled: true })) }],
    },
    outcome: 'added',
  };
}

/** Delete a schedule; never leaves the library empty or without an active id. */
export function deleteFromLibrary(lib: Library, groupId: string): Library {
  const groups = lib.groups.filter((g) => g.groupId !== groupId);
  if (groups.length === 0) {
    const fresh = emptyGroup('My schedule');
    return { activeId: fresh.groupId, groups: [fresh] };
  }
  return {
    activeId: lib.activeId === groupId ? groups[0].groupId : lib.activeId,
    groups,
  };
}

export function activeGroup(lib: Library): GroupState {
  return lib.groups.find((g) => g.groupId === lib.activeId) ?? lib.groups[0];
}
