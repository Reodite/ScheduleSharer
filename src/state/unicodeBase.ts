/**
 * 2^15 encoder for share-link payloads.
 *
 * Discord copies URL hash fragments (#e=…, #p=…, #i=) verbatim, so one
 * CJK or Hangul char is one visible character even though it takes 3
 * UTF-8 bytes. Base64url packs 6 bits/char. This alphabet packs 15.
 * Base 2^15 turns digit conversion into bit-shifts.
 *
 * The encoder reads bytes LE into a BigInt, packs MSB-first. A two-byte
 * LE length prefix lets leading and trailing zero bytes round-trip.
 */

const ALPHABET_CODEPOINTS: Uint32Array = (() => {
  const cps: number[] = [];
  for (let i = 0x41; i <= 0x5A; i++) cps.push(i); // A-Z
  for (let i = 0x61; i <= 0x7A; i++) cps.push(i); // a-z
  for (let i = 0x30; i <= 0x39; i++) cps.push(i); // 0-9
  cps.push(0x2D, 0x5F); // -, _
  for (let i = 0x3040; i <= 0x30FF; i++) cps.push(i); // Hiragana + Katakana
  for (let i = 0x4E00; i <= 0x9FFF; i++) cps.push(i); // CJK Unified Ideographs
  for (let i = 0xAC00; i <= 0xD7A3; i++) cps.push(i); // Hangul Syllables (stops before U+D800 surrogates)
  for (let i = 0xA000; i <= 0xA15B; i++) cps.push(i); // Yi Syllables (subset, pads alphabet to 2^15)
  if (cps.length !== (1 << 15)) throw new Error(`alphabet size ${cps.length} != 2^15`);
  return new Uint32Array(cps);
})();

const SHIFT = 15;
const MASK = (1 << SHIFT) - 1;
const MASK_BIG = BigInt(MASK);
const SHIFT_BIG = BigInt(SHIFT);

// codepoint -> alphabet index
const CP_TO_INDEX: Map<number, number> = (() => {
  const m = new Map<number, number>();
  for (let i = 0; i < ALPHABET_CODEPOINTS.length; i++) {
    m.set(ALPHABET_CODEPOINTS[i], i);
  }
  return m;
})();

export function encodeHighBase(bytes: Uint8Array): string {
  const total = bytes.length + 2;
  const totalLsb = total & 0xFF;
  const totalMsb = (total >>> 8) & 0xFF;
  // LE: [totalLsb, totalMsb, ...payload]
  let val = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    val = (val << 8n) | BigInt(bytes[i]);
  }
  val = (val << 8n) | BigInt(totalMsb);
  val = (val << 8n) | BigInt(totalLsb);

  // BigInt -> base-2^15, LSB-first, reverse for MSB-first output.
  const digits: number[] = [];
  while (val > 0n) {
    digits.push(Number(val & MASK_BIG));
    val >>= SHIFT_BIG;
  }
  let out = '';
  for (let i = digits.length - 1; i >= 0; i--) {
    out += String.fromCodePoint(ALPHABET_CODEPOINTS[digits[i]]);
  }
  return out;
}

export function decodeHighBase(s: string): Uint8Array {
  let val = 0n;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    const idx = cp === undefined ? undefined : CP_TO_INDEX.get(cp);
    if (idx === undefined) {
      const label = cp === undefined ? '?' : 'U+' + cp.toString(16).padStart(4, '0').toUpperCase();
      throw new Error(`base-N: invalid character ${label} in share link`);
    }
    val = (val << SHIFT_BIG) | BigInt(idx);
  }
  // BigInt -> LE bytes (LSB first).
  const bytes: number[] = [];
  while (val > 0n) {
    bytes.push(Number(val & 0xFFn));
    val >>= 8n;
  }
  while (bytes.length < 2) bytes.push(0);
  const total = bytes[0] | (bytes[1] << 8);
  if (total < 2) throw new Error('base-N: malformed length prefix in share link');
  if (total > 0xFFFF) throw new Error(`base-N: payload length ${total} exceeds encoding range`);
  // Pad high-order zero bytes back to recorded total; BigInt dropped them.
  while (bytes.length < total) bytes.push(0);
  return new Uint8Array(bytes.slice(2, total));
}
