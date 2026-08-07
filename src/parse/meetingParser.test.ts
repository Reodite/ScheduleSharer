import { describe, expect, it } from 'vitest';
import { parseMeetingPatterns, toMinutes } from './meetingParser';

describe('toMinutes', () => {
  // 12h format
  it('handles morning times', () => {
    expect(toMinutes('9', '30', 'a.m.')).toBe(570);
  });
  it('handles afternoon times', () => {
    expect(toMinutes('1', '00', 'p.m.')).toBe(780);
    expect(toMinutes('12', '30', 'p.m.')).toBe(750);
  });
  it('handles noon and midnight', () => {
    expect(toMinutes('12', '00', 'p.m.')).toBe(720);
    expect(toMinutes('12', '00', 'a.m.')).toBe(0);
  });
  
  // 24h format
  it('handles morning times', () => {
    expect(toMinutes('9', '30', '')).toBe(570);
  });
  it('handles afternoon times', () => {
    expect(toMinutes('13', '30', '')).toBe(810);
  });
  it('handles noon and midnight', () => {
    expect(toMinutes('12', '00', '')).toBe(720);
    expect(toMinutes('0', '00', '')).toBe(0);
    expect(toMinutes('24', '00', '')).toBe(0);
  });
});

describe('parseMeetingPatterns', () => {
  const single =
    '2026-09-09 - 2026-12-07 | Mon Wed | 11:00 a.m. - 12:30 p.m. | UBCV | Buchanan Building (BUCH) | Floor: 2 | Room: B202';

  it('parses a single pattern with all fields', () => {
    const [p] = parseMeetingPatterns(single);
    expect(p.startDate).toBe('2026-09-09');
    expect(p.endDate).toBe('2026-12-07');
    expect(p.pattern).toMatchObject({
      days: ['Mon', 'Wed'],
      startMin: 660,
      endMin: 750,
      campus: 'UBCV',
      buildingName: 'Buchanan Building',
      buildingCode: 'BUCH',
      floor: '2',
      room: 'B202',
    });
  });

  it('splits reading-break cells into two dated patterns', () => {
    const cell =
      '2027-01-06 - 2027-02-10 | Mon Wed | 9:30 a.m. - 11:00 a.m. | UBCV | Buchanan Building (BUCH) | Floor: 3 | Room: D322\n\n' +
      '2027-02-22 - 2027-04-12 | Mon Wed | 9:30 a.m. - 11:00 a.m. | UBCV | Buchanan Building (BUCH) | Floor: 3 | Room: D322';
    const patterns = parseMeetingPatterns(cell);
    expect(patterns).toHaveLength(2);
    expect(patterns[0].startDate).toBe('2027-01-06');
    expect(patterns[0].endDate).toBe('2027-02-10');
    expect(patterns[1].startDate).toBe('2027-02-22');
    expect(patterns[1].endDate).toBe('2027-04-12');
    expect(patterns.every((p) => p.pattern.startMin === 570 && p.pattern.endMin === 660)).toBe(true);
  });

  it('preserves negative floors', () => {
    const [p] = parseMeetingPatterns(
      '2027-01-08 - 2027-02-12 | Fri | 10:00 a.m. - 12:00 p.m. | UBCV | Iona Building (IONA) | Floor: -2 | Room: B151',
    );
    expect(p.pattern.floor).toBe('-2');
    expect(p.pattern.endMin).toBe(720);
  });

  it('parses single-day labs', () => {
    const [p] = parseMeetingPatterns(
      '2027-01-05 - 2027-02-09 | Tue | 1:00 p.m. - 3:00 p.m. | UBCV | Hector J. MacLeod Building (MCLD) | Floor: 2 | Room: 2012',
    );
    expect(p.pattern.days).toEqual(['Tue']);
    expect(p.pattern.startMin).toBe(780);
    expect(p.pattern.endMin).toBe(900);
  });

  it('survives missing segments', () => {
    const [p] = parseMeetingPatterns('2026-09-09 - 2026-12-07 | Tue Thu | 2:00 p.m. - 3:30 p.m.');
    expect(p.pattern.days).toEqual(['Tue', 'Thu']);
    expect(p.pattern.room).toBeUndefined();
    expect(p.pattern.buildingCode).toBeUndefined();
  });

  it('drops unparseable text and empty cells', () => {
    expect(parseMeetingPatterns('')).toEqual([]);
    expect(parseMeetingPatterns('TBA')).toEqual([]);
  });
});
