import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';
import type { Avatar, Group, GroupState, Library, Person, Schedule } from '../types';
import { freshGroup, MAX_GROUPS } from '../types';
import {
  activeGroup,
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
} from './library';
import type { ImportOutcome } from './library';
import { normalizeGroup, normalizeLibrary } from './normalize';
import { decodePrivateShareHash, decodeProfileHash, decodeShareHash, ShareDecodeError } from './shareLink';
import type { PrivateShare } from './binaryCodec';

const STORAGE_KEY = 'schedulesharer.v3';
const V2_KEY = 'schedulesharer.v2';
const LEGACY_KEY = 'schedulesharer.v1';

export type Action =
  // roster-level actions (the person record everywhere)
  | { type: 'addPerson'; person: Person } // roster + membership in the active schedule
  | { type: 'editPerson'; id: string; handle?: string; avatar?: Avatar }
  | { type: 'replaceSchedule'; id: string; schedule: Schedule }
  | { type: 'removeFromRoster'; personId: string } // also strips them from every group
  | { type: 'togglePin'; personId: string }
  | { type: 'setMe'; personId: string }
  | { type: 'importProfile'; person: Person }
  // membership actions on the ACTIVE schedule
  | { type: 'addToGroup'; personId: string }
  | { type: 'removeFromGroup'; id: string }
  | { type: 'togglePerson'; id: string; enabled: boolean }
  | { type: 'soloPerson'; id: string }
  | { type: 'enableAll' }
  // group-level actions
  | { type: 'switchGroup'; groupId: string }
  | { type: 'renameGroup'; groupId: string; name: string }
  | { type: 'deleteGroup'; groupId: string }
  | { type: 'duplicateGroup'; groupId: string }
  | { type: 'createGroup'; name: string }
  | { type: 'createGroupWithMembers'; name: string; personIds: string[] }
  | { type: 'importPrivateIncoming'; incoming: PrivateShare }
  | { type: 'importIncoming'; incoming: GroupState };

function touch(p: Person): Person {
  return { ...p, updatedAt: new Date().toISOString() };
}

function updateActiveGroup(lib: Library, fn: (g: Group) => Group): Library {
  return { ...lib, groups: lib.groups.map((g) => (g.groupId === lib.activeId ? fn(g) : g)) };
}

function updateRosterPerson(lib: Library, id: string, fn: (p: Person) => Person): Library {
  return { ...lib, people: lib.people.map((p) => (p.id === id ? fn(p) : p)) };
}

function reducer(lib: Library, action: Action): Library {
  switch (action.type) {
    case 'addPerson': {
      const withPerson = {
        ...lib,
        people: [...lib.people, action.person],
        // the first person created on this device is presumed to be its owner
        meId: lib.meId ?? action.person.id,
      };
      return updateActiveGroup(withPerson, (g) => ({
        ...g,
        members: [...g.members, { personId: action.person.id, enabled: true }],
      }));
    }
    case 'editPerson':
      return updateRosterPerson(lib, action.id, (p) =>
        touch({ ...p, handle: action.handle ?? p.handle, avatar: action.avatar ?? p.avatar }),
      );
    case 'replaceSchedule':
      return updateRosterPerson(lib, action.id, (p) => touch({ ...p, schedule: action.schedule }));
    case 'removeFromRoster':
      return removeFromRoster(lib, action.personId);
    case 'togglePin':
      return togglePin(lib, action.personId);
    case 'setMe':
      return lib.people.some((p) => p.id === action.personId) ? { ...lib, meId: action.personId } : lib;
    case 'importProfile':
      return importPeople(lib, [action.person]);

    case 'addToGroup':
      if (!lib.people.some((p) => p.id === action.personId)) return lib;
      return updateActiveGroup(lib, (g) =>
        g.members.some((m) => m.personId === action.personId)
          ? g
          : { ...g, members: [...g.members, { personId: action.personId, enabled: true }] },
      );
    case 'removeFromGroup':
      return updateActiveGroup(lib, (g) => ({
        ...g,
        members: g.members.filter((m) => m.personId !== action.id),
      }));
    case 'togglePerson':
      return updateActiveGroup(lib, (g) => ({
        ...g,
        members: g.members.map((m) => (m.personId === action.id ? { ...m, enabled: action.enabled } : m)),
      }));
    case 'soloPerson':
      return updateActiveGroup(lib, (g) => ({
        ...g,
        members: g.members.map((m) => ({ ...m, enabled: m.personId === action.id })),
      }));
    case 'enableAll':
      return updateActiveGroup(lib, (g) => ({
        ...g,
        members: g.members.map((m) => ({ ...m, enabled: true })),
      }));

    case 'switchGroup':
      return lib.groups.some((g) => g.groupId === action.groupId) ? { ...lib, activeId: action.groupId } : lib;
    case 'renameGroup':
      return {
        ...lib,
        groups: lib.groups.map((g) => (g.groupId === action.groupId ? { ...g, name: action.name } : g)),
      };
    case 'deleteGroup':
      return deleteFromLibrary(lib, action.groupId);
    case 'duplicateGroup':
      return duplicateInLibrary(lib, action.groupId);
    case 'createGroup': {
      if (lib.groups.length >= MAX_GROUPS) return lib;
      const fresh = freshGroup(action.name);
      return { ...lib, activeId: fresh.groupId, groups: [...lib.groups, fresh] };
    }
    case 'createGroupWithMembers':
      return createGroupWith(lib, action.name, action.personIds);
    case 'importIncoming':
      return importIntoLibrary(lib, action.incoming).lib;
    case 'importPrivateIncoming':
      return importPrivateGroup(lib, action.incoming).lib;
  }
}

