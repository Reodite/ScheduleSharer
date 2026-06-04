import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { Avatar, GroupState, MeetingPattern, Person, Schedule, Section } from '../types';
import { SCHEMA_VERSION } from '../types';
import { computeSectionId } from '../parse/sectionId';

/**
 * Share links carry the whole group, tuple-packed then lz-string compressed
 * into the URL hash (#d=...). Stripped from links: avatar images (downgraded
 * to initials), the local-only `enabled` flag, `raw` pattern text, and
 * section ids (regenerated on unpack).
 */

const HASH_KEY = '#d=';
/** beyond this many chars, some chat apps mangle URLs — suggest JSON export */
export const URL_WARN_LENGTH = 7000;

type PackedMeeting = [
  string, // startDate
  string, // endDate
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
  string, // courseTitle
  string, // sectionCode
  string, // sectionLabel
  string, // component
  string, // status
  number | null, // credits
  string[], // instructors
  string, // gradingBasis
  PackedMeeting[],
];

type PackedAvatar = [string, string, string]; // kind, emoji|initials, color

type PackedPerson = [string, string, PackedAvatar, string, PackedSection[] | null];

type PackedGroup = [number, PackedPerson[]];

function packMeeting(m: MeetingPattern): PackedMeeting {
  return [
    m.startDate,
    m.endDate,
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
  const [startDate, endDate, days, startMin, endMin, campus, buildingName, buildingCode, floor, room] = p;
  const m: MeetingPattern = {
    startDate,
    endDate,
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
  m.raw = `${startDate} - ${endDate} | ${m.days.join(' ')}`;
  return m;
}

function packSection(s: Section): PackedSection {
  return [
    s.courseCode,
    s.courseTitle,
    s.sectionCode,
    s.sectionLabel,
    s.component,
    s.status ?? '',
    s.credits ?? null,
    s.instructors,
    s.gradingBasis ?? '',
    s.meetings.map(packMeeting),
  ];
}

function unpackSection(p: PackedSection): Section {
  const [courseCode, courseTitle, sectionCode, sectionLabel, component, status, credits, instructors, gradingBasis, meetings] = p;
  const base = {
    courseCode,
    courseTitle,
    sectionCode,
    sectionLabel,
    component,
    status: status || undefined,
    credits: credits ?? undefined,
    instructors,
    gradingBasis: gradingBasis || undefined,
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

function packPerson(p: Person): PackedPerson {
  return [
    p.id,
    p.handle,
    packAvatar(p.avatar, p.handle),
    p.updatedAt,
    p.schedule ? p.schedule.sections.map(packSection) : null,
  ];
}

function unpackPerson(p: PackedPerson): Person {
  const [id, handle, avatar, updatedAt, sections] = p;
  const schedule: Schedule | null = sections
    ? { sections: sections.map(unpackSection), importedAt: updatedAt }
    : null;
  return { id, handle, avatar: unpackAvatar(avatar), schedule, updatedAt, enabled: true };
}

export function encodeShareHash(state: GroupState): string {
  const packed: PackedGroup = [SCHEMA_VERSION, state.people.map(packPerson)];
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
  const [version, people] = packed;
  if (typeof version !== 'number' || !Array.isArray(people)) {
    throw new ShareDecodeError('This share link is damaged or truncated — ask for a fresh one.');
  }
  if (version > SCHEMA_VERSION) {
    throw new ShareDecodeError('This link was made with a newer version of ScheduleSharer — refresh the app.');
  }
  return { schemaVersion: SCHEMA_VERSION, people: people.map(unpackPerson) };
}
