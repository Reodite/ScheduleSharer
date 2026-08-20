/**
 * Binary share-link format (v5 — wire byte 0x05).
 *
 * Encodes a GroupState / PrivateShare as a compact binary blob, then
 * compresses with LZMA and base64urls the result into a #e=, #p=, or #i=
 * hash. The wire layout is self-describing; no external dictionary.
 *
 * Varints are unsigned LEB128 (little-endian within shifted groups). Strings
 * are length-prefixed UTF-8.
 */

import {
  compress as lzmaCompress,
  decompress as lzmaDecompress,
} from 'lzma1';
import type {
  Avatar,
  DayCode,
  GroupState,
  MeetingPattern,
  Person,
  Section,
} from '../types';
import { computeSectionId } from '../parse/sectionId';
import { BUILDINGS } from './buildingTable';

/** Wire-format version. Bump to break compatibility. */
export const WIRE_FORMAT = 0x05;
/** Magic byte that begins every public/profile/private share-link blob. */
const MAGIC = 0x52; // 'R'
/** 7am base — earliest expected class start; tightens the start-time range to
 *  0…63 quarter-slots, which fits in one varint and improves LZMA entropy. */
const DAYTIME_BASE_MINS = 7 * 60;
/** 96 covers 0:00–23:45 inclusive. */
const QUARTER_MAX = 95;

/** code -> index into BUILDINGS; built lazily. */
let buildingIndex: Map<string, number> | null = null;
function codeToIndex(code: string): number | undefined {
  if (!buildingIndex) {
    buildingIndex = new Map(BUILDINGS.map((b, i) => [b[0], i]));
  }
  return buildingIndex.get(code);
}

// base64url

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

// dates                                                                     

/** Date math on UTC midnight so we don't drift on DST and the wire integer
 *  stays comparable across browsers / timezones. */
const EPOCH_2020_UTC = Date.UTC(2020, 0, 1);
const MS_PER_DAY = 86_400_000;

function isoToDaysSince2020(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  if (!Number.isFinite(t)) return undefined;
  return Math.round((t - EPOCH_2020_UTC) / MS_PER_DAY);
}

