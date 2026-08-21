import type { GroupState, Person } from '../../types';
import type { PrivateShare } from '../binaryCodec';
import { parseV4Blob, parseV4PrivateBlob } from './v4';
import {
  encodeShareHash, buildShareUrl,
  encodeProfileHash, buildProfileUrl,
  encodePrivateShareHash, buildPrivateShareUrl,
  parseV5Blob, parseV5PrivateBlob,
  HASH_KEY, PROFILE_HASH_KEY, PRIVATE_HASH_KEY, LEGACY_HASH_KEY,
  URL_WARN_LENGTH,
} from './v5';

export { encodeShareHash, buildShareUrl, encodeProfileHash, buildProfileUrl, encodePrivateShareHash, buildPrivateShareUrl, URL_WARN_LENGTH };

export class ShareDecodeError extends Error {}

/** v5 high-base payloads carry non-ASCII CJK/Hangul/Yi codepoints; v4 base64url is pure ASCII. */
function isV5Payload(payload: string): boolean {
  for (let i = 0; i < payload.length; i++) {
    if (payload.charCodeAt(i) > 0x7f) return true;
  }
  return false;
}

function decodeBlobToGroup(payload: string): GroupState {
  return isV5Payload(payload) ? parseV5Blob(payload) : parseV4Blob(payload);
}

function decodeBlobToPrivate(payload: string): PrivateShare {
  return isV5Payload(payload) ? parseV5PrivateBlob(payload) : parseV4PrivateBlob(payload);
}

export function decodeShareHash(hash: string): GroupState | null {
  if (hash.startsWith(LEGACY_HASH_KEY)) {
    throw new ShareDecodeError('This link is from an older version of Reodite Schedules — ask your friend to refresh the app and copy a fresh one.');
  }
  if (!hash.startsWith(HASH_KEY)) return null;
  try {
    hash = decodeURIComponent(hash);
  } catch {
    throw new ShareDecodeError('This share link is damaged or truncated — ask for a fresh one.');
  }
  return decodeBlobToGroup(hash.slice(HASH_KEY.length));
}

export function decodeProfileHash(hash: string): Person | null {
  if (!hash.startsWith(PROFILE_HASH_KEY)) return null;
  try {
    hash = decodeURIComponent(hash);
  } catch {
    throw new ShareDecodeError('This profile link is damaged or truncated — ask for a fresh one.');
  }
  const state = decodeBlobToGroup(hash.slice(PROFILE_HASH_KEY.length));
  const person = state.people[0];
  if (!person) throw new ShareDecodeError('This profile link is damaged or truncated — ask for a fresh one.');
  return person;
}

export function decodePrivateShareHash(hash: string): PrivateShare | null {
  if (!hash.startsWith(PRIVATE_HASH_KEY)) return null;
  try {
    hash = decodeURIComponent(hash);
  } catch {
    throw new ShareDecodeError('This private link is damaged or truncated — ask for a fresh one.');
  }
  return decodeBlobToPrivate(hash.slice(PRIVATE_HASH_KEY.length));
}