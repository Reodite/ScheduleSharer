import { describe, expect, it } from 'vitest';
import { dateFromSerial } from './serialDate';

describe('dateFromSerial', () => {
  it('converts Workday serials (verified against in-pattern ISO dates)', () => {
    expect(dateFromSerial(46274)).toBe('2026-09-09');
  });
  it('round-trips a known anchor', () => {
    // 2027-01-04 is 46391 days after 1899-12-30
    expect(dateFromSerial(46391)).toBe('2027-01-04');
  });
});
