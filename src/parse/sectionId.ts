import type { MeetingPattern, Section } from '../types';
import { fnv1a } from '../util/hash';

function meetingSignature(m: MeetingPattern): string {
  return [m.days.join(''), m.startMin, m.endMin, m.buildingCode ?? '', m.room ?? ''].join(',');
}

/**
 * Deterministic identity for a section across different people's uploads.
 * Two friends registered in the same class produce the same id, which is
 * what lets the calendar render ONE block with both their avatars — and lets
 * share links store the section data once for the whole group.
 * Dates are deliberately excluded: title + component + weekly slot + room is
 * the identity, so the same class survives a link round-trip (which strips
 * per-meeting dates) without splitting into two blocks.
 */
export function computeSectionId(s: Omit<Section, 'id'>): string {
  const sig = [s.title, s.component, ...s.meetings.map(meetingSignature).sort()].join('|');
  return fnv1a(sig);
}
