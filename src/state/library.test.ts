import { describe, expect, it } from 'vitest';
import {
  createGroupWith,
  deleteFromLibrary,
  duplicateInLibrary,
  importIntoLibrary,
  importPeople,
  importPrivateGroup,
  migrateV2Groups,
  removeFromRoster,
  resolveGroup,
  togglePin,
  upsertPeople,
} from './library';
import type { Group, GroupState, Library, Person } from '../types';
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

/** wire shape: what a share link or JSON import carries */
function wire(groupId: string, name: string, people: Person[] = []): GroupState {
  return { schemaVersion: SCHEMA_VERSION, groupId, name, people };
}

function group(groupId: string, name: string, memberIds: string[] = []): Group {
  return { groupId, name, members: memberIds.map((personId) => ({ personId, enabled: true })) };
}

function lib(groups: Group[], people: Person[] = [], activeId = groups[0].groupId): Library {
  return { activeId, people, groups, pinnedIds: [], meId: null };
}

const OLD = '2026-06-01T00:00:00.000Z';
const NEW = '2026-06-02T00:00:00.000Z';

describe('upsertPeople', () => {
  it('adds unknown people and updates known ones newest-wins', () => {
    const roster = [person('a', 'alice', OLD)];
    const { people } = upsertPeople(roster, [person('a', 'alice-renamed', NEW), person('b', 'bob')]);
    expect(people.map((p) => p.handle)).toEqual(['alice-renamed', 'bob']);
  });

  it('stale incoming does not clobber a newer roster record', () => {
    const { people } = upsertPeople([person('a', 'alice', NEW)], [person('a', 'alice-old', OLD)]);
    expect(people[0].handle).toBe('alice');
  });

  it('matches by handle when ids differ, and keeps the ROSTER id so group refs stay valid', () => {
    const { people, resolvedIds } = upsertPeople([person('a', 'Alice', OLD)], [person('zz9', 'alice', NEW)]);
    expect(people).toHaveLength(1);
    expect(people[0].id).toBe('a'); // roster id survives
    expect(people[0].updatedAt).toBe(NEW); // newest data won
    expect(resolvedIds).toEqual(['a']); // membership must reference the roster id
  });

  it('preserves a local photo when newest-wins picks an image-less link record', () => {
    const local = person('a', 'alice', OLD);
    local.avatar = { kind: 'image', color: '#ff0', imageDataUrl: 'data:image/jpeg;base64,PHOTO' };
    const { people } = upsertPeople([local], [person('a', 'alice', NEW)]);
    expect(people[0].updatedAt).toBe(NEW);
    expect(people[0].avatar.imageDataUrl).toBe('data:image/jpeg;base64,PHOTO');
  });
});

describe('importIntoLibrary', () => {
  it('known groupId -> people into roster, members unioned, name adopted, group activated', () => {
    const start = lib([group('g1', 'Crew', ['a']), group('g2', 'Other')], [person('a', 'alice')], 'g2');
    const { lib: next, outcome } = importIntoLibrary(start, wire('g1', 'Crew v2', [person('b', 'bob')]));
    expect(outcome).toBe('updated');
    expect(next.activeId).toBe('g1');
    expect(next.people.map((p) => p.handle).sort()).toEqual(['alice', 'bob']);
    const g1 = next.groups.find((g) => g.groupId === 'g1')!;
    expect(g1.name).toBe('Crew v2');
    expect(g1.members.map((m) => m.personId).sort()).toEqual(['a', 'b']);
  });

  it('membership enabled preference survives an import', () => {
    const start: Library = {
      activeId: 'g1',
      pinnedIds: [],
      meId: null,
      people: [person('a', 'alice', OLD)],
      groups: [{ groupId: 'g1', name: 'Crew', members: [{ personId: 'a', enabled: false }] }],
    };
    const { lib: next } = importIntoLibrary(start, wire('g1', 'Crew', [person('a', 'alice', NEW)]));
    expect(next.groups[0].members[0].enabled).toBe(false);
  });

  it('unknown groupId -> caches a new group and activates it', () => {
    const start = lib([group('g1', 'Crew')]);
    const { lib: next, outcome } = importIntoLibrary(start, wire('g9', 'New crew', [person('c', 'casey')]));
    expect(outcome).toBe('added');
    expect(next.groups.map((g) => g.groupId)).toEqual(['g1', 'g9']);
    expect(next.activeId).toBe('g9');
    expect(next.groups[1].members.map((m) => m.personId)).toEqual(['c']);
    expect(next.people.map((p) => p.handle)).toEqual(['casey']);
  });

  it('legacy payload without groupId -> members union into the ACTIVE group', () => {
    const start = lib([group('g1', 'Crew'), group('g2', 'Other', ['a'])], [person('a', 'alice')], 'g2');
    const { lib: next, outcome } = importIntoLibrary(start, wire('', '', [person('b', 'bob')]));
    expect(outcome).toBe('updated');
    const g2 = next.groups.find((g) => g.groupId === 'g2')!;
    expect(g2.members.map((m) => m.personId).sort()).toEqual(['a', 'b']);
    expect(g2.name).toBe('Other'); // nameless legacy import keeps the local name
  });

  it(`at the cap of ${MAX_GROUPS}: people still land in the roster, group is not cached`, () => {
    const start = lib(Array.from({ length: MAX_GROUPS }, (_, i) => group(`g${i}`, `Crew ${i}`)));
    const { lib: next, outcome } = importIntoLibrary(start, wire('g-new', 'Overflow', [person('z', 'zoe')]));
    expect(outcome).toBe('full');
    expect(next.groups).toEqual(start.groups); // no new group
    expect(next.people.map((p) => p.handle)).toEqual(['zoe']); // but the person was imported

    // and updates to a KNOWN group still work at the cap
    const update = importIntoLibrary(start, wire('g3', 'Crew 3 renamed', [person('y', 'yuki')]));
    expect(update.outcome).toBe('updated');
    expect(update.lib.groups.find((g) => g.groupId === 'g3')!.members).toHaveLength(1);
  });

  it('a person matched by handle joins the group under their roster id', () => {
    const start = lib([group('g1', 'Crew', ['a'])], [person('a', 'Alice', OLD)]);
    const incoming = wire('g1', 'Crew', [person('zz9', 'alice', NEW)]);
    const { lib: next } = importIntoLibrary(start, incoming);
    expect(next.people).toHaveLength(1);
    expect(next.groups[0].members.map((m) => m.personId)).toEqual(['a']); // no dangling zz9 ref
  });
});

describe('importPeople (profile links)', () => {
  it('feeds the roster and touches no groups', () => {
    const start = lib([group('g1', 'Crew', ['a'])], [person('a', 'alice', OLD)]);
    const next = importPeople(start, [person('a', 'alice', NEW), person('b', 'bob')]);
    expect(next.people.map((p) => p.handle).sort()).toEqual(['alice', 'bob']);
    expect(next.people.find((p) => p.id === 'a')!.updatedAt).toBe(NEW);
    expect(next.groups).toEqual(start.groups);
    expect(next.activeId).toBe(start.activeId);
  });
});

describe('deleteFromLibrary', () => {
  it('removes the group but keeps its people in the roster', () => {
    const start = lib([group('g1', 'A', ['a']), group('g2', 'B', ['a'])], [person('a', 'alice')], 'g2');
    const next = deleteFromLibrary(start, 'g2');
    expect(next.groups.map((g) => g.groupId)).toEqual(['g1']);
    expect(next.activeId).toBe('g1');
    expect(next.people.map((p) => p.handle)).toEqual(['alice']);
  });

  it('deleting the last group leaves a fresh empty one (roster kept)', () => {
    const next = deleteFromLibrary(lib([group('g1', 'A', ['a'])], [person('a', 'alice')]), 'g1');
    expect(next.groups).toHaveLength(1);
    expect(next.groups[0].members).toEqual([]);
    expect(next.groups[0].groupId).not.toBe('g1');
    expect(next.activeId).toBe(next.groups[0].groupId);
    expect(next.people).toHaveLength(1);
  });
});