export interface BootImport {
  outcome?: ImportOutcome;
  groupName?: string;
  importedPeople: string[];
  /** set when the boot hash was a profile link — one person into the roster */
  profileHandle?: string;
  /** set when the boot hash was a private (ids-only) link */
  privateStats?: { found: number; missing: number };
  error?: string;
}

function freshLibrary(): Library {
  const g = freshGroup('My schedule');
  return { activeId: g.groupId, people: [], groups: [g], pinnedIds: [], meId: null };
}

function loadLibrary(): Library {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const lib = normalizeLibrary(JSON.parse(raw));
      if (lib) return lib;
    }
    // migrate v2 storage (people embedded per group) into the roster model
    const v2 = localStorage.getItem(V2_KEY);
    if (v2) {
      const parsed = JSON.parse(v2) as { activeId?: string; groups?: unknown[] };
      if (Array.isArray(parsed?.groups) && parsed.groups.length > 0) {
        const groups = parsed.groups.map((g) => {
          const norm = normalizeGroup(g);
          if (!norm.groupId) norm.groupId = crypto.randomUUID();
          return norm;
        });
        return migrateV2Groups(groups, parsed.activeId);
      }
    }
    // migrate the single-schedule storage from the earliest versions
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const group = normalizeGroup(JSON.parse(legacy));
      group.groupId = crypto.randomUUID();
      group.name = group.name || 'My schedule';
      localStorage.removeItem(LEGACY_KEY);
      if (group.people.length > 0) return migrateV2Groups([group]);
    }
  } catch {
    // fall through to a fresh library
  }
  return freshLibrary();
}

/**
 * Boot sequence: load the library, then route the URL hash. Profile links
 * (#p=) import one person into the roster; share links (#e=) import all
 * their people into the roster and create/update the group they name. The
 * hash is left untouched; we only write a new hash on "Copy share link".
 */
function boot(): { lib: Library; bootImport: BootImport | null } {
  const lib = loadLibrary();
  try {
    const person = decodeProfileHash(window.location.hash);
    if (person) {
      return {
        lib: importPeople(lib, [person]),
        bootImport: { importedPeople: [], profileHandle: person.handle },
      };
    }
    const priv = decodePrivateShareHash(window.location.hash);
    if (priv) {
      const { lib: next, outcome, found, missing } = importPrivateGroup(lib, priv);
      return {
        lib: next,
        bootImport: { outcome, groupName: priv.name, importedPeople: [], privateStats: { found, missing } },
      };
    }
    const incoming = decodeShareHash(window.location.hash);
    if (incoming) {
      const target = lib.groups.find((g) => g.groupId === incoming.groupId) ?? activeGroup(lib);
      const before = new Set(target.members.map((m) => m.personId));
      const { lib: next, outcome } = importIntoLibrary(lib, incoming);
      return {
        lib: next,
        bootImport: {
          outcome,
          groupName: incoming.name,
          importedPeople:
            outcome === 'full' ? [] : incoming.people.filter((p) => !before.has(p.id)).map((p) => p.handle),
        },
      };
    }
  } catch (e) {
    if (e instanceof ShareDecodeError) return { lib, bootImport: { importedPeople: [], error: e.message } };
  }
  return { lib, bootImport: null };
}

interface StoreValue {
  library: Library;
  /** the schedule currently on screen, resolved: roster people embedded */
  group: GroupState;
  dispatch: (action: Action) => void;
  bootImport: BootImport | null;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(boot, []);
  const [library, dispatch] = useReducer(reducer, initial.lib);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
    } catch {
      // quota exceeded (huge avatars) — app still works, persistence degrades
    }
  }, [library]);

  const value = useMemo(
    () => ({
      library,
      group: resolveGroup(library, activeGroup(library)),
      dispatch,
      bootImport: initial.bootImport,
    }),
    [library, initial.bootImport],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
