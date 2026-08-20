export const SCHEMA_VERSION = 4;

/** hard cap on locally cached schedules */
export const MAX_GROUPS = 5;

export type DayCode = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export const DAY_ORDER: DayCode[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface MeetingPattern {
  days: DayCode[];
  /** minutes since midnight, local wall-clock (570 = 9:30) */
  startMin: number;
  endMin: number;
  campus?: string; // 'UBCV'
  buildingName?: string; // 'Buchanan Building'
  buildingCode?: string; // 'BUCH'
  floor?: string; // keep as string to preserve '-2'
  room?: string; // 'D322'
  /** original pattern line, for tooltips/debugging */
  raw: string;
}

export interface Section {
  /** hash of section identity — the cross-person merge key */
  id: string;
  courseCode: string; // 'CPSC_V 221' (specific section suffixes like '-L2A' are dropped)
  title: string; // 'Basic Algorithms and Data Structures'
  component: string; // 'Lecture' | 'Laboratory' | 'Discussion' | 'Seminar' | ...
  instructors: string[];
  /**
   * ISO date bounds of the section (outer range across its meeting patterns).
   * The only date info we keep — drives term bucketing; per-meeting ranges
   * (reading-break splits) are deliberately dropped to keep share links small.
   */
  termStart?: string;
  termEnd?: string;
  meetings: MeetingPattern[];
}

export interface Schedule {
  sections: Section[];
  sourceFileName?: string;
  importedAt: string;
}

export type AvatarKind = 'emoji' | 'initials' | 'image';

export interface Avatar {
  kind: AvatarKind;
  emoji?: string;
  initials?: string;
  /** hex accent color, always present (chip border / initials background) */
  color: string;
  /** 96px JPEG data URL; lives in localStorage + JSON export, never in links */
  imageDataUrl?: string;
}

export interface Person {
  /** uuid — stable identity that survives handle renames */
  id: string;
  handle: string;
  avatar: Avatar;
  schedule: Schedule | null;
  /** ISO timestamp; newest-wins on merge */
  updatedAt: string;
  /**
   * show/hide flag. On roster records this is always true — the real
   * per-schedule preference lives on GroupMember and is applied when a
   * group is resolved for display.
   */
  enabled: boolean;
}

/**
 * The WIRE shape: share links, profile links, and JSON backups all carry a
 * GroupState with people embedded. Local storage does not — see Library.
 */
export interface GroupState {
  schemaVersion: number;
  /**
   * Stable identity of this shared calendar — travels in share links.
   * A link with a known groupId updates that cached schedule; an unknown
   * groupId caches a new one. Empty on legacy payloads and profile links.
   */
  groupId: string;
  /** user-editable display name; travels in links (newest wins on update) */
  name: string;
  people: Person[];
}

/** One person's slot in a group: a roster reference + the local show/hide flag. */
export interface GroupMember {
  personId: string;
  enabled: boolean;
}

/** A schedule (shared calendar): a named composition of roster people. */
export interface Group {
  groupId: string;
  name: string;
  members: GroupMember[];
}

/**
 * All local state. People live ONCE in the roster — every import path
 * (share link, profile link, JSON file, xlsx drop) writes here — and groups
 * only reference them, so an updated person is current in every schedule
 * that includes them.
 */
export interface Library {
  activeId: string;
  people: Person[];
  groups: Group[];
  /** roster people pinned to the top of the People list (local-only) */
  pinnedIds: string[];
}

export function freshGroup(name = ''): Group {
  return { groupId: crypto.randomUUID(), name, members: [] };
}
