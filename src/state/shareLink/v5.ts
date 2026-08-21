import type { GroupState, Person } from '../../types';
import { binaryCodec, encodeV5Payload, decodeV5Payload } from '../binaryCodec';
import type { PrivateShare } from '../binaryCodec';

const HASH_KEY = '#e=';
const PROFILE_HASH_KEY = '#p=';
const PRIVATE_HASH_KEY = '#i=';
const LEGACY_HASH_KEY = '#d=';

export const URL_WARN_LENGTH = 2000;

export function encodeShareHash(state: GroupState): string {
  return HASH_KEY + encodeV5Payload(binaryCodec.encodeGroup(state));
}

export function buildShareUrl(state: GroupState): string {
  const { origin, pathname } = window.location;
  return origin + pathname + encodeShareHash(state);
}

export function encodeProfileHash(person: Person): string {
  const wrapped: GroupState = { schemaVersion: 5, groupId: '', name: '', people: [person] };
  return PROFILE_HASH_KEY + encodeV5Payload(binaryCodec.encodeGroup(wrapped));
}

export function buildProfileUrl(person: Person): string {
  const { origin, pathname } = window.location;
  return origin + pathname + encodeProfileHash(person);
}

export function encodePrivateShareHash(state: GroupState): string {
  const payload = binaryCodec.encodePrivate(state.groupId, state.name, state.people.map((p) => p.id));
  return PRIVATE_HASH_KEY + encodeV5Payload(payload);
}

export function buildPrivateShareUrl(state: GroupState): string {
  const { origin, pathname } = window.location;
  return origin + pathname + encodePrivateShareHash(state);
}

export function parseV5Blob(payload: string): GroupState {
  return binaryCodec.parseV5(decodeV5Payload(payload));
}

export function parseV5PrivateBlob(payload: string): PrivateShare {
  return binaryCodec.parseV5Private(decodeV5Payload(payload));
}

export { HASH_KEY, PROFILE_HASH_KEY, PRIVATE_HASH_KEY, LEGACY_HASH_KEY };