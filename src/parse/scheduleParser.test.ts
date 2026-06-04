import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScheduleXlsx } from './scheduleParser';

function loadExample(name: string): ArrayBuffer {
  const buf = readFileSync(join(__dirname, '../../examples', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe('parseScheduleXlsx — Spring 2027 example', () => {
  const schedule = parseScheduleXlsx(loadExample('View_Student_Registration_Saved_Schedule.xlsx'), 'spring.xlsx');

  it('extracts all section rows', () => {
    const labels = schedule.sections.map((s) => s.sectionLabel);
    expect(labels).toContain('COGS_V 303-201');
    expect(labels).toContain('CPSC_V 221-201');
    expect(labels).toContain('CPSC_V 221-L2A');
    expect(labels).toContain('STAT_V 200-202');
    expect(labels).toContain('CPSC_V 330-T2J');
  });

  it('splits course code and title', () => {
    const cpsc = schedule.sections.find((s) => s.sectionLabel === 'CPSC_V 221-201')!;
    expect(cpsc.courseCode).toBe('CPSC_V 221');
    expect(cpsc.courseTitle).toBe('Basic Algorithms and Data Structures');
    expect(cpsc.sectionCode).toBe('201');
    expect(cpsc.component).toBe('Lecture');
  });

  it('parses reading-break split into two meeting patterns', () => {
    const cogs = schedule.sections.find((s) => s.sectionLabel === 'COGS_V 303-201')!;
    expect(cogs.meetings).toHaveLength(2);
    expect(cogs.meetings[0]).toMatchObject({
      startDate: '2027-01-06',
      endDate: '2027-02-10',
      days: ['Mon', 'Wed'],
      startMin: 570,
      endMin: 660,
      buildingCode: 'BUCH',
      room: 'D322',
    });
    expect(cogs.meetings[1].startDate).toBe('2027-02-22');
  });

  it('handles missing instructor and negative floors', () => {
    const lab = schedule.sections.find((s) => s.sectionLabel === 'CPSC_V 221-L2A')!;
    expect(lab.instructors).toEqual([]);
    const cogsLab = schedule.sections.find((s) => s.sectionLabel === 'COGS_V 300-A_L07')!;
    expect(cogsLab.meetings[0].floor).toBe('-2');
  });

  it('reads instructors when present', () => {
    const cogs = schedule.sections.find((s) => s.sectionLabel === 'COGS_V 303-201')!;
    expect(cogs.instructors).toEqual(['Kelsey Allen']);
  });
});

describe('parseScheduleXlsx — Fall 2026 example', () => {
  const schedule = parseScheduleXlsx(loadExample('View_Student_Registration_Saved_Schedule (1).xlsx'), 'fall.xlsx');

  it('extracts sections', () => {
    const labels = schedule.sections.map((s) => s.sectionLabel);
    expect(labels).toContain('PHIL_V 222-001');
    expect(labels).toContain('CPSC_V 210-102');
  });

  it('parses single-term patterns as one meeting', () => {
    const phil = schedule.sections.find((s) => s.sectionLabel === 'PHIL_V 222-001')!;
    expect(phil.meetings).toHaveLength(1);
    expect(phil.meetings[0]).toMatchObject({
      startDate: '2026-09-09',
      endDate: '2026-12-07',
      startMin: 660,
      endMin: 750,
      buildingCode: 'BUCH',
    });
    expect(phil.instructors).toEqual(['David Gilbert']);
  });
});

describe('section identity', () => {
  it('is deterministic across re-parses (merge key for shared sections)', () => {
    const a = parseScheduleXlsx(loadExample('View_Student_Registration_Saved_Schedule.xlsx'));
    const b = parseScheduleXlsx(loadExample('View_Student_Registration_Saved_Schedule.xlsx'));
    expect(a.sections.map((s) => s.id)).toEqual(b.sections.map((s) => s.id));
  });

  it('differs between different sections', () => {
    const a = parseScheduleXlsx(loadExample('View_Student_Registration_Saved_Schedule.xlsx'));
    const ids = new Set(a.sections.map((s) => s.id));
    expect(ids.size).toBe(a.sections.length);
  });
});
