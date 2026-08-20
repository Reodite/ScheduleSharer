import { describe, it, expect } from 'vitest';
import { mergeBuildings } from './mergeBuildings.mjs';

describe('mergeBuildings', () => {
  it('passes through an unchanged table verbatim', () => {
    const prev = [
      ['AAA', 'Alpha'],
      ['BBB', 'Bravo'],
      ['CCC', 'Charlie'],
    ];
    const next = [
      ['AAA', 'Alpha'],
      ['BBB', 'Bravo'],
      ['CCC', 'Charlie'],
    ];
    expect(mergeBuildings(prev, next)).toEqual(prev);
  });

  it('appends new rows alphabetically at the end', () => {
    const prev = [
      ['AAA', 'Alpha'],
      ['CCC', 'Charlie'],
    ];
    const next = [
      ['AAA', 'Alpha'],
      ['BBB', 'Bravo'],
      ['CCC', 'Charlie'],
      ['DDD', 'Delta'],
    ];
    expect(mergeBuildings(prev, next)).toEqual([
      ['AAA', 'Alpha'],
      ['CCC', 'Charlie'],
      ['BBB', 'Bravo'],
      ['DDD', 'Delta'],
    ]);
  });

  it('keeps dropped rows at their existing slot, never tombstoning', () => {
    const prev = [
      ['AAA', 'Alpha'],
      ['BBB', 'Bravo'],
      ['CCC', 'Charlie'],
    ];
    const next = [
      ['AAA', 'Alpha'],
      ['CCC', 'Charlie'],
    ];
    expect(mergeBuildings(prev, next)).toEqual(prev);
  });

  it('preserves prev names for codes that still exist', () => {
    // names are wire-format-stable too — a name change upstream doesn't
    // ripple through the bundled table until the code itself is dropped
    const prev = [
      ['AAA', 'Alpha (old)'],
      ['BBB', 'Bravo'],
    ];
    const next = [
      ['AAA', 'Alpha (new)'],
      ['BBB', 'Bravo'],
    ];
    expect(mergeBuildings(prev, next)).toEqual(prev);
  });

  it('combines drops and additions without shifting indices', () => {
    const prev = [
      ['AAA', 'Alpha'],
      ['BBB', 'Bravo'],
      ['CCC', 'Charlie'],
      ['DDD', 'Delta'],
    ];
    const next = [
      ['AAA', 'Alpha'],
      ['CCC', 'Charlie'],
      ['EEE', 'Echo'],
    ];
    expect(mergeBuildings(prev, next)).toEqual([
      ['AAA', 'Alpha'],
      ['BBB', 'Bravo'],
      ['CCC', 'Charlie'],
      ['DDD', 'Delta'],
      ['EEE', 'Echo'],
    ]);
  });

  it('handles empty prev (first run) by sorting newcomers alphabetically', () => {
    const prev = [];
    const next = [
      ['CCC', 'Charlie'],
      ['AAA', 'Alpha'],
      ['BBB', 'Bravo'],
    ];
    expect(mergeBuildings(prev, next)).toEqual([
      ['AAA', 'Alpha'],
      ['BBB', 'Bravo'],
      ['CCC', 'Charlie'],
    ]);
  });

  it('produces identical output on a re-run of the same input', () => {
    const prev = [
      ['AAA', 'Alpha'],
      ['BBB', 'Bravo'],
    ];
    const next = [
      ['AAA', 'Alpha'],
      ['BBB', 'Bravo'],
    ];
    expect(mergeBuildings(prev, next)).toEqual(mergeBuildings(prev, next));
  });
});
