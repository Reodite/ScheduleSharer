import { describe, it, expect } from 'vitest';
import { encodeHighBase, decodeHighBase } from './unicodeBase';

function rnd(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (Math.random() * 256) | 0;
  return b;
}

describe('unicodeBase', () => {
  it('round-trips empty input', () => {
    const enc = encodeHighBase(new Uint8Array(0));
    expect(decodeHighBase(enc)).toEqual(new Uint8Array(0));
  });

  it('round-trips single bytes including 0x00', () => {
    for (let i = 0; i < 256; i++) {
      const b = new Uint8Array([i]);
      expect(decodeHighBase(encodeHighBase(b))).toEqual(b);
    }
  });

  it('round-trips leading-zero-byte payloads', () => {
    const cases = [
      new Uint8Array([0, 0, 0, 0xff]),
      new Uint8Array([0, 0xff]),
      new Uint8Array([0, 0, 0, 0, 0, 1]),
    ];
    for (const c of cases) expect(decodeHighBase(encodeHighBase(c))).toEqual(c);
  });

  it('round-trips trailing-zero-byte payloads', () => {
    const cases = [
      new Uint8Array([0xff, 0, 0]),
      new Uint8Array([1, 0, 0, 0, 0]),
      new Uint8Array([0x10, 0x00]),
    ];
    for (const c of cases) expect(decodeHighBase(encodeHighBase(c))).toEqual(c);
  });

  it('round-trips random payloads up to 4KB', () => {
    for (let n = 1; n <= 4096; n = n * 3 + 1) {
      const b = rnd(n);
      expect(decodeHighBase(encodeHighBase(b))).toEqual(b);
    }
  });

  it('shrinks a raw byte sequence below base64url length', () => {
    const sample = rnd(1024);
    const enc = encodeHighBase(sample);
    // base64url would be ~1366 chars for 1024 bytes; high-base must beat that.
    expect(enc.length).toBeLessThan(700);
    expect(decodeHighBase(enc)).toEqual(sample);
  });
});
