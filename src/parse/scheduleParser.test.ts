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

  it('extracts all section rows by title', () => {
    const titles = schedule.sections.map((s) => `${s.title}|${s.component}`);
    expect(titles).toContain('Research Methods in Cognitive Systems|Seminar');
    expect(titles).toContain('Basic Algorithms and Data Structures|Lecture');
    expect(titles).toContain('Basic Algorithms and Data Structures|Laboratory');
    expect(titles).toContain('Elementary Statistics for Applications|Lecture');
    expect(titles).toContain('Applied Machine Learning|Discussion');
  });

  it('splits course code and title, with no section suffix', () => {
    const cpsc = schedule.sections.find(
      (s) => s.title === 'Basic Algorithms and Data Structures' && s.component === 'Lecture',
    )!;
    expect(cpsc.courseCode).toBe('CPSC_V 221');
    expect(cpsc.courseCode).not.toMatch(/-/); // '-L2A' style suffixes are dropped
    expect(cpsc.title).not.toMatch(/CPSC/);
  });

  it('collapses a reading-break split into ONE weekly meeting with the outer date range', () => {
    const cogs = schedule.sections.find((s) => s.title === 'Research Methods in Cognitive Systems')!;
    expect(cogs.meetings).toHaveLength(1);
    expect(cogs.meetings[0]).toMatchObject({
      days: ['Mon', 'Wed'],
      startMin: 570,
      endMin: 660,
      buildingCode: 'BUCH',
      room: 'D322',
    });
    expect(cogs.termStart).toBe('2027-01-06');
    expect(cogs.termEnd).toBe('2027-04-12');
  });

  it('handles missing instructor and negative floors', () => {
    const lab = schedule.sections.find(
      (s) => s.title === 'Basic Algorithms and Data Structures' && s.component === 'Laboratory',
    )!;
    expect(lab.instructors).toEqual([]);
    const cogsLab = schedule.sections.find(
      (s) => s.title === 'Understanding and Designing Cognitive Systems' && s.component === 'Laboratory',
    )!;
    expect(cogsLab.meetings[0].floor).toBe('-2');
  });

  it('reads instructors when present', () => {
    const cogs = schedule.sections.find((s) => s.title === 'Research Methods in Cognitive Systems')!;
    expect(cogs.instructors).toEqual(['Kelsey Allen']);
  });
});

describe('parseScheduleXlsx — Fall 2026 example', () => {
  const schedule = parseScheduleXlsx(loadExample('View_Student_Registration_Saved_Schedule (1).xlsx'), 'fall.xlsx');

  it('extracts sections', () => {
    const titles = schedule.sections.map((s) => s.title);
    expect(titles).toContain('Enriched Symbolic Logic');
    expect(titles).toContain('Software Construction');
  });

  it('parses single-term patterns with section date bounds', () => {
    const phil = schedule.sections.find((s) => s.title === 'Enriched Symbolic Logic')!;
    expect(phil.meetings).toHaveLength(1);
    expect(phil.meetings[0]).toMatchObject({
      startMin: 660,
      endMin: 750,
      buildingCode: 'BUCH',
    });
    expect(phil.termStart).toBe('2026-09-09');
    expect(phil.termEnd).toBe('2026-12-07');
    expect(phil.instructors).toEqual(['David Gilbert']);
  });
});

describe('parseScheduleXlsx — "View My Courses" multi-table export', () => {
  const schedule = parseScheduleXlsx(loadExample('View_My_Courses (1).xlsx'), 'mycourses.xlsx');

  it('extracts only Enrolled sections (drops Waitlisted + Dropped/Withdrawn tables)', () => {
    // The file has 12 enrolled rows, 3 waitlisted, and 2 dropped/withdrawn.
    expect(schedule.sections).toHaveLength(12);
    const titles = schedule.sections.map((s) => s.title);
    expect(titles).toContain('Introduction to Cognitive Systems');
    expect(titles).toContain('Enriched Symbolic Logic');
    // Waitlisted courses must NOT appear.
    expect(titles).not.toContain('Matrix Algebra');
    expect(titles).not.toContain('Calculus III');
  });

  it('keeps the enrolled CPSC 210 sections but not the dropped/withdrawn ones', () => {
    const cpsc210 = schedule.sections.filter((s) => s.courseCode === 'CPSC_V 210');
    // Enrolled: -102 Lecture + -L1M Laboratory. Dropped: -L1E Lab + -101 Lecture.
    expect(cpsc210.map((s) => s.component).sort()).toEqual(['Laboratory', 'Lecture']);
  });

  it('reads the "Course Listing" column and splits code/title with no section suffix', () => {
    const cpsc = schedule.sections.find(
      (s) => s.title === 'Basic Algorithms and Data Structures' && s.component === 'Lecture',
    )!;
    expect(cpsc.courseCode).toBe('CPSC_V 221');
    expect(cpsc.courseCode).not.toMatch(/-/);
  });

  it('parses multiple instructors from a newline-separated cell', () => {
    const cogs = schedule.sections.find((s) => s.title === 'Introduction to Cognitive Systems')!;
    expect(cogs.instructors).toEqual(['Laura Cang', 'Oksana Tkachman', 'Thomas Bittner']);
  });

  it('collapses the reading-break split and keeps the outer term range', () => {
    const stat = schedule.sections.find(
      (s) => s.title === 'Elementary Statistics for Applications' && s.component === 'Lecture',
    )!;
    expect(stat.meetings).toHaveLength(1);
    expect(stat.meetings[0]).toMatchObject({ days: ['Mon', 'Wed', 'Fri'], startMin: 840, endMin: 900 });
    // Folds to the earliest bound across the Start Date column (2027-01-05) and
    // the meeting-pattern ranges, out to the last end date.
    expect(stat.termStart).toBe('2027-01-05');
    expect(stat.termEnd).toBe('2027-04-12');
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
