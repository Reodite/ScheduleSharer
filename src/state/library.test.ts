import { describe, expect, it } from 'vitest';
import { deleteFromLibrary, duplicateInLibrary, importIntoLibrary } from './library';
import type { GroupState, Library, Person } from '../types';
import { MAX_GROUPS, SCHEMA_VERSION } from '../types';

function person(id: string, handle: string, updatedAt = '2026-06-01T00:00:00.000Z'): Person {
  return {
    id,
    handle,
    avatar: { kind: 'initials', initials: handle.slice(0, 2).toUpperCase(), color: '#f4845f' },
    schedule: { sections: [], importedAt: updatedAt },
    updatedAt,
    enabled: true,
  };
}

function group(groupId: string, name: string, people: Person[] = []): GroupState {
  return { schemaVersion: SCHEMA_VERSION, groupId, name, people };
}

function lib(groups: GroupState[], activeId = groups[0].groupId): Library {
  return { activeId, groups };
}

describe('importIntoLibrary', () => {
  it('same groupId -> updates that cached schedule (people merged, name adopted) and activates it', () => {
    const start = lib([group('g1', 'Crew', [person('a', 'alice')]), group('g2', 'Other')], 'g2');
    const incoming = group('g1', 'Crew v2', [person('b', 'bob')]);
    const { lib: next, outcome } = importIntoLibrary(start, incoming);
    expect(outcome).toBe('updated');
    expect(next.groups).toHaveLength(2);
    expect(next.activeId).toBe('g1');
    const g1 = next.groups.find((g) => g.groupId === 'g1')!;
    expect(g1.name).toBe('Crew v2');
    expect(g1.people.map((p) => p.handle).sort()).toEqual(['alice', 'bob']);
  });

  it('unknown groupId -> caches a new schedule and activates it', () => {
    const start = lib([group('g1', 'Crew')]);
    const { lib: next, outcome } = importIntoLibrary(start, group('g9', 'New crew', [person('c', 'casey')]));
    expect(outcome).toBe('added');
    expect(next.groups.map((g) => g.groupId)).toEqual(['g1', 'g9']);
    expect(next.activeId).toBe('g9');
  });

  it('legacy payload without groupId -> merges into the ACTIVE schedule', () => {
    const start = lib([group('g1', 'Crew'), group('g2', 'Other', [person('a', 'alice')])], 'g2');
    const { lib: next, outcome } = importIntoLibrary(start, group('', '', [person('b', 'bob')]));
    expect(outcome).toBe('updated');
    expect(next.groups).toHaveLength(2);
    const g2 = next.groups.find((g) => g.groupId === 'g2')!;
    expect(g2.people.map((p) => p.handle).sort()).toEqual(['alice', 'bob']);
    expect(g2.name).toBe('Other'); // nameless legacy import keeps the local name
  });

  it(`rejects new schedules beyond the cap of ${MAX_GROUPS}`, () => {
    const start = lib(Array.from({ length: MAX_GROUPS }, (_, i) => group(`g${i}`, `Crew ${i}`)));
    const { lib: next, outcome } = importIntoLibrary(start, group('g-new', 'Overflow'));
    expect(outcome).toBe('full');
    expect(next).toBe(start); // unchanged

    // but updates to a KNOWN schedule still work at the cap
    const update = importIntoLibrary(start, group('g3', 'Crew 3 renamed', [person('z', 'zoe')]));
    expect(update.outcome).toBe('updated');
    expect(update.lib.groups.find((g) => g.groupId === 'g3')!.people).toHaveLength(1);
  });
});

describe('duplicateInLibrary', () => {
  it('clones people and data under a fresh groupId, inserts after the source, activates the copy', () => {
    const start = lib([group('g1', 'Crew', [person('a', 'alice'), person('b', 'bob')]), group('g2', 'Other')]);
    const next = duplicateInLibrary(start, 'g1');
    expect(next.groups).toHaveLength(3);
    const copy = next.groups[1]; // right after the source
    expect(copy.groupId).not.toBe('g1');
    expect(copy.name).toBe('Crew (copy)');
    expect(copy.people).toHaveLength(2);
    expect(copy.people.map((p) => p.id)).toEqual(['a', 'b']); // person identity kept
    expect(copy.people[0]).not.toBe(start.groups[0].people[0]); // but not shared objects
    expect(next.activeId).toBe(copy.groupId);
    expect(next.groups[0]).toBe(start.groups[0]); // source untouched
  });

  it('a share-link import into the copy leaves the original alone', () => {
    const start = duplicateInLibrary(lib([group('g1', 'Crew', [person('a', 'alice')])]), 'g1');
    const copyId = start.activeId;
    const incoming = group(copyId, 'Crew (copy)', [person('b', 'bob')]);
    const { lib: next, outcome } = importIntoLibrary(start, incoming);
    expect(outcome).toBe('updated');
    expect(next.groups.find((g) => g.groupId === copyId)!.people).toHaveLength(2);
    expect(next.groups.find((g) => g.groupId === 'g1')!.people).toHaveLength(1);
  });

  it('no-op at the cache cap or for an unknown id', () => {
    const fullLib = lib(Array.from({ length: MAX_GROUPS }, (_, i) => group(`g${i}`, `Crew ${i}`)));
    expect(duplicateInLibrary(fullLib, 'g0')).toBe(fullLib);
    const start = lib([group('g1', 'Crew')]);
    expect(duplicateInLibrary(start, 'nope')).toBe(start);
  });
});

describe('deleteFromLibrary', () => {
  it('removes a schedule; active falls back to the first remaining', () => {
    const start = lib([group('g1', 'A'), group('g2', 'B')], 'g2');
    const next = deleteFromLibrary(start, 'g2');
    expect(next.groups.map((g) => g.groupId)).toEqual(['g1']);
    expect(next.activeId).toBe('g1');
  });

  it('deleting a non-active schedule keeps the active one', () => {
    const start = lib([group('g1', 'A'), group('g2', 'B')], 'g2');
    const next = deleteFromLibrary(start, 'g1');
    expect(next.activeId).toBe('g2');
  });

  it('deleting the last schedule leaves a fresh empty one', () => {
    const next = deleteFromLibrary(lib([group('g1', 'A')]), 'g1');
    expect(next.groups).toHaveLength(1);
    expect(next.groups[0].people).toEqual([]);
    expect(next.groups[0].groupId).not.toBe('g1');
    expect(next.activeId).toBe(next.groups[0].groupId);
  });
});
