import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { Avatar, GroupState, MeetingPattern, Person, Schedule, Section } from '../types';
import { SCHEMA_VERSION } from '../types';
import { computeSectionId } from '../parse/sectionId';

/**
 * Share links carry the whole group, tuple-packed, raw-DEFLATEd (fflate) and
 * base64url'd into the URL hash (#e=...). Deflate beats the old lz-string
 * encoding by ~40%, which is what lets a group fit in one Discord message.
 * Size-cutting measures:
 *  - sections shared by multiple people are stored ONCE; each person just
 *    lists indices into the group-wide section table
 *  - no per-meeting date ranges (one termStart/termEnd pair per section)
 *  - avatar images downgraded to initials; `enabled` and `raw` stripped;
 *    section ids regenerated on unpack
 *
 * Profile links (#p=...) reuse the exact same payload, scoped to one person
 * with no group identity — they import that person into the roster and
 * nothing else.
 */

const HASH_KEY = '#e=';
const PROFILE_HASH_KEY = '#p=';
/**
 * Private share links (#i=...) carry NO schedule data at all — just the
 * group identity, its name, and the member ids. They only render for
 * someone whose roster already holds those people (via profile links or a
 * public link); everyone else sees an empty schedule until the profiles
 * arrive, at which point the members fill in automatically.
 */
const PRIVATE_HASH_KEY = '#i=';
/** pre-deflate lz-string links — rejected with a refresh hint, not silence */
const LEGACY_HASH_KEY = '#d=';
/** Discord hard-caps messages at 2000 chars — the binding limit in practice */
export const URL_WARN_LENGTH = 2000;

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

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
  string, // courseCode
  string, // title
  string, // component
  string[], // instructors
  string, // termStart
  string, // termEnd
  PackedMeeting[],
];

type PackedAvatar = [string, string, string]; // kind, emoji|initials, color

type PackedPerson = [string, string, PackedAvatar, string, number[] | null]; // ..., section indices

type PackedGroup = [number, string, string, PackedSection[], PackedPerson[]]; // version, groupId, name, ...

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
  return [
    s.courseCode,
    s.title,
    s.component,
    s.instructors,
    s.termStart ?? '',
    s.termEnd ?? '',
    s.meetings.map(packMeeting),
  ];
}

