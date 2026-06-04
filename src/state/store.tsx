import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';
import type { Avatar, GroupState, Person, Schedule } from '../types';
import { emptyGroup } from '../types';
import { mergeGroups } from './merge';
import { normalizeGroup } from './normalize';
import { decodeShareHash, ShareDecodeError } from './shareLink';

const STORAGE_KEY = 'schedulesharer.v1';

export type Action =
  | { type: 'addPerson'; person: Person }
  | { type: 'editPerson'; id: string; handle?: string; avatar?: Avatar }
  | { type: 'replaceSchedule'; id: string; schedule: Schedule }
  | { type: 'removePerson'; id: string }
  | { type: 'togglePerson'; id: string; enabled: boolean }
  | { type: 'soloPerson'; id: string }
  | { type: 'enableAll' }
  | { type: 'mergeIncoming'; incoming: GroupState };

function touch(p: Person): Person {
  return { ...p, updatedAt: new Date().toISOString() };
}

function reducer(state: GroupState, action: Action): GroupState {
  switch (action.type) {
    case 'addPerson':
      return { ...state, people: [...state.people, action.person] };
    case 'editPerson':
      return {
        ...state,
        people: state.people.map((p) =>
          p.id === action.id
            ? touch({ ...p, handle: action.handle ?? p.handle, avatar: action.avatar ?? p.avatar })
            : p,
        ),
      };
    case 'replaceSchedule':
      return {
        ...state,
        people: state.people.map((p) => (p.id === action.id ? touch({ ...p, schedule: action.schedule }) : p)),
      };
    case 'removePerson':
      return { ...state, people: state.people.filter((p) => p.id !== action.id) };
    case 'togglePerson':
      // enabled is a local view preference — deliberately NOT a touch()
      return {
        ...state,
        people: state.people.map((p) => (p.id === action.id ? { ...p, enabled: action.enabled } : p)),
      };
    case 'soloPerson':
      return { ...state, people: state.people.map((p) => ({ ...p, enabled: p.id === action.id })) };
    case 'enableAll':
      return { ...state, people: state.people.map((p) => ({ ...p, enabled: true })) };
    case 'mergeIncoming':
      return mergeGroups(state, action.incoming);
  }
}

export interface BootImport {
  importedPeople: string[];
  error?: string;
}

function loadLocal(): GroupState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyGroup();
    const parsed = JSON.parse(raw) as GroupState;
    if (typeof parsed?.schemaVersion !== 'number' || !Array.isArray(parsed?.people)) return emptyGroup();
    // migrates v1-shaped data (course codes, per-meeting dates) in place
    return normalizeGroup(parsed);
  } catch {
    return emptyGroup();
  }
}

/**
 * Boot sequence: load localStorage, then — if the URL carries a share payload —
 * merge it in. The hash is left untouched so the user can still copy the
 * incoming link from the address bar; we only write a new hash when they
 * click "Copy share link".
 */
function boot(): { state: GroupState; bootImport: BootImport | null } {
  const local = loadLocal();
  let bootImport: BootImport | null = null;
  try {
    const incoming = decodeShareHash(window.location.hash);
    if (incoming) {
      const before = new Set(local.people.map((p) => p.id));
      const merged = mergeGroups(local, incoming);
      bootImport = {
        importedPeople: incoming.people.filter((p) => !before.has(p.id)).map((p) => p.handle),
      };
      return { state: merged, bootImport };
    }
  } catch (e) {
    if (e instanceof ShareDecodeError) bootImport = { importedPeople: [], error: e.message };
  }
  return { state: local, bootImport };
}

interface StoreValue {
  state: GroupState;
  dispatch: (action: Action) => void;
  bootImport: BootImport | null;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(boot, []);
  const [state, dispatch] = useReducer(reducer, initial.state);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // quota exceeded (huge avatars) — app still works, persistence degrades
    }
  }, [state]);

  const value = useMemo(
    () => ({ state, dispatch, bootImport: initial.bootImport }),
    [state, initial.bootImport],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
