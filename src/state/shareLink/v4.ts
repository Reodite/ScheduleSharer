import { inflateSync, strFromU8 } from 'fflate';
import type { Avatar, GroupState, MeetingPattern, Schedule, Section } from '../../types';
import { SCHEMA_VERSION } from '../../types';
import type { PrivateShare } from '../binaryCodec';
import { computeSectionId } from '../../parse/sectionId';

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

type PackedPerson = [string, string, PackedAvatar, string, number[] | null];

type PackedGroup = [number, string, string, PackedSection[], PackedPerson[]];

type PackedPrivate = [number, string, string, string[]];

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function unpackMeeting(p: PackedMeeting): MeetingPattern {
  const [days, startMin, endMin, campus, buildingName, buildingCode, floor, room] = p;
  const m: MeetingPattern = { days: days ? (days.split(',') as MeetingPattern['days']) : [], startMin, endMin, raw: '' };
  if (campus) m.campus = campus;
  if (buildingName) m.buildingName = buildingName;
  if (buildingCode) m.buildingCode = buildingCode;
  if (floor) m.floor = floor;
  if (room) m.room = room;
  return m;
}

function unpackSection(p: PackedSection): Section {
  const [courseCode, title, component, instructors, termStart, termEnd, meetings] = p;
  const base = {
    courseCode, title, component, instructors,
    ...(termStart ? { termStart } : {}),
    ...(termEnd ? { termEnd } : {}),
    meetings: meetings.map(unpackMeeting),
  };
  return { ...base, id: computeSectionId(base) };
}

function unpackAvatar(p: PackedAvatar): Avatar {
  const [kind, symbol, color] = p;
  return kind === 'emoji' ? { kind: 'emoji', emoji: symbol, color } : { kind: 'initials', initials: symbol, color };
}

export function parseV4(bytes: Uint8Array): GroupState {
  const packed: PackedGroup = JSON.parse(strFromU8(bytes));
  const [version, groupId, name, table, people] = packed;
  if (typeof version !== 'number') throw new Error('bad v4 payload');
  if (version > SCHEMA_VERSION) throw new Error('newer version');
  if (version < 4) throw new Error('too old');
  const sections = table.map(unpackSection);
  return {
    schemaVersion: SCHEMA_VERSION,
    groupId,
    name,
    people: people.map((p) => {
      const [id, handle, avatar, updatedAt, indices] = p;
      const schedule: Schedule | null = indices ? { sections: indices.map((i) => sections[i]).filter(Boolean), importedAt: updatedAt } : null;
      return { id, handle, avatar: unpackAvatar(avatar), schedule, updatedAt, enabled: true };
    }),
  };
}

export function parseV4Private(bytes: Uint8Array): PrivateShare {
  const packed: PackedPrivate = JSON.parse(strFromU8(bytes));
  const [version, groupId, name, personIds] = packed;
  if (typeof version !== 'number') throw new Error('bad v4 private payload');
  if (version > SCHEMA_VERSION) throw new Error('newer version');
  if (version < 4) throw new Error('too old');
  return { groupId, name, personIds: personIds.filter((id): id is string => typeof id === 'string') };
}

export function parseV4Blob(payload: string): GroupState {
  return parseV4(inflateSync(fromBase64Url(payload)));
}

export function parseV4PrivateBlob(payload: string): PrivateShare {
  return parseV4Private(inflateSync(fromBase64Url(payload)));
}