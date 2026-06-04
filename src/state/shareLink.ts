import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { Avatar, GroupState, MeetingPattern, Schedule, Section } from '../types';
import { SCHEMA_VERSION } from '../types';
import { computeSectionId } from '../parse/sectionId';

/**
 * Share links carry the whole group, tuple-packed then lz-string compressed
 * into the URL hash (#d=...). Size-cutting measures (v2):
 *  - sections shared by multiple people are stored ONCE; each person just
 *    lists indices into the group-wide section table
 *  - no per-meeting date ranges (one termStart/termEnd pair per section)
 *  - avatar images downgraded to initials; `enabled` and `raw` stripped;
 *    section ids regenerated on unpack
 */

const HASH_KEY = '#d=';
/** beyond this many chars, some chat apps mangle URLs — suggest JSON export */
export const URL_WARN_LENGTH = 7000;

type PackedMeeting = [
  string, // days joined ','
  number, // startMin
  number, // endMin
  string, // campus
  string, // buildingName
  string, // buildingCode
  string, // floor
  string, // room
];

type PackedSection = [
  string, // title
  string, // component
  string[], // instructors
  string, // termStart
  string, // termEnd
  PackedMeeting[],
];

type PackedAvatar = [string, string, string]; // kind, emoji|initials, color

type PackedPerson = [string, string, PackedAvatar, string, number[] | null]; // ..., section indices

type PackedGroup = [number, PackedSection[], PackedPerson[]];

function packMeeting(m: MeetingPattern): PackedMeeting {
  return [
    m.days.join(','),
    m.startMin,
    m.endMin,
    m.campus ?? '',
    m.buildingName ?? '',
    m.buildingCode ?? '',
    m.floor ?? '',
    m.room ?? '',
  ];
}

function unpackMeeting(p: PackedMeeting): MeetingPattern {
  const [days, startMin, endMin, campus, buildingName, buildingCode, floor, room] = p;
  const m: MeetingPattern = {
    days: days ? (days.split(',') as MeetingPattern['days']) : [],
    startMin,
    endMin,
    raw: '',
  };
  if (campus) m.campus = campus;
  if (buildingName) m.buildingName = buildingName;
  if (buildingCode) m.buildingCode = buildingCode;
  if (floor) m.floor = floor;
  if (room) m.room = room;
  return m;
}

function packSection(s: Section): PackedSection {
  return [s.title, s.component, s.instructors, s.termStart ?? '', s.termEnd ?? '', s.meetings.map(packMeeting)];
}

function unpackSection(p: PackedSection): Section {
  const [title, component, instructors, termStart, termEnd, meetings] = p;
  const base = {
    title,
    component,
    instructors,
    termStart: termStart || undefined,
    termEnd: termEnd || undefined,
    meetings: meetings.map(unpackMeeting),
  };
  return { ...base, id: computeSectionId(base) };
}

function initialsFor(handle: string): string {
  const words = handle.trim().split(/\s+/);
  const chars = words.length >= 2 ? words[0][0] + words[1][0] : handle.slice(0, 2);
  return chars.toUpperCase();
}

function packAvatar(a: Avatar, handle: string): PackedAvatar {
  // Photos never travel in links — downgrade to initials, keep the color.
  if (a.kind === 'image') return ['initials', a.initials || initialsFor(handle), a.color];
  return [a.kind, a.kind === 'emoji' ? (a.emoji ?? '') : (a.initials || initialsFor(handle)), a.color];
}

function unpackAvatar(p: PackedAvatar): Avatar {
  const [kind, symbol, color] = p;
  return kind === 'emoji'
    ? { kind: 'emoji', emoji: symbol, color }
    : { kind: 'initials', initials: symbol, color };
}

export function encodeShareHash(state: GroupState): string {
  // Group-wide section table: identical sections (same id) stored once.
  const table: PackedSection[] = [];
  const indexById = new Map<string, number>();

  const people: PackedPerson[] = state.people.map((p) => {
    let indices: number[] | null = null;
    if (p.schedule) {
      indices = p.schedule.sections.map((s) => {
        let idx = indexById.get(s.id);
        if (idx === undefined) {
          idx = table.length;
          table.push(packSection(s));
          indexById.set(s.id, idx);
        }
        return idx;
      });
    }
    return [p.id, p.handle, packAvatar(p.avatar, p.handle), p.updatedAt, indices];
  });

  const packed: PackedGroup = [SCHEMA_VERSION, table, people];
  return HASH_KEY + compressToEncodedURIComponent(JSON.stringify(packed));
}

export function buildShareUrl(state: GroupState): string {
  const { origin, pathname } = window.location;
  return origin + pathname + encodeShareHash(state);
}

export class ShareDecodeError extends Error {}

/** Decode a '#d=...' hash. Returns null if the hash isn't a share payload. */
export function decodeShareHash(hash: string): GroupState | null {
  if (!hash.startsWith(HASH_KEY)) return null;
  let packed: PackedGroup;
  try {
    const json = decompressFromEncodedURIComponent(hash.slice(HASH_KEY.length));
    if (!json) throw new Error('empty');
    packed = JSON.parse(json);
  } catch {
    throw new ShareDecodeError('This share link is damaged or truncated — ask for a fresh one.');
  }
  const [version, table, people] = packed;
  if (typeof version !== 'number' || !Array.isArray(people)) {
    throw new ShareDecodeError('This share link is damaged or truncated — ask for a fresh one.');
  }
  if (version > SCHEMA_VERSION) {
    throw new ShareDecodeError('This link was made with a newer version of ScheduleSharer — refresh the app.');
  }
  if (version < SCHEMA_VERSION) {
    throw new ShareDecodeError('This link is from an older version — ask your friend to copy a fresh one.');
  }

  const sections = table.map(unpackSection);
  return {
    schemaVersion: SCHEMA_VERSION,
    people: people.map((p) => {
      const [id, handle, avatar, updatedAt, indices] = p;
      const schedule: Schedule | null = indices
        ? { sections: indices.map((i) => sections[i]).filter(Boolean), importedAt: updatedAt }
        : null;
      return { id, handle, avatar: unpackAvatar(avatar), schedule, updatedAt, enabled: true };
    }),
  };
}
