import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, strToU8 } from 'fflate';
import { parseScheduleXlsx } from '../parse/scheduleParser';
import {
  decodePrivateShareHash,
  decodeProfileHash,
  decodeShareHash,
  encodePrivateShareHash,
  encodeProfileHash,
  encodeShareHash,
  URL_WARN_LENGTH,
} from './shareLink';
import { binaryCodec } from './binaryCodec';
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

const SPRING = 'View_Student_Registration_Saved_Schedule.xlsx';
const FALL = 'View_Student_Registration_Saved_Schedule (1).xlsx';

const UUID_A = '00000000-0000-4000-8000-000000000001';
const UUID_B = '00000000-0000-4000-8000-000000000002';
const UUID_G = '00000000-0000-4000-8000-00000000000a';

function makeGroup(people: Person[], groupId = UUID_G, name = 'Test Crew'): GroupState {
  return { schemaVersion: SCHEMA_VERSION, groupId, name, people };
}

describe('share link round-trip', () => {
  it('encodes and decodes a two-person group losslessly (minus link-stripped fields)', () => {
    const state = makeGroup([makePerson(UUID_A, 'alice', SPRING), makePerson(UUID_B, 'bob', FALL)], UUID_G);
    const hash = encodeShareHash(state);
    const decoded = decodeShareHash(hash)!;

    expect(decoded.groupId).toBe(UUID_G);
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
    expect(cogs.meetings[0].buildingCode).toBe('BUCH');
    expect(cogs.meetings[0].buildingName).toBe('Buchanan Building');
    expect(cogs.termStart).toBe('2027-01-06');
    expect(cogs.termEnd).toBe('2027-04-12');
    expect(cogs.instructors).toEqual(['Kelsey Allen']);
  });

  it('stores sections shared by multiple people only once (deduped payload)', () => {
    const soloHash = encodeShareHash(makeGroup([makePerson(UUID_A, 'alice', SPRING)]));
    const duoSameHash = encodeShareHash(
      makeGroup([makePerson(UUID_A, 'alice', SPRING), makePerson(UUID_B, 'bob', SPRING)]),
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
    const p = makePerson(UUID_A, 'alice', SPRING);
    p.avatar = { kind: 'image', color: '#3a86ff', imageDataUrl: 'data:image/jpeg;base64,xxxx' };
    const decoded = decodeShareHash(encodeShareHash(makeGroup([p])))!;
    expect(decoded.people[0].avatar.kind).toBe('initials');
    expect(decoded.people[0].avatar.imageDataUrl).toBeUndefined();
    expect(decoded.people[0].avatar.initials).toBe('AL');
    expect(decoded.people[0].avatar.color).toBe('#3a86ff');
  });

  it('keeps a five-person link under the length budget', () => {
    const people = Array.from({ length: 5 }, (_, i) =>
      makePerson(crypto.randomUUID(), `person${i}`, i % 2 ? FALL : SPRING),
    );
    const hash = encodeShareHash(makeGroup(people));
    expect(hash.length).toBeLessThan(URL_WARN_LENGTH);
    expect(hash.length).toBeLessThan(1500);
  });

  it('returns null for non-share hashes and throws on garbage payloads', () => {
    expect(decodeShareHash('')).toBeNull();
    expect(decodeShareHash('#other')).toBeNull();
    expect(() => decodeShareHash('#e=!!!notvalid!!!')).toThrow();
  });

  it('rejects pre-deflate #d= links with a refresh hint', () => {
    expect(() => decodeShareHash('#d=anything')).toThrow(/older version/);
  });
});

describe('building index encoding', () => {
  it('round-trips an on-map building via the static index, restoring the human name', () => {
    const p = makePerson(UUID_A, 'alice', SPRING);
    const section = p.schedule!.sections[0];
    if (!section.meetings[0].buildingCode) throw new Error('fixture has no buildingCode');
    const decoded = decodeShareHash(encodeShareHash(makeGroup([p])))!;
    const m = decoded.people[0].schedule!.sections[0].meetings[0];
    expect(m.buildingCode).toBe('BUCH');
    expect(m.buildingName).toBe('Buchanan Building');
  });

  it('writes only the code on the wire for off-map buildings (name is not preserved)', () => {
    const p = makePerson(UUID_A, 'alice', SPRING);
    p.schedule!.sections[0].meetings[0].buildingCode = 'XXYY';
    p.schedule!.sections[0].meetings[0].buildingName = 'Off-Map Building';
    const decoded = decodeShareHash(encodeShareHash(makeGroup([p])))!;
    const m = decoded.people[0].schedule!.sections[0].meetings[0];
    expect(m.buildingCode).toBe('XXYY');
    expect(m.buildingName).toBeUndefined();
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

describe('profile links (#p=)', () => {
  it('round-trips one person, schedule and section ids intact', () => {
    const p = makePerson(UUID_A, 'alice', SPRING);
    const hash = encodeProfileHash(p);
    expect(hash.startsWith('#p=')).toBe(true);
    const decoded = decodeProfileHash(hash)!;
    expect(decoded.id).toBe(UUID_A);
    expect(decoded.handle).toBe('alice');
    expect(decoded.schedule!.sections.map((s) => s.id)).toEqual(p.schedule!.sections.map((s) => s.id));
  });

  it('is far smaller than a group link and strips photos like group links do', () => {
    const p = makePerson(UUID_A, 'alice', SPRING);
    p.avatar = { kind: 'image', color: '#3a86ff', imageDataUrl: 'data:image/jpeg;base64,xxxx' };
    const hash = encodeProfileHash(p);
    expect(hash.length).toBeLessThan(1200);
    const decoded = decodeProfileHash(hash)!;
    expect(decoded.avatar.kind).toBe('initials');
    expect(decoded.avatar.imageDataUrl).toBeUndefined();
  });

  it('each decoder ignores the other prefix', () => {
    const p = makePerson(UUID_A, 'alice', SPRING);
    expect(decodeShareHash(encodeProfileHash(p))).toBeNull();
    expect(decodeProfileHash(encodeShareHash(makeGroup([p])))).toBeNull();
    expect(decodeProfileHash('')).toBeNull();
    expect(() => decodeProfileHash('#p=!!!garbage!!!')).toThrow();
  });
});

describe('private links (#i=)', () => {
  it('round-trips only the group identity and member ids — no schedule data', () => {
    const state = makeGroup([makePerson(UUID_A, 'alice', SPRING), makePerson(UUID_B, 'bob', FALL)]);
    const hash = encodePrivateShareHash(state);
    expect(hash.startsWith('#i=')).toBe(true);
    // dramatically smaller than the public link because nothing but ids travel
    expect(hash.length).toBeLessThan(encodeShareHash(state).length / 4);
    const decoded = decodePrivateShareHash(hash)!;
    expect(decoded).toEqual({ groupId: state.groupId, name: 'Test Crew', personIds: [UUID_A, UUID_B] });
    // and the payload genuinely contains no handles or courses
    expect(hash.includes('alice')).toBe(false);
  });

  it('decoders stay in their lanes and garbage throws', () => {
    const state = makeGroup([makePerson(UUID_A, 'alice', SPRING)]);
    expect(decodePrivateShareHash(encodeShareHash(state))).toBeNull();
    expect(decodeShareHash(encodePrivateShareHash(state))).toBeNull();
    expect(decodePrivateShareHash('')).toBeNull();
    expect(() => decodePrivateShareHash('#i=!!!garbage!!!')).toThrow();
  });
});
describe('binary codec raw sizes', () => {
  it('1-person profile raw payload is well under 1.5 KiB', () => {
    const bytes = binaryCodec.encodeGroup({
      schemaVersion: SCHEMA_VERSION, groupId: '', name: '',
      people: [makePerson(UUID_A, 'a', SPRING)],
    });
    expect(bytes.length).toBeLessThan(1536);
  });

  it('4-person group raw payload is well under 6 KiB', () => {
    const state: GroupState = {
      schemaVersion: SCHEMA_VERSION,
      groupId: UUID_G,
      name: 'crew',
      people: [
        makePerson(UUID_A, 'alice', SPRING),
        makePerson(UUID_B, 'bob', FALL),
        makePerson(crypto.randomUUID(), 'carol', SPRING),
        makePerson(crypto.randomUUID(), 'dave', FALL),
      ],
    };
    expect(binaryCodec.encodeGroup(state).length).toBeLessThan(6144);
  });
});

describe('v4 link compatibility', () => {
  function toBase64Url(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  it('decodes a v4 public link', () => {
    const v4Payload = [4, 'gid', 'crew', [], [['pid', 'alice', ['emoji', '🦊', '#e07a5f'], '2026-01-01T00:00:00.000Z', null]]];
    const link = '#e=' + toBase64Url(deflateSync(strToU8(JSON.stringify(v4Payload)), { level: 9 }));
    const decoded = decodeShareHash(link);
    expect(decoded).not.toBeNull();
    expect(decoded!.groupId).toBe('gid');
    expect(decoded!.name).toBe('crew');
    expect(decoded!.people).toHaveLength(1);
    expect(decoded!.people[0].handle).toBe('alice');
  });

  it('decodes a v4 private link', () => {
    const v4Payload = [4, 'gid', 'crew', ['pid1', 'pid2']];
    const link = '#i=' + toBase64Url(deflateSync(strToU8(JSON.stringify(v4Payload)), { level: 9 }));
    const decoded = decodePrivateShareHash(link);
    expect(decoded).not.toBeNull();
    expect(decoded!.groupId).toBe('gid');
    expect(decoded!.name).toBe('crew');
    expect(decoded!.personIds).toEqual(['pid1', 'pid2']);
  });
});
