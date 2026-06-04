export const SCHEMA_VERSION = 2;

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
  people: Person[];
}

export function emptyGroup(): GroupState {
  return { schemaVersion: SCHEMA_VERSION, people: [] };
}
