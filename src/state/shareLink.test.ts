import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScheduleXlsx } from '../parse/scheduleParser';
import { decodeShareHash, encodeShareHash } from './shareLink';
import { mergeGroups } from './merge';
import type { GroupState, Person } from '../types';
import { SCHEMA_VERSION } from '../types';

function loadExample(name: string): ArrayBuffer {
  const buf = readFileSync(join(__dirname, '../../examples', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function makePerson(id: string, handle: string, file: string, updatedAt = '2026-06-01T00:00:00.000Z'): Person {
  return {
    id,
    handle,
    avatar: { kind: 'emoji', emoji: '🦊', color: '#e07a5f' },
    schedule: parseScheduleXlsx(loadExample(file), file),
    updatedAt,
    enabled: true,
  };
}

const SPRING = 'View_Student_Registration_Saved_Schedule.xlsx';
const FALL = 'View_Student_Registration_Saved_Schedule (1).xlsx';

describe('share link round-trip', () => {
  it('encodes and decodes a two-person group losslessly (minus link-stripped fields)', () => {
    const state: GroupState = {
      schemaVersion: SCHEMA_VERSION,
      people: [makePerson('a1', 'alice', SPRING), makePerson('b2', 'bob', FALL)],
    };
    const hash = encodeShareHash(state);
    const decoded = decodeShareHash(hash)!;

    expect(decoded.people).toHaveLength(2);
    const alice = decoded.people[0];
    expect(alice.handle).toBe('alice');
    expect(alice.schedule!.sections.map((s) => s.sectionLabel)).toEqual(
      state.people[0].schedule!.sections.map((s) => s.sectionLabel),
    );
    // section ids are regenerated, not transmitted — must still match
    expect(alice.schedule!.sections.map((s) => s.id)).toEqual(
      state.people[0].schedule!.sections.map((s) => s.id),
    );
    // meetings survive intact
    const cogs = alice.schedule!.sections.find((s) => s.sectionLabel === 'COGS_V 303-201')!;
    expect(cogs.meetings).toHaveLength(2);
    expect(cogs.meetings[0]).toMatchObject({ startMin: 570, endMin: 660, room: 'D322', floor: '3' });
  });

  it('strips photo avatars down to initials', () => {
    const p = makePerson('a1', 'alice', SPRING);
    p.avatar = { kind: 'image', color: '#3a86ff', imageDataUrl: 'data:image/jpeg;base64,xxxx' };
    const decoded = decodeShareHash(encodeShareHash({ schemaVersion: SCHEMA_VERSION, people: [p] }))!;
    expect(decoded.people[0].avatar.kind).toBe('initials');
    expect(decoded.people[0].avatar.imageDataUrl).toBeUndefined();
    expect(decoded.people[0].avatar.initials).toBe('AL');
    expect(decoded.people[0].avatar.color).toBe('#3a86ff');
  });

  it('keeps a five-person link comfortably under the warning threshold', () => {
    const people = Array.from({ length: 5 }, (_, i) =>
      makePerson(`p${i}`, `person${i}`, i % 2 ? FALL : SPRING),
    );
    const hash = encodeShareHash({ schemaVersion: SCHEMA_VERSION, people });
    expect(hash.length).toBeLessThan(7000);
  });

  it('returns null for non-share hashes and throws on garbage payloads', () => {
    expect(decodeShareHash('')).toBeNull();
    expect(decodeShareHash('#other')).toBeNull();
    expect(() => decodeShareHash('#d=!!!notvalid!!!')).toThrow();
  });
});

describe('mergeGroups', () => {
  const old = '2026-06-01T00:00:00.000Z';
  const newer = '2026-06-02T00:00:00.000Z';

  it('adds unknown people', () => {
    const local: GroupState = { schemaVersion: SCHEMA_VERSION, people: [makePerson('a1', 'alice', SPRING)] };
    const incoming: GroupState = { schemaVersion: SCHEMA_VERSION, people: [makePerson('b2', 'bob', FALL)] };
    const merged = mergeGroups(local, incoming);
    expect(merged.people.map((p) => p.handle)).toEqual(['alice', 'bob']);
  });

  it('newest wins for the same id', () => {
    const localP = makePerson('a1', 'alice', SPRING, old);
    const incomingP = makePerson('a1', 'alice-renamed', FALL, newer);
    const merged = mergeGroups(
      { schemaVersion: SCHEMA_VERSION, people: [localP] },
      { schemaVersion: SCHEMA_VERSION, people: [incomingP] },
    );
    expect(merged.people).toHaveLength(1);
    expect(merged.people[0].handle).toBe('alice-renamed');
  });

  it('stale incoming does not clobber newer local', () => {
    const localP = makePerson('a1', 'alice', SPRING, newer);
    const incomingP = makePerson('a1', 'alice-old', FALL, old);
    const merged = mergeGroups(
      { schemaVersion: SCHEMA_VERSION, people: [localP] },
      { schemaVersion: SCHEMA_VERSION, people: [incomingP] },
    );
    expect(merged.people[0].handle).toBe('alice');
    expect(merged.people[0].schedule!.sourceFileName).toBe(SPRING);
  });

  it('matches by handle when ids differ (same friend from two devices)', () => {
    const localP = makePerson('a1', 'Alice', SPRING, old);
    const incomingP = makePerson('zz9', 'alice', FALL, newer);
    const merged = mergeGroups(
      { schemaVersion: SCHEMA_VERSION, people: [localP] },
      { schemaVersion: SCHEMA_VERSION, people: [incomingP] },
    );
    expect(merged.people).toHaveLength(1);
    expect(merged.people[0].schedule!.sourceFileName).toBe(FALL);
  });

  it('preserves local photo when newest-wins picks an image-less link record', () => {
    const localP = makePerson('a1', 'alice', SPRING, old);
    localP.avatar = { kind: 'image', color: '#ff0', imageDataUrl: 'data:image/jpeg;base64,PHOTO' };
    const incomingP = makePerson('a1', 'alice', FALL, newer); // emoji avatar, no image
    const merged = mergeGroups(
      { schemaVersion: SCHEMA_VERSION, people: [localP] },
      { schemaVersion: SCHEMA_VERSION, people: [incomingP] },
    );
    expect(merged.people[0].schedule!.sourceFileName).toBe(FALL); // newest schedule won
    expect(merged.people[0].avatar.imageDataUrl).toBe('data:image/jpeg;base64,PHOTO'); // photo kept
  });

  it('keeps local enabled preference across imports', () => {
    const localP = { ...makePerson('a1', 'alice', SPRING, old), enabled: false };
    const incomingP = makePerson('a1', 'alice', FALL, newer);
    const merged = mergeGroups(
      { schemaVersion: SCHEMA_VERSION, people: [localP] },
      { schemaVersion: SCHEMA_VERSION, people: [incomingP] },
    );
    expect(merged.people[0].enabled).toBe(false);
  });
});
