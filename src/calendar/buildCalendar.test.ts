import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScheduleXlsx } from '../parse/scheduleParser';
import { buildCalendar, expandBlocks, layoutDay, mergeBlocks } from './buildCalendar';
import { commonFreeIntervals } from '../features/freeTime';
import { deriveTerms, defaultTermKey } from '../features/terms';
import { whoIsFreeNow } from '../features/whoIsFreeNow';
import type { Person } from '../types';

const SPRING = 'View_Student_Registration_Saved_Schedule.xlsx';
const FALL = 'View_Student_Registration_Saved_Schedule (1).xlsx';

function loadExample(name: string): ArrayBuffer {
  const buf = readFileSync(join(__dirname, '../../examples', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function makePerson(id: string, handle: string, file: string): Person {
  return {
    id,
    handle,
    avatar: { kind: 'initials', initials: handle.slice(0, 2).toUpperCase(), color: '#f4845f' },
    schedule: parseScheduleXlsx(loadExample(file), file),
    updatedAt: '2026-06-01T00:00:00.000Z',
    enabled: true,
  };
}

const alice = makePerson('a1', 'alice', SPRING);
const bob = makePerson('b2', 'bob', FALL);
const aliceTwin = makePerson('c3', 'casey', SPRING); // same courses as alice

describe('terms', () => {
  it('derives both terms from the group', () => {
    const terms = deriveTerms([alice, bob]);
    expect(terms.map((t) => t.label)).toEqual(['Fall 2026', 'Spring 2027']);
    expect(terms[1].start).toBe('2027-01-05');
    expect(terms[1].end).toBe('2027-04-12');
  });

  it('defaults to the term containing today, else nearest upcoming', () => {
    const terms = deriveTerms([alice, bob]);
    expect(defaultTermKey(terms, '2026-10-15')).toBe('2026-fall');
    expect(defaultTermKey(terms, '2026-06-04')).toBe('2026-fall'); // before both -> upcoming
    expect(defaultTermKey(terms, '2027-02-15')).toBe('2027-spring'); // reading break is still in-term
    expect(defaultTermKey(terms, '2028-01-01')).toBe('2027-spring'); // after both -> latest
  });
});

describe('buildCalendar', () => {
  const terms = deriveTerms([alice, bob, aliceTwin]);
  const spring = terms.find((t) => t.key === '2027-spring')!;

  it('merges identical sections across people into one block with both avatars', () => {
    const model = buildCalendar([alice, aliceTwin], spring);
    const monday = model.blocksByDay.get('Mon')!;
    const cogs = monday.find((b) => b.section.courseCode === 'COGS_V 303');
    expect(cogs).toBeDefined();
    expect(cogs!.people.map((p) => p.handle)).toEqual(['alice', 'casey']);
  });

  it('renders a reading-break-split section as ONE weekly block, person deduped', () => {
    const model = buildCalendar([alice], spring);
    const monday = model.blocksByDay.get('Mon')!;
    const cogsBlocks = monday.filter((b) => b.section.courseCode === 'COGS_V 303');
    expect(cogsBlocks).toHaveLength(1);
    expect(cogsBlocks[0].people).toHaveLength(1);
  });

  it('filters by term', () => {
    const model = buildCalendar([alice, bob], spring);
    const all = [...model.blocksByDay.values()].flat();
    expect(all.some((b) => b.section.courseCode === 'PHIL_V 222')).toBe(false); // bob is Fall-only
    expect(all.some((b) => b.section.courseCode === 'COGS_V 303')).toBe(true);
  });

  it('excludes disabled people', () => {
    const model = buildCalendar([{ ...alice, enabled: false }, aliceTwin], spring);
    const monday = model.blocksByDay.get('Mon')!;
    const cogs = monday.find((b) => b.section.courseCode === 'COGS_V 303')!;
    expect(cogs.people.map((p) => p.handle)).toEqual(['casey']);
  });

  it('assigns side-by-side columns to overlapping different courses', () => {
    // alice Mon: COGS 303 9:30-11, CPSC 221 13-14, STAT 200 14-15 — no overlaps
    // fabricate an overlap by merging alice's Mon with a synthetic shifted block set
    const blocks = mergeBlocks(expandBlocks([alice], spring)).filter((b) => b.day === 'Mon');
    const synthetic = { ...blocks[0], key: 'synthetic', startMin: blocks[0].startMin + 30, endMin: blocks[0].endMin + 30, section: { ...blocks[0].section, id: 'other' } };
    const laid = layoutDay([...blocks, synthetic]);
    const overlapped = laid.filter((b) => b.cols === 2);
    expect(overlapped).toHaveLength(2);
    expect(new Set(overlapped.map((b) => b.col))).toEqual(new Set([0, 1]));
  });
});

describe('commonFreeIntervals', () => {
  const terms = deriveTerms([alice]);
  const spring = terms.find((t) => t.key === '2027-spring')!;

  it('finds gaps between classes within the window', () => {
    const blocks = expandBlocks([alice], spring);
    const free = commonFreeIntervals(blocks, ['Mon']);
    // alice Mon: 9:30-11:00 COGS, 13:00-14:00 CPSC, 14:00-15:00 STAT
    expect(free).toEqual([
      { day: 'Mon', startMin: 480, endMin: 570 },
      { day: 'Mon', startMin: 660, endMin: 780 },
      { day: 'Mon', startMin: 900, endMin: 1200 },
    ]);
  });

  it('drops slivers below the minimum length', () => {
    const blocks = expandBlocks([alice], spring);
    const free = commonFreeIntervals(blocks, ['Mon'], 555, 1200); // window starts 9:15 -> 15min sliver
    expect(free.some((f) => f.startMin === 555)).toBe(false);
  });
});

describe('whoIsFreeNow', () => {
  it('reports in-class vs free with date-range awareness', () => {
    // Wed 2027-01-13 10:00 — alice is in COGS_V 303 (9:30-11:00 Mon Wed)
    const inClass = whoIsFreeNow([alice], new Date(2027, 0, 13, 10, 0));
    expect(inClass[0].current?.section.courseCode).toBe('COGS_V 303');
    expect(inClass[0].current?.pattern.room).toBe('D322');

    // Wed 2027-02-17 10:00 — reading break: same weekday/time but out of range
    const readingBreak = whoIsFreeNow([alice], new Date(2027, 1, 17, 10, 0));
    expect(readingBreak[0].current).toBeNull();

    // Wed 2027-01-13 8:00 — before class: free, next is COGS at 9:30
    const morning = whoIsFreeNow([alice], new Date(2027, 0, 13, 8, 0));
    expect(morning[0].current).toBeNull();
    expect(morning[0].next?.pattern.startMin).toBe(570);
  });

  it('sorts free people before in-class people', () => {
    const statuses = whoIsFreeNow([alice, bob], new Date(2027, 0, 13, 10, 0));
    expect(statuses[0].person.handle).toBe('bob'); // bob's term is over -> free
    expect(statuses[1].person.handle).toBe('alice');
  });
});
