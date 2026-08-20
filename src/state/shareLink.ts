import type { GroupState, Person } from '../types';
import { binaryCodec, decodeBlob, encodeBlob } from './binaryCodec';
import type { PrivateShare } from './binaryCodec';

/**
 * Share links carry the whole group encoded as a tiny purpose-built binary
 * buffer (see binaryCodec.ts), then LZMA-compressed (preset 9 via lzma1)
 * and base64url'd into the URL hash.
 *
 * Hash prefixes:
 *   #e=   public schedule   — one or more people, schedules embedded
 *   #p=   profile link      — same blob shape, scoped to one person
 *   #i=   private (ids only) — names + section data dropped, ids remain
 *
 * Round-trip strips photos (downgrade to initials) and the per-meeting
 * `raw` source string, just like before. Ids for sections are recomputed
 * on decode so cross-person merges keep working.
 */

const HASH_KEY = '#e=';
const PROFILE_HASH_KEY = '#p=';
const PRIVATE_HASH_KEY = '#i=';
/** pre-deflate lz-string links — rejected with a refresh hint, not silence */
const LEGACY_HASH_KEY = '#d=';

/** Discord hard-caps messages at 2000 chars — the binding limit in practice */
export const URL_WARN_LENGTH = 2000;

export class ShareDecodeError extends Error {}

export function encodeShareHash(state: GroupState): string {
  return HASH_KEY + encodeBlob(binaryCodec.encodeGroup(state));
}

export function buildShareUrl(state: GroupState): string {
  const { origin, pathname } = window.location;
  return origin + pathname + encodeShareHash(state);
}

/** A person's own link: the same payload, scoped to them, no group identity. */
export function encodeProfileHash(person: Person): string {
  const wrapped: GroupState = { schemaVersion: 5, groupId: '', name: '', people: [person] };
  return PROFILE_HASH_KEY + encodeBlob(binaryCodec.encodeGroup(wrapped));
}

export function buildProfileUrl(person: Person): string {
  const { origin, pathname } = window.location;
  return origin + pathname + encodeProfileHash(person);
}

/** Decode a '#e=...' hash. Returns null if the hash isn't a share payload. */
export function decodeShareHash(hash: string): GroupState | null {
  if (hash.startsWith(LEGACY_HASH_KEY)) {
    throw new ShareDecodeError(
      'This link is from an older version of Reodite Schedules — ask your friend to refresh the app and copy a fresh one.',
    );
  }
  if (!hash.startsWith(HASH_KEY)) return null;
  return decodeBlobToGroup(hash.slice(HASH_KEY.length));
}

/** Decode a '#p=...' profile hash. Returns null if the hash isn't one. */
export function decodeProfileHash(hash: string): Person | null {
  if (!hash.startsWith(PROFILE_HASH_KEY)) return null;
  const state = decodeBlobToGroup(hash.slice(PROFILE_HASH_KEY.length));
  const person = state.people[0];
  if (!person) throw new ShareDecodeError('This profile link is damaged or truncated — ask for a fresh one.');
  return person;
}

export function encodePrivateShareHash(state: GroupState): string {
  const payload = binaryCodec.encodePrivate(state.groupId, state.name, state.people.map((p) => p.id));
  return PRIVATE_HASH_KEY + encodeBlob(payload);
}

export function buildPrivateShareUrl(state: GroupState): string {
  const { origin, pathname } = window.location;
  return origin + pathname + encodePrivateShareHash(state);
}

/** Decode a '#i=...' private hash. Returns null if the hash isn't one. */
export function decodePrivateShareHash(hash: string): PrivateShare | null {
  if (!hash.startsWith(PRIVATE_HASH_KEY)) return null;
  return decodeBlobToPrivate(hash.slice(PRIVATE_HASH_KEY.length));
}

function decodeBlobToGroup(b64: string): GroupState {
  let bytes: Uint8Array;
  try {
    bytes = decodeBlob(b64);
  } catch {
    throw new ShareDecodeError('This share link is damaged or truncated — ask for a fresh one.');
  }
  try {
    return binaryCodec.decodeGroup(bytes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('magic') || msg.includes('wire version')) {
      throw new ShareDecodeError('This link is from an older version of Reodite Schedules — ask your friend to refresh the app and copy a fresh one.');
    }
    throw new ShareDecodeError('This share link is damaged or truncated — ask for a fresh one.');
  }
}

function decodeBlobToPrivate(b64: string): PrivateShare {
  let bytes: Uint8Array;
  try {
    bytes = decodeBlob(b64);
  } catch {
    throw new ShareDecodeError('This private link is damaged or truncated — ask for a fresh one.');
  }
  try {
    return binaryCodec.decodePrivate(bytes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('magic') || msg.includes('wire version')) {
      throw new ShareDecodeError('This link is from an older version of Reodite Schedules — ask your friend to refresh the app and copy a fresh one.');
    }
    throw new ShareDecodeError('This private link is damaged or truncated — ask for a fresh one.');
  }
}