describe('duplicateInLibrary', () => {
  it('copies member references under a fresh groupId without duplicating people', () => {
    const start = lib([group('g1', 'Crew', ['a', 'b']), group('g2', 'Other')], [person('a', 'alice'), person('b', 'bob')]);
    const next = duplicateInLibrary(start, 'g1');
    expect(next.groups).toHaveLength(3);
    const copy = next.groups[1]; // right after the source
    expect(copy.groupId).not.toBe('g1');
    expect(copy.name).toBe('Crew (copy)');
    expect(copy.members.map((m) => m.personId)).toEqual(['a', 'b']);
    expect(next.activeId).toBe(copy.groupId);
    expect(next.people).toHaveLength(2); // roster untouched
  });

  it('no-op at the cap or for an unknown id', () => {
    const fullLib = lib(Array.from({ length: MAX_GROUPS }, (_, i) => group(`g${i}`, `Crew ${i}`)));
    expect(duplicateInLibrary(fullLib, 'g0')).toBe(fullLib);
    const start = lib([group('g1', 'Crew')]);
    expect(duplicateInLibrary(start, 'nope')).toBe(start);
  });
});

describe('removeFromRoster', () => {
  it('removes the person and strips them from every group, the pin list, and meId', () => {
    const start = {
      ...lib([group('g1', 'A', ['a', 'b']), group('g2', 'B', ['a'])], [person('a', 'alice'), person('b', 'bob')]),
      pinnedIds: ['a'],
      meId: 'a',
    };
    const next = removeFromRoster(start, 'a');
    expect(next.people.map((p) => p.handle)).toEqual(['bob']);
    expect(next.groups[0].members.map((m) => m.personId)).toEqual(['b']);
    expect(next.groups[1].members).toEqual([]);
    expect(next.pinnedIds).toEqual([]);
    expect(next.meId).toBeNull();
    // removing someone else leaves me intact
    const other = removeFromRoster({ ...start }, 'b');
    expect(other.meId).toBe('a');
  });
});

describe('importPrivateGroup (ids-only links)', () => {
  it('unknown groupId -> creates the group with pending members, roster untouched', () => {
    const start = lib([group('g1', 'Crew')], [person('a', 'alice')]);
    const { lib: next, outcome, found, missing } = importPrivateGroup(start, {
      groupId: 'g9',
      name: 'Secret crew',
      personIds: ['a', 'b', 'b'],
    });
    expect(outcome).toBe('added');
    expect(found).toBe(1);
    expect(missing).toBe(1);
    expect(next.people).toEqual(start.people); // no schedule data arrived
    const g9 = next.groups.find((g) => g.groupId === 'g9')!;
    expect(g9.members.map((m) => m.personId)).toEqual(['a', 'b']); // pending 'b' kept
    expect(next.activeId).toBe('g9');
    // only alice resolves until b's profile is imported…
    expect(resolveGroup(next, g9).people.map((p) => p.handle)).toEqual(['alice']);
    // …then the pending member fills in with no group change needed
    const withB = importPeople(next, [person('b', 'bob')]);
    expect(resolveGroup(withB, withB.groups.find((g) => g.groupId === 'g9')!).people.map((p) => p.handle)).toEqual([
      'alice',
      'bob',
    ]);
  });

  it('known groupId -> unions member ids and adopts the name', () => {
    const start = lib([group('g1', 'Crew', ['a'])], [person('a', 'alice')]);
    const { lib: next, outcome } = importPrivateGroup(start, { groupId: 'g1', name: 'Crew v2', personIds: ['a', 'c'] });
    expect(outcome).toBe('updated');
    const g1 = next.groups[0];
    expect(g1.name).toBe('Crew v2');
    expect(g1.members.map((m) => m.personId)).toEqual(['a', 'c']);
  });

  it('at the cap: nothing changes', () => {
    const fullLib = lib(Array.from({ length: MAX_GROUPS }, (_, i) => group(`g${i}`, `Crew ${i}`)));
    const { lib: next, outcome } = importPrivateGroup(fullLib, { groupId: 'g-new', name: 'X', personIds: ['a'] });
    expect(outcome).toBe('full');
    expect(next).toBe(fullLib);
  });
});

describe('createGroupWith', () => {
  it('builds an active schedule from selected roster people, dropping unknowns and dupes', () => {
    const start = lib([group('g1', 'A')], [person('a', 'alice'), person('b', 'bob')]);
    const next = createGroupWith(start, 'Squad', ['a', 'b', 'a', 'ghost']);
    expect(next.groups).toHaveLength(2);
    const squad = next.groups[1];
    expect(squad.name).toBe('Squad');
    expect(squad.members.map((m) => m.personId)).toEqual(['a', 'b']);
    expect(next.activeId).toBe(squad.groupId);
  });

  it('no-op at the group cap', () => {
    const fullLib = lib(Array.from({ length: MAX_GROUPS }, (_, i) => group(`g${i}`, `Crew ${i}`)), [person('a', 'alice')]);
    expect(createGroupWith(fullLib, 'Squad', ['a'])).toBe(fullLib);
  });
});

describe('togglePin', () => {
  it('pins, unpins, and ignores unknown people', () => {
    const start = lib([group('g1', 'A')], [person('a', 'alice')]);
    const pinned = togglePin(start, 'a');
    expect(pinned.pinnedIds).toEqual(['a']);
    expect(togglePin(pinned, 'a').pinnedIds).toEqual([]);
    expect(togglePin(start, 'ghost')).toBe(start);
  });
});

describe('resolveGroup', () => {
  it('embeds roster people with the membership enabled flag; dangling refs skipped', () => {
    const l: Library = {
      activeId: 'g1',
      pinnedIds: [],
      meId: null,
      people: [person('a', 'alice'), person('b', 'bob')],
      groups: [
        {
          groupId: 'g1',
          name: 'Crew',
          members: [
            { personId: 'a', enabled: false },
            { personId: 'b', enabled: true },
            { personId: 'ghost', enabled: true },
          ],
        },
      ],
    };
    const resolved = resolveGroup(l, l.groups[0]);
    expect(resolved.groupId).toBe('g1');
    expect(resolved.people.map((p) => [p.handle, p.enabled])).toEqual([
      ['alice', false],
      ['bob', true],
    ]);
  });
});

describe('migrateV2Groups', () => {
  it('hoists embedded people into one roster record (newest wins) with per-group enabled kept', () => {
    const v2: GroupState[] = [
      { ...wire('g1', 'Crew', [{ ...person('a', 'alice', OLD), enabled: false }, person('b', 'bob')]) },
      { ...wire('g2', 'Other', [person('a', 'alice-renamed', NEW)]) },
    ];
    const migrated = migrateV2Groups(v2, 'g2');
    expect(migrated.activeId).toBe('g2');
    expect(migrated.people).toHaveLength(2); // alice deduped across groups
    expect(migrated.people.find((p) => p.id === 'a')!.handle).toBe('alice-renamed'); // newest won
    const g1 = migrated.groups.find((g) => g.groupId === 'g1')!;
    expect(g1.members.find((m) => m.personId === 'a')!.enabled).toBe(false); // group preference kept
    expect(migrated.groups.find((g) => g.groupId === 'g2')!.members.map((m) => m.personId)).toEqual(['a']);
  });

  it('empty v2 data still yields a usable library', () => {
    const migrated = migrateV2Groups([]);
    expect(migrated.groups).toHaveLength(1);
    expect(migrated.activeId).toBe(migrated.groups[0].groupId);
  });
});
