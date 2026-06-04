import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScheduleXlsx } from '../parse/scheduleParser';
import { decodeShareHash, encodeShareHash } from './shareLink';
import { mergeGroups } from './merge';
import { normalizeGroup } from './normalize';
import type { GroupState, Person } from '../types';
import { SCHEMA_VERSION } from '../types';

function loadExample(name: string): ArrayBuffer {
  const buf = readFileSync(join(__dirname, '../../examples', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export function makePerson(id: string, handle: string, file: string, updatedAt = '2026-06-01T00:00:00.000Z'): Person {
  return {
    id,
    handle,
    avatar: { kind: 'emoji', emoji: '🦊', color: '#e07a5f' },
    schedule: parseScheduleXlsx(loadExample(file), file),
    updatedAt,
    enabled: true,
  };
}

function makeGroup(people: Person[], groupId = 'g-test', name = 'Test Crew'): GroupState {
  return { schemaVersion: SCHEMA_VERSION, groupId, name, people };
}

const SPRING = 'View_Student_Registration_Saved_Schedule.xlsx';
const FALL = 'View_Student_Registration_Saved_Schedule (1).xlsx';

describe('share link round-trip', () => {
  it('encodes and decodes a two-person group losslessly (minus link-stripped fields)', () => {
    const state = makeGroup([makePerson('a1', 'alice', SPRING), makePerson('b2', 'bob', FALL)]);
    const hash = encodeShareHash(state);
    const decoded = decodeShareHash(hash)!;

    expect(decoded.groupId).toBe('g-test');
    expect(decoded.name).toBe('Test Crew');
    expect(decoded.people).toHaveLength(2);
    const alice = decoded.people[0];
    expect(alice.handle).toBe('alice');
    expect(alice.schedule!.sections.map((s) => s.title)).toEqual(
      state.people[0].schedule!.sections.map((s) => s.title),
    );
    // section ids are regenerated, not transmitted — must still match
    expect(alice.schedule!.sections.map((s) => s.id)).toEqual(
      state.people[0].schedule!.sections.map((s) => s.id),
    );
    // meetings + section dates survive intact
    const cogs = alice.schedule!.sections.find((s) => s.title === 'Research Methods in Cognitive Systems')!;
    expect(cogs.courseCode).toBe('COGS_V 303');
    expect(cogs.meetings).toHaveLength(1);
    expect(cogs.meetings[0]).toMatchObject({ startMin: 570, endMin: 660, room: 'D322', floor: '3' });
    expect(cogs.termStart).toBe('2027-01-06');
    expect(cogs.termEnd).toBe('2027-04-12');
    expect(cogs.instructors).toEqual(['Kelsey Allen']);
  });

  it('stores sections shared by multiple people only once (deduped payload)', () => {
    const soloHash = encodeShareHash(makeGroup([makePerson('a1', 'alice', SPRING)]));
    const duoSameHash = encodeShareHash(
      makeGroup([makePerson('a1', 'alice', SPRING), makePerson('b2', 'bob', SPRING)]),
    );
    // adding a person with an IDENTICAL schedule should cost almost nothing
    const overhead = duoSameHash.length - soloHash.length;
    expect(overhead).toBeLessThan(120);

    // and both people still decode with full schedules
    const decoded = decodeShareHash(duoSameHash)!;
    expect(decoded.people[0].schedule!.sections.map((s) => s.id)).toEqual(
      decoded.people[1].schedule!.sections.map((s) => s.id),
    );
  });

  it('strips photo avatars down to initials', () => {
    const p = makePerson('a1', 'alice', SPRING);
    p.avatar = { kind: 'image', color: '#3a86ff', imageDataUrl: 'data:image/jpeg;base64,xxxx' };
    const decoded = decodeShareHash(encodeShareHash(makeGroup([p])))!;
    expect(decoded.people[0].avatar.kind).toBe('initials');
    expect(decoded.people[0].avatar.imageDataUrl).toBeUndefined();
    expect(decoded.people[0].avatar.initials).toBe('AL');
    expect(decoded.people[0].avatar.color).toBe('#3a86ff');
  });

  it('keeps a five-person link under 4000 chars (fits Slack/Nitro messages)', () => {
    const people = Array.from({ length: 5 }, (_, i) =>
      makePerson(`p${i}`, `person${i}`, i % 2 ? FALL : SPRING),
    );
    const hash = encodeShareHash(makeGroup(people));
    expect(hash.length).toBeLessThan(4000);
  });

  it('returns null for non-share hashes and throws on garbage payloads', () => {
    expect(decodeShareHash('')).toBeNull();
    expect(decodeShareHash('#other')).toBeNull();
    expect(() => decodeShareHash('#d=!!!notvalid!!!')).toThrow();
  });
});

describe('normalizeGroup (v1 data migration)', () => {
  it('migrates v1 sections (courseTitle + per-meeting dates) to the current shape', () => {
    const v1 = {
      schemaVersion: 1,
      people: [
        {
          id: 'a1',
          handle: 'alice',
          avatar: { kind: 'emoji', emoji: '🦊', color: '#e07a5f' },
          updatedAt: '2026-06-01T00:00:00.000Z',
          enabled: true,
          schedule: {
            importedAt: '2026-06-01T00:00:00.000Z',
            sections: [
              {
                id: 'old-id',
                courseCode: 'COGS_V 303',
                courseTitle: 'Research Methods in Cognitive Systems',
                sectionCode: '201',
                sectionLabel: 'COGS_V 303-201',
                component: 'Seminar',
                status: 'Open',
                credits: 3,
                instructors: ['Kelsey Allen'],
                meetings: [
                  {
                    startDate: '2027-01-06', endDate: '2027-02-10', days: ['Mon', 'Wed'],
                    startMin: 570, endMin: 660, buildingCode: 'BUCH', room: 'D322', raw: 'x',
                  },
                  {
                    startDate: '2027-02-22', endDate: '2027-04-12', days: ['Mon', 'Wed'],
                    startMin: 570, endMin: 660, buildingCode: 'BUCH', room: 'D322', raw: 'y',
                  },
                ],
              },
            ],
          },
        },
      ],
    };
    const migrated = normalizeGroup(v1);
    // pre-v4 data has no group identity — empty id routes into the active schedule
    expect(migrated.groupId).toBe('');
    const section = migrated.people[0].schedule!.sections[0];
    expect(section.courseCode).toBe('COGS_V 303');
    expect(section.title).toBe('Research Methods in Cognitive Systems');
    expect(section.meetings).toHaveLength(1); // split deduped
    expect(section.termStart).toBe('2027-01-06');
    expect(section.termEnd).toBe('2027-04-12');
    expect((section as unknown as Record<string, unknown>).sectionLabel).toBeUndefined();

    // migrated id must equal a fresh parse's id so blocks still merge
    const fresh = parseScheduleXlsx(loadExample(SPRING));
    const freshCogs = fresh.sections.find((s) => s.title === 'Research Methods in Cognitive Systems')!;
    expect(section.id).toBe(freshCogs.id);
  });
});

describe('mergeGroups', () => {
  const old = '2026-06-01T00:00:00.000Z';
  const newer = '2026-06-02T00:00:00.000Z';

  it('adds unknown people and keeps the local groupId', () => {
    const merged = mergeGroups(
      makeGroup([makePerson('a1', 'alice', SPRING)], 'g-local'),
      makeGroup([makePerson('b2', 'bob', FALL)], 'g-local'),
    );
    expect(merged.people.map((p) => p.handle)).toEqual(['alice', 'bob']);
    expect(merged.groupId).toBe('g-local');
  });

  it('adopts the incoming name, but keeps local name for nameless legacy payloads', () => {
    const local = makeGroup([], 'g-local', 'My crew');
    expect(mergeGroups(local, makeGroup([], 'g-local', 'Renamed crew')).name).toBe('Renamed crew');
    expect(mergeGroups(local, makeGroup([], '', '')).name).toBe('My crew');
  });

  it('newest wins for the same id', () => {
    const merged = mergeGroups(
      makeGroup([makePerson('a1', 'alice', SPRING, old)]),
      makeGroup([makePerson('a1', 'alice-renamed', FALL, newer)]),
    );
    expect(merged.people).toHaveLength(1);
    expect(merged.people[0].handle).toBe('alice-renamed');
  });

  it('stale incoming does not clobber newer local', () => {
    const merged = mergeGroups(
      makeGroup([makePerson('a1', 'alice', SPRING, newer)]),
      makeGroup([makePerson('a1', 'alice-old', FALL, old)]),
    );
    expect(merged.people[0].handle).toBe('alice');
    expect(merged.people[0].schedule!.sourceFileName).toBe(SPRING);
  });

  it('matches by handle when ids differ (same friend from two devices)', () => {
    const merged = mergeGroups(
      makeGroup([makePerson('a1', 'Alice', SPRING, old)]),
      makeGroup([makePerson('zz9', 'alice', FALL, newer)]),
    );
    expect(merged.people).toHaveLength(1);
    expect(merged.people[0].schedule!.sourceFileName).toBe(FALL);
  });

  it('preserves local photo when newest-wins picks an image-less link record', () => {
    const localP = makePerson('a1', 'alice', SPRING, old);
    localP.avatar = { kind: 'image', color: '#ff0', imageDataUrl: 'data:image/jpeg;base64,PHOTO' };
    const incomingP = makePerson('a1', 'alice', FALL, newer); // emoji avatar, no image
    const merged = mergeGroups(makeGroup([localP]), makeGroup([incomingP]));
    expect(merged.people[0].schedule!.sourceFileName).toBe(FALL); // newest schedule won
    expect(merged.people[0].avatar.imageDataUrl).toBe('data:image/jpeg;base64,PHOTO'); // photo kept
  });

  it('keeps local enabled preference across imports', () => {
    const localP = { ...makePerson('a1', 'alice', SPRING, old), enabled: false };
    const incomingP = makePerson('a1', 'alice', FALL, newer);
    const merged = mergeGroups(makeGroup([localP]), makeGroup([incomingP]));
    expect(merged.people[0].enabled).toBe(false);
  });
});
