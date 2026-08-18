import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';
import type { Avatar, GroupState, Library, Person, Schedule } from '../types';
import { emptyGroup, MAX_GROUPS } from '../types';
import { activeGroup, deleteFromLibrary, duplicateInLibrary, importIntoLibrary } from './library';
import type { ImportOutcome } from './library';
import { normalizeGroup } from './normalize';
import { decodeShareHash, ShareDecodeError } from './shareLink';

const STORAGE_KEY = 'schedulesharer.v2';
const LEGACY_KEY = 'schedulesharer.v1';

export type Action =
  // person-level actions operate on the ACTIVE schedule
  | { type: 'addPerson'; person: Person }
  | { type: 'editPerson'; id: string; handle?: string; avatar?: Avatar }
  | { type: 'replaceSchedule'; id: string; schedule: Schedule }
  | { type: 'removePerson'; id: string }
  | { type: 'togglePerson'; id: string; enabled: boolean }
  | { type: 'soloPerson'; id: string }
  | { type: 'enableAll' }
  // library-level actions
  | { type: 'switchGroup'; groupId: string }
  | { type: 'renameGroup'; groupId: string; name: string }
  | { type: 'deleteGroup'; groupId: string }
  | { type: 'duplicateGroup'; groupId: string }
  | { type: 'createGroup'; name: string }
  | { type: 'importIncoming'; incoming: GroupState };

function touch(p: Person): Person {
  return { ...p, updatedAt: new Date().toISOString() };
}

function updateActive(lib: Library, fn: (g: GroupState) => GroupState): Library {
  return { ...lib, groups: lib.groups.map((g) => (g.groupId === lib.activeId ? fn(g) : g)) };
}

function reducer(lib: Library, action: Action): Library {
  switch (action.type) {
    case 'addPerson':
      return updateActive(lib, (g) => ({ ...g, people: [...g.people, action.person] }));
    case 'editPerson':
      return updateActive(lib, (g) => ({
        ...g,
        people: g.people.map((p) =>
          p.id === action.id
            ? touch({ ...p, handle: action.handle ?? p.handle, avatar: action.avatar ?? p.avatar })
            : p,
        ),
      }));
    case 'replaceSchedule':
      return updateActive(lib, (g) => ({
        ...g,
        people: g.people.map((p) => (p.id === action.id ? touch({ ...p, schedule: action.schedule }) : p)),
      }));
    case 'removePerson':
      return updateActive(lib, (g) => ({ ...g, people: g.people.filter((p) => p.id !== action.id) }));
    case 'togglePerson':
      // enabled is a local view preference — deliberately NOT a touch()
      return updateActive(lib, (g) => ({
        ...g,
        people: g.people.map((p) => (p.id === action.id ? { ...p, enabled: action.enabled } : p)),
      }));
    case 'soloPerson':
      return updateActive(lib, (g) => ({
        ...g,
        people: g.people.map((p) => ({ ...p, enabled: p.id === action.id })),
      }));
    case 'enableAll':
      return updateActive(lib, (g) => ({ ...g, people: g.people.map((p) => ({ ...p, enabled: true })) }));

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
      const fresh = emptyGroup(action.name);
      return { activeId: fresh.groupId, groups: [...lib.groups, fresh] };
    }
    case 'importIncoming':
      return importIntoLibrary(lib, action.incoming).lib;
  }
}

export interface BootImport {
  outcome?: ImportOutcome;
  groupName?: string;
  importedPeople: string[];
  error?: string;
}

function freshLibrary(): Library {
  const g = emptyGroup('My schedule');
  return { activeId: g.groupId, groups: [g] };
}

function loadLibrary(): Library {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Library;
      if (Array.isArray(parsed?.groups) && parsed.groups.length > 0) {
        const groups = parsed.groups.slice(0, MAX_GROUPS).map((g) => {
          const norm = normalizeGroup(g);
          if (!norm.groupId) norm.groupId = crypto.randomUUID();
          return norm;
        });
        const activeId = groups.some((g) => g.groupId === parsed.activeId) ? parsed.activeId : groups[0].groupId;
        return { activeId, groups };
      }
    }
    // migrate the single-schedule storage from earlier versions
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const group = normalizeGroup(JSON.parse(legacy));
      group.groupId = crypto.randomUUID();
      group.name = group.name || 'My schedule';
      localStorage.removeItem(LEGACY_KEY);
      if (group.people.length > 0) return { activeId: group.groupId, groups: [group] };
    }
  } catch {
    // fall through to a fresh library
  }
  return freshLibrary();
}

/**
 * Boot sequence: load the library, then — if the URL carries a share payload —
 * route it in by groupId (update a known schedule / cache a new one). The hash
 * is left untouched; we only write a new hash on "Copy share link".
 */
function boot(): { lib: Library; bootImport: BootImport | null } {
  const lib = loadLibrary();
  try {
    const incoming = decodeShareHash(window.location.hash);
    if (incoming) {
      const target = lib.groups.find((g) => g.groupId === incoming.groupId);
      const before = new Set((target ?? activeGroup(lib)).people.map((p) => p.id));
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
  /** the schedule currently on screen */
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
    () => ({ library, group: activeGroup(library), dispatch, bootImport: initial.bootImport }),
    [library, initial.bootImport],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