function daysSince2020ToIso(days: number): string | undefined {
  if (!days) return undefined;
  const t = EPOCH_2020_UTC + days * MS_PER_DAY;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// streaming byte reader/writer                                              

class Writer {
  private chunks: Uint8Array[] = [];
  private tail: Uint8Array;
  private tailPos = 0;
  private _length = 0;

  constructor() {
    this.tail = new Uint8Array(4096);
    this.chunks.push(this.tail);
  }

  get length(): number {
    return this._length;
  }

  writeByte(b: number): void {
    if (this.tailPos >= this.tail.length) this.allocChunk();
    this.tail[this.tailPos++] = b & 0xff;
    this._length++;
  }

  /** Append an existing buffer verbatim. */
  writeBytes(src: Uint8Array): void {
    for (let i = 0; i < src.length; i++) this.writeByte(src[i]);
  }

  private allocChunk(): void {
    if (this.tailPos !== this.tail.length) {
      this.chunks[this.chunks.length - 1] = this.tail.subarray(0, this.tailPos);
    }
    this.tail = new Uint8Array(4096);
    this.chunks.push(this.tail);
    this.tailPos = 0;
  }

  /** Unsigned LEB128 (7 bits/byte, continuation in high bit). */
  writeVarint(n: number): void {
    if (!Number.isInteger(n) || n < 0 || n > 2 ** 35) {
      throw new RangeError(`writeVarint out of range: ${n}`);
    }
    while (n >= 0x80) {
      this.writeByte((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    this.writeByte(n);
  }

  /** ZigZag varint — saves a byte on negative deltas. */
  writeZigZag(n: number): void {
    this.writeVarint(((n << 1) ^ (n >> 31)) >>> 0);
  }

  /** UTF-8 length-prefix + bytes. Length 0 == absent string, costs one byte. */
  writeString(s: string | undefined): void {
    if (!s) {
      this.writeVarint(0);
      return;
    }
    const utf8 = new TextEncoder().encode(s);
    this.writeVarint(utf8.length);
    this.writeBytes(utf8);
  }

  toBytes(): Uint8Array {
    if (this.chunks.length === 1) {
      return this.tailPos === this.tail.length ? this.tail : this.tail.subarray(0, this.tailPos);
    }
    if (this.tailPos !== this.tail.length) {
      this.chunks[this.chunks.length - 1] = this.tail.subarray(0, this.tailPos);
    }
    const total = this._length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}

class Reader {
  private pos = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.pos;
  }

  readByte(): number {
    if (this.pos >= this.bytes.length) throw new RangeError('readByte: underflow');
    return this.bytes[this.pos++];
  }

  readBytes(n: number): Uint8Array {
    if (this.pos + n > this.bytes.length) throw new RangeError('readBytes: underflow');
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  readVarint(): number {
    let n = 0;
    let shift = 0;
    for (;;) {
      if (shift > 35) throw new RangeError('readVarint: too large');
      const b = this.readByte();
      n |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return n >>> 0;
      shift += 7;
    }
  }

  readZigZag(): number {
    const n = this.readVarint();
    return (n >>> 1) ^ -(n & 1);
  }

  /** Length-prefixed UTF-8 string. Length 0 == empty string. */
  readString(): string {
    const len = this.readVarint();
    if (len === 0) return '';
    if (this.pos + len > this.bytes.length) throw new RangeError('readString: truncated');
    const s = new TextDecoder('utf-8', { fatal: true }).decode(
      this.bytes.subarray(this.pos, this.pos + len),
    );
    this.pos += len;
    return s;
  }
}

// ids are always 16 raw bytes; empty string (profile links) = 16 zero bytes

const UUID_RE = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i;

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

function writeId(w: Writer, id: string): void {
  if (!id) { w.writeBytes(new Uint8Array(16)); return; }
  const m = UUID_RE.exec(id);
  if (!m) throw new Error(`id is not a UUID: ${id}`);
  const hex = m[1] + m[2] + m[3] + m[4] + m[5];
  for (let i = 0; i < 16; i++) w.writeByte(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

function readId(r: Reader): string {
  const b = r.readBytes(16);
  if (b.every((v) => v === 0)) return '';
  const h = Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// meeting flag packing                                                      

const F_CAMPUS_IS_V = 1 << 0;
const F_BUILDING_INDEX = 1 << 1;
const F_BUILDING_STRINGS = 1 << 2;
const F_HAS_FLOOR = 1 << 3;
const F_HAS_ROOM = 1 << 4;

function packMeetingFlags(m: MeetingPattern): number {
  let f = m.campus === 'UBCV' ? F_CAMPUS_IS_V : 0;
  if (m.buildingCode) {
    const idx = codeToIndex(m.buildingCode);
    if (idx !== undefined) {
      f |= F_BUILDING_INDEX;
    } else {
      f |= F_BUILDING_STRINGS;
    }
  } else if (m.buildingName) {
    f |= F_BUILDING_STRINGS;
  }
  if (m.floor) f |= F_HAS_FLOOR;
  if (m.room) f |= F_HAS_ROOM;
  return f;
}

const DAY_INDEX: DayCode[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function packDayMask(days: DayCode[]): number {
  let mask = 0;
  for (const d of days) {
    const i = DAY_INDEX.indexOf(d);
    if (i >= 0) mask |= 1 << i;
  }
  return mask;
}

function unpackDayMask(mask: number): DayCode[] {
  const out: DayCode[] = [];
  for (let i = 0; i < 7; i++) if (mask & (1 << i)) out.push(DAY_INDEX[i]);
  return out;
}

/** minutes → quarter-hour slot from the 7am daytime base. Workday emits
 *  HH:MM on 15-minute boundaries, so we ceil defensively. */
function startSlot(min: number): number {
  return Math.max(0, Math.min(63, Math.ceil((min - DAYTIME_BASE_MINS) / 15)));
}

function startSlotUnpack(slot: number): number {
  return slot * 15 + DAYTIME_BASE_MINS;
}

/** Meeting duration in 15-minute units; floors to 1 so end is always > start. */
function durationSlots(startMin: number, endMin: number): number {
  return Math.max(1, Math.round((endMin - startMin) / 15));
}

// helpers                                                                    

function initialsFor(handle: string): string {
  const words = handle.trim().split(/\s+/);
  const chars = words.length >= 2 ? words[0][0] + words[1][0] : handle.slice(0, 2);
  return chars.toUpperCase();
}

/** Splits a course code of the form "DEPT[ _separator ]NUMBER" into the
 *  dept token and a numeric portion. UBC shapes are stable (CPSC_V 221 etc.). */
function splitCourseCode(code: string): [string, number] {
  if (!code) return ['', 0];
  const space = code.indexOf(' ');
  if (space < 0) return [code, 0];
  const dept = code.slice(0, space);
  const num = parseInt(code.slice(space + 1), 10);
  return [dept, Number.isFinite(num) ? num : 0];
}

function joinCourseCode(dept: string, num: number): string {
  if (!dept) return '';
  return num > 0 ? `${dept} ${num}` : dept;
}

// encode blob                                                                

function encodeGroup(state: GroupState): Uint8Array {
  const w = new Writer();

  /* ---- book-keeping: dedup the section table by id first ---- */
  const sectionTable: Section[] = [];
  const sectionIdxById = new Map<string, number>();
  const personSchedules: (number[] | null)[] = [];

  for (const p of state.people) {
    if (!p.schedule) {
      personSchedules.push(null);
      continue;
    }
    const indices: number[] = [];
    for (const s of p.schedule.sections) {
      let idx = sectionIdxById.get(s.id);
      if (idx === undefined) {
        idx = sectionTable.length;
        sectionTable.push(s);
        sectionIdxById.set(s.id, idx);
      }
      indices.push(idx);
    }
    personSchedules.push(indices);
  }

  // Sort so LZMA sees co-located similar sections, then remap the refs
  const ordered = sectionTable
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const cc = a.s.courseCode.localeCompare(b.s.courseCode);
      return cc !== 0 ? cc : a.s.component.localeCompare(b.s.component);
    });
  const refRemap = new Map<number, number>();
  for (let ni = 0; ni < ordered.length; ni++) {
    sectionTable[ni] = ordered[ni].s;
    refRemap.set(ordered[ni].i, ni);
  }
  for (const refs of personSchedules) {
    if (refs) for (let i = 0; i < refs.length; i++) refs[i] = refRemap.get(refs[i])!;
  }

  /* ---- write ---- */
  w.writeByte(MAGIC);
  w.writeByte(WIRE_FORMAT);
  w.writeByte(0); // flags, reserved; readers ignore unknown bits

  writeId(w, state.groupId || '');
  w.writeString(state.name || '');

  w.writeVarint(sectionTable.length);
  for (const s of sectionTable) {
    const [dept, num] = splitCourseCode(s.courseCode);
    w.writeString(dept);
    w.writeVarint(num);
    w.writeString(s.title);
    w.writeString(s.component);
    w.writeVarint(s.instructors.length);
    for (const i of s.instructors) w.writeString(i);
    const termStartDays = isoToDaysSince2020(s.termStart) ?? 0;
    const termEndDays = isoToDaysSince2020(s.termEnd) ?? 0;
    w.writeZigZag(termStartDays);
    w.writeZigZag(termEndDays);
    w.writeVarint(s.meetings.length);
    for (const m of s.meetings) {
      const flags = packMeetingFlags(m);
      w.writeByte(packDayMask(m.days));
      w.writeByte(flags);
      w.writeByte(startSlot(m.startMin));
      w.writeByte(durationSlots(m.startMin, m.endMin));
      if (flags & F_BUILDING_INDEX) w.writeVarint(codeToIndex(m.buildingCode!)!);
      else if (flags & F_BUILDING_STRINGS) {
        // wire carries only the code; the name comes from the bundled
        // BUILDINGS table on decode (or stays blank for genuinely off-map codes)
        w.writeString(m.buildingCode);
      }
      if (m.floor) w.writeString(m.floor);
      if (m.room) w.writeString(m.room);
    }
  }

  w.writeVarint(state.people.length);
  for (let i = 0; i < state.people.length; i++) {
    const p = state.people[i];
    writeId(w, p.id);
    w.writeString(p.handle);
    /* Photo avatars strip down to initials (most share links have no image).
     * We fall back to initialsFor(handle) so the recipient gets a chip even
     * when the sender never set initials. */
    const isEmoji = p.avatar.kind === 'emoji';
    const mark: string = isEmoji
      ? p.avatar.emoji || ''
      : p.avatar.initials || initialsFor(p.handle);
    w.writeByte(isEmoji ? 0 : 1);
    w.writeString(mark);
    w.writeString(p.avatar.color);
    const seconds = Math.floor(new Date(p.updatedAt).getTime() / 1000);
    w.writeVarint(Number.isFinite(seconds) ? Math.max(0, seconds) : 0);
    const indices = personSchedules[i];
    if (indices && indices.length > 0) {
      w.writeByte(1);
      w.writeVarint(indices.length);
      for (const idx of indices) w.writeVarint(idx);
    } else {
      w.writeByte(0);
    }
  }

  return w.toBytes();
}

function encodePrivate(groupId: string, name: string, personIds: string[]): Uint8Array {
  const w = new Writer();
  w.writeByte(MAGIC);
  w.writeByte(WIRE_FORMAT);
  w.writeByte(0);
  writeId(w, groupId);
  w.writeString(name);
  w.writeVarint(personIds.length);
  for (const id of personIds) writeId(w, id);
  return w.toBytes();
}

// decode blob                                                                

function decodeGroup(bytes: Uint8Array): GroupState {
  const r = new Reader(bytes);
  const magic = r.readByte();
  const ver = r.readByte();
  if (magic !== MAGIC) throw new Error(`bad magic 0x${magic.toString(16)}`);
  if (ver !== WIRE_FORMAT) throw new Error(`bad wire version ${ver}`);

  const flags = r.readByte();
  if (flags !== 0) throw new Error(`unknown flags 0x${flags.toString(16)}`);

  const groupId = readId(r);
  const name = r.readString();

  const sectionCount = r.readVarint();
  const sectionRows: Section[] = [];
  for (let i = 0; i < sectionCount; i++) {
    const dept = r.readString();
    const num = r.readVarint();
    const title = r.readString();
    const component = r.readString();
    const instructorCount = r.readVarint();
    const instructors: string[] = [];
    for (let j = 0; j < instructorCount; j++) instructors.push(r.readString());
    const termStartDays = r.readZigZag();
    const termEndDays = r.readZigZag();
    const meetingCount = r.readVarint();
    const meetings: MeetingPattern[] = [];
    for (let j = 0; j < meetingCount; j++) {
      const dayMask = r.readByte();
      const f = r.readByte();
      const startQ = r.readByte();
      const durQ = r.readByte();
      const startMin = Math.min(
        startSlotUnpack(startQ),
        QUARTER_MAX * 15,
      );
      const endMin = Math.min(
        startMin + durQ * 15,
        QUARTER_MAX * 15 + 45,
      );
      let buildingCode: string | undefined;
      let buildingName: string | undefined;
      if (f & F_BUILDING_INDEX) {
        const idx = r.readVarint();
        const b = BUILDINGS[idx];
        if (!b) throw new RangeError(`building index ${idx} out of bounds`);
        [buildingCode, buildingName] = b;
      } else if (f & F_BUILDING_STRINGS) {
        // wire carries only the code; off-map names aren't preserved
        buildingCode = r.readString() || undefined;
      }
      const floor = f & F_HAS_FLOOR ? r.readString() : undefined;
      const room = f & F_HAS_ROOM ? r.readString() : undefined;
      const campus: MeetingPattern['campus'] = f & F_CAMPUS_IS_V ? 'UBCV' : 'UBCO';
      meetings.push({
        days: unpackDayMask(dayMask),
        startMin,
        endMin,
        campus,
        buildingName,
        buildingCode,
        floor,
        room,
        raw: '',
      });
    }
    const termStart = daysSince2020ToIso(termStartDays);
    const termEnd = daysSince2020ToIso(termEndDays);
    const base: Omit<Section, 'id'> = {
      courseCode: joinCourseCode(dept, num),
      title,
      component,
      instructors,
      meetings,
      ...(termStart ? { termStart } : {}),
      ...(termEnd ? { termEnd } : {}),
    };
    sectionRows.push({ ...base, id: computeSectionId(base) });
  }

  const personCount = r.readVarint();
  const people: Person[] = [];
  for (let i = 0; i < personCount; i++) {
    const id = readId(r);
    const handle = r.readString();
    const kind = r.readByte();
    const mark = r.readString();
    const color = r.readString();
    const seconds = r.readVarint();
    const hasSchedule = r.readByte();
    const updatedAtIso = new Date(seconds * 1000).toISOString();
    const avatar: Avatar =
      kind === 0
        ? { kind: 'emoji', emoji: mark, color }
        : { kind: 'initials', initials: mark, color };

    if (hasSchedule) {
      const sc = r.readVarint();
      const sections: Section[] = [];
      for (let j = 0; j < sc; j++) {
        const ref = r.readVarint();
        const s = sectionRows[ref];
        if (!s) throw new Error(`section ref ${ref} out of bounds`);
        sections.push(s);
      }
      people.push({
        id,
        handle,
        avatar,
        updatedAt: updatedAtIso,
        enabled: true,
        schedule: { sections, importedAt: updatedAtIso, sourceFileName: undefined },
      });
    } else {
      people.push({
        id,
        handle,
        avatar,
        updatedAt: updatedAtIso,
        enabled: true,
        schedule: null,
      });
    }
  }

  if (r.remaining !== 0) throw new Error(`trailing bytes: ${r.remaining}`);

  return {
    schemaVersion: 5,
    groupId,
    name,
    people,
  };
}

function decodePrivate(bytes: Uint8Array): { groupId: string; name: string; personIds: string[] } {
  const r = new Reader(bytes);
  const magic = r.readByte();
  const ver = r.readByte();
  if (magic !== MAGIC) throw new Error(`bad magic 0x${magic.toString(16)}`);
  if (ver !== WIRE_FORMAT) throw new Error(`bad wire version ${ver}`);

  const flags = r.readByte();
  if (flags !== 0) throw new Error(`unknown flags 0x${flags.toString(16)}`);

  const groupId = readId(r);
  const name = r.readString();
  const memberCount = r.readVarint();
  const personIds: string[] = [];
  for (let i = 0; i < memberCount; i++) personIds.push(readId(r));
  if (r.remaining !== 0) throw new Error(`trailing bytes: ${r.remaining}`);
  return { groupId, name, personIds };
}

// pipeline (LZMA + base64url)                                               

export function encodeBlob(bytes: Uint8Array): string {
  return toBase64Url(lzmaCompress(bytes, 9));
}

export function decodeBlob(payload: string): Uint8Array {
  return lzmaDecompress(fromBase64Url(payload));
}

// public surface                                                             

/** The ids-only payload a private `#i=` link carries. */
export interface PrivateShare {
  groupId: string;
  name: string;
  personIds: string[];
}

export const binaryCodec = {
  encodeGroup,
  decodeGroup,
  encodePrivate,
  decodePrivate,
};