function unpackSection(p: PackedSection): Section {
  const [courseCode, title, component, instructors, termStart, termEnd, meetings] = p;
  const base = {
    courseCode,
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

function packPayload(state: GroupState): string {
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

  const packed: PackedGroup = [SCHEMA_VERSION, state.groupId, state.name, table, people];
  return toBase64Url(deflateSync(strToU8(JSON.stringify(packed)), { level: 9 }));
}

export function encodeShareHash(state: GroupState): string {
  return HASH_KEY + packPayload(state);
}

export function buildShareUrl(state: GroupState): string {
  const { origin, pathname } = window.location;
  return origin + pathname + encodeShareHash(state);
}

/** A person's own link: the same payload, scoped to them, no group identity. */
export function encodeProfileHash(person: Person): string {
  return PROFILE_HASH_KEY + packPayload({ schemaVersion: SCHEMA_VERSION, groupId: '', name: '', people: [person] });
}

export function buildProfileUrl(person: Person): string {
  const { origin, pathname } = window.location;
  return origin + pathname + encodeProfileHash(person);
}

export class ShareDecodeError extends Error {}

function unpackPayload(payload: string): GroupState {
  let packed: PackedGroup;
  try {
    packed = JSON.parse(strFromU8(inflateSync(fromBase64Url(payload))));
  } catch {
    throw new ShareDecodeError('This share link is damaged or truncated — ask for a fresh one.');
  }
  const [version, groupId, name, table, people] = packed;
  if (typeof version !== 'number') {
    throw new ShareDecodeError('This share link is damaged or truncated — ask for a fresh one.');
  }
  if (version > SCHEMA_VERSION) {
    throw new ShareDecodeError('This link was made with a newer version of Reodite Schedules — refresh the app.');
  }
  if (version < SCHEMA_VERSION) {
    throw new ShareDecodeError('This link is from an older version — ask your friend to copy a fresh one.');
  }
  if (typeof groupId !== 'string' || typeof name !== 'string' || !Array.isArray(people)) {
    throw new ShareDecodeError('This share link is damaged or truncated — ask for a fresh one.');
  }

  const sections = table.map(unpackSection);
  return {
    schemaVersion: SCHEMA_VERSION,
    groupId,
    name,
    people: people.map((p) => {
      const [id, handle, avatar, updatedAt, indices] = p;
      const schedule: Schedule | null = indices
        ? { sections: indices.map((i) => sections[i]).filter(Boolean), importedAt: updatedAt }
        : null;
      return { id, handle, avatar: unpackAvatar(avatar), schedule, updatedAt, enabled: true };
    }),
  };
}

/** Decode a '#e=...' hash. Returns null if the hash isn't a share payload. */
export function decodeShareHash(hash: string): GroupState | null {
  if (hash.startsWith(LEGACY_HASH_KEY)) {
    throw new ShareDecodeError(
      'This link is from an older version of Reodite Schedules — ask your friend to refresh the app and copy a fresh one.',
    );
  }
  if (!hash.startsWith(HASH_KEY)) return null;
  return unpackPayload(hash.slice(HASH_KEY.length));
}

/** Decode a '#p=...' profile hash. Returns null if the hash isn't one. */
export function decodeProfileHash(hash: string): Person | null {
  if (!hash.startsWith(PROFILE_HASH_KEY)) return null;
  const person = unpackPayload(hash.slice(PROFILE_HASH_KEY.length)).people[0];
  if (!person) {
    throw new ShareDecodeError('This profile link is damaged or truncated — ask for a fresh one.');
  }
  return person;
}

/** The ids-only payload a private link carries. */
export interface PrivateShare {
  groupId: string;
  name: string;
  personIds: string[];
}

type PackedPrivate = [number, string, string, string[]]; // version, groupId, name, member ids

export function encodePrivateShareHash(state: GroupState): string {
  const packed: PackedPrivate = [SCHEMA_VERSION, state.groupId, state.name, state.people.map((p) => p.id)];
  return PRIVATE_HASH_KEY + toBase64Url(deflateSync(strToU8(JSON.stringify(packed)), { level: 9 }));
}

export function buildPrivateShareUrl(state: GroupState): string {
  const { origin, pathname } = window.location;
  return origin + pathname + encodePrivateShareHash(state);
}

/** Decode a '#i=...' private hash. Returns null if the hash isn't one. */
export function decodePrivateShareHash(hash: string): PrivateShare | null {
  if (!hash.startsWith(PRIVATE_HASH_KEY)) return null;
  let packed: PackedPrivate;
  try {
    packed = JSON.parse(strFromU8(inflateSync(fromBase64Url(hash.slice(PRIVATE_HASH_KEY.length)))));
  } catch {
    throw new ShareDecodeError('This private link is damaged or truncated — ask for a fresh one.');
  }
  const [version, groupId, name, personIds] = packed;
  if (typeof version !== 'number' || typeof groupId !== 'string' || !groupId || typeof name !== 'string' || !Array.isArray(personIds)) {
    throw new ShareDecodeError('This private link is damaged or truncated — ask for a fresh one.');
  }
  if (version > SCHEMA_VERSION) {
    throw new ShareDecodeError('This link was made with a newer version of Reodite Schedules — refresh the app.');
  }
  if (version < SCHEMA_VERSION) {
    throw new ShareDecodeError('This link is from an older version — ask your friend to copy a fresh one.');
  }
  return { groupId, name, personIds: personIds.filter((id): id is string => typeof id === 'string') };
}
