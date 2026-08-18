import { describe, expect, it } from 'vitest';
import type { MeetingPattern, Person, Section } from '../types';
import type { Term } from '../features/terms';
import { occupancyAt } from './occupancy';

let nextId = 0;

function meeting(overrides: Partial<MeetingPattern>): MeetingPattern {
  return { days: ['Mon'], startMin: 540, endMin: 600, raw: '', ...overrides };
}

function section(meetings: MeetingPattern[], overrides: Partial<Section> = {}): Section {
  return {
    id: `s${nextId++}`,
    courseCode: 'CPSC_V 221',
    title: 'Algorithms',
    component: 'Lecture',
    instructors: [],
    termStart: '2026-09-02',
    termEnd: '2026-12-04',
    meetings,
    ...overrides,
  };
}

function person(handle: string, sections: Section[], enabled = true): Person {
  return {
    id: `p-${handle}`,
    handle,
    avatar: { kind: 'initials', initials: handle.slice(0, 2).toUpperCase(), color: '#fff' },
    schedule: { sections, importedAt: '2026-01-01' },
    updatedAt: '2026-01-01',
    enabled,
  };
}

const term: Term = { key: '2026-fall', label: 'Fall 2026', start: '2026-09-02', end: '2026-12-04' };

describe('occupancyAt', () => {
  it('groups people by building for the probed day and minute', () => {
    const alice = person('alice', [section([meeting({ buildingCode: 'BUCH', room: 'A101' })])]);
    const bob = person('bob', [section([meeting({ buildingCode: 'BUCH', room: 'A203' })])]);
    const carol = person('carol', [section([meeting({ buildingCode: 'ESB', startMin: 570, endMin: 660 })])]);

    const occ = occupancyAt([alice, bob, carol], term, 'Mon', 570);
    expect([...occ.byBuilding.keys()].sort()).toEqual(['BUCH', 'ESB']);
    expect(occ.byBuilding.get('BUCH')!.map((a) => a.person.handle)).toEqual(['alice', 'bob']);
    expect(occ.busyCount).toBe(3);
  });

  it('excludes classes not in session at the probed time', () => {
    const alice = person('alice', [section([meeting({ buildingCode: 'BUCH' })])]);
    expect(occupancyAt([alice], term, 'Mon', 600).byBuilding.size).toBe(0); // endMin exclusive
    expect(occupancyAt([alice], term, 'Tue', 570).byBuilding.size).toBe(0); // wrong day
    expect(occupancyAt([alice], term, 'Mon', 540).byBuilding.size).toBe(1); // startMin inclusive
  });

  it('skips disabled people and sections outside the term', () => {
    const off = person('off', [section([meeting({ buildingCode: 'BUCH' })])], false);
    const spring = person('spring', [
      section([meeting({ buildingCode: 'BUCH' })], { termStart: '2027-01-04', termEnd: '2027-04-08' }),
    ]);
    const occ = occupancyAt([off, spring], term, 'Mon', 570);
    expect(occ.byBuilding.size).toBe(0);
    expect(occ.busyCount).toBe(0);
  });

  it('lists a double-booked person once per building, soonest end first', () => {
    const alice = person('alice', [
      section([meeting({ buildingCode: 'BUCH', endMin: 630, room: 'LONG' })]),
      section([meeting({ buildingCode: 'BUCH', endMin: 600, room: 'SHORT' })]),
    ]);
    const occ = occupancyAt([alice], term, 'Mon', 570);
    const list = occ.byBuilding.get('BUCH')!;
    expect(list).toHaveLength(1);
    expect(list[0].pattern.room).toBe('SHORT');
  });

  it('collects located-nowhere classes as unlocated', () => {
    const alice = person('alice', [section([meeting({})])]);
    const occ = occupancyAt([alice], term, 'Mon', 570);
    expect(occ.byBuilding.size).toBe(0);
    expect(occ.unlocated.map((a) => a.person.handle)).toEqual(['alice']);
    expect(occ.busyCount).toBe(1);
  });
});
