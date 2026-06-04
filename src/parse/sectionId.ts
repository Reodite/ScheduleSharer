import type { MeetingPattern, Section } from '../types';
import { fnv1a } from '../util/hash';

function meetingSignature(m: MeetingPattern): string {
  return [m.days.join(''), m.startMin, m.endMin, m.startDate, m.endDate, m.buildingCode ?? '', m.room ?? ''].join(',');
}

/**
 * Deterministic identity for a section across different people's uploads.
 * Two friends registered in the same official section produce the same id,
 * which is what lets the calendar render ONE block with both their avatars.
 * Meetings are part of the signature so sections that merely share a label
 * but meet differently never merge.
 */
export function computeSectionId(s: Omit<Section, 'id'>): string {
  const sig = [
    s.courseCode,
    s.sectionCode,
    s.component,
    ...s.meetings.map(meetingSignature).sort(),
  ].join('|');
  return fnv1a(sig);
}
