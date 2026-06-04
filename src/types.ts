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
  /** local-only UI filter; persisted to localStorage, stripped from links */
  enabled: boolean;
}

export interface GroupState {
  schemaVersion: number;
  /**
   * Stable identity of this shared calendar — travels in share links.
   * A link with a known groupId updates that cached schedule; an unknown
   * groupId caches a new one.
   */
  groupId: string;
  /** user-editable display name; travels in links (newest wins on update) */
  name: string;
  people: Person[];
}

/** All locally cached schedules plus which one is on screen. */
export interface Library {
  activeId: string;
  groups: GroupState[];
}

export function emptyGroup(name = ''): GroupState {
  return { schemaVersion: SCHEMA_VERSION, groupId: crypto.randomUUID(), name, people: [] };
}
