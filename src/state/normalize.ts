import type { Group, GroupMember, GroupState, Library, MeetingPattern, Person, Section } from '../types';
import { MAX_GROUPS, SCHEMA_VERSION } from '../types';
import { computeSectionId } from '../parse/sectionId';

/**
 * Tolerant migration of stored GroupState (localStorage / JSON exports) to
 * the current schema. v1 sections carried courseCode/sectionLabel/status/
 * credits and per-meeting date ranges; v2 keeps title + component +
 * instructors + one section-level date range. Unknown fields are dropped,
 * ids are recomputed.
 */

function meetingKey(m: MeetingPattern): string {
  return [m.days.join(''), m.startMin, m.endMin, m.buildingCode ?? '', m.room ?? '', m.floor ?? ''].join(',');
}

function normalizeSection(raw: unknown): Section | null {
  const s = raw as Record<string, unknown>;
  if (!s || !Array.isArray(s.meetings)) return null;

  let termStart = typeof s.termStart === 'string' ? s.termStart : undefined;
  let termEnd = typeof s.termEnd === 'string' ? s.termEnd : undefined;

  const meetings: MeetingPattern[] = [];
  const seen = new Set<string>();
  for (const rawM of s.meetings) {
    const m = rawM as Record<string, unknown>;
    if (!Array.isArray(m.days) || typeof m.startMin !== 'number' || typeof m.endMin !== 'number') continue;
    // v1 meetings carried per-pattern dates — fold into the section range
    if (typeof m.startDate === 'string' && m.startDate && (!termStart || m.startDate < termStart)) {
      termStart = m.startDate;
    }
    if (typeof m.endDate === 'string' && m.endDate && (!termEnd || m.endDate > termEnd)) {
      termEnd = m.endDate;
    }
    const pattern: MeetingPattern = {
      days: m.days as MeetingPattern['days'],
      startMin: m.startMin,
      endMin: m.endMin,
      campus: typeof m.campus === 'string' ? m.campus : undefined,
      buildingName: typeof m.buildingName === 'string' ? m.buildingName : undefined,
      buildingCode: typeof m.buildingCode === 'string' ? m.buildingCode : undefined,
      floor: typeof m.floor === 'string' ? m.floor : undefined,
      room: typeof m.room === 'string' ? m.room : undefined,
      raw: typeof m.raw === 'string' ? m.raw : '',
    };
    const key = meetingKey(pattern);
    if (seen.has(key)) continue; // v1 reading-break splits collapse to one weekly pattern
    seen.add(key);
    meetings.push(pattern);
  }

  const base = {
    courseCode: typeof s.courseCode === 'string' ? s.courseCode : '',
    // v1 stored the title under courseTitle
    title: typeof s.title === 'string' ? s.title : typeof s.courseTitle === 'string' ? s.courseTitle : '',
    component: typeof s.component === 'string' ? s.component : '',
    instructors: Array.isArray(s.instructors) ? (s.instructors as string[]).filter((i) => typeof i === 'string') : [],
    termStart,
    termEnd,
    meetings,
  };
  if (!base.title && meetings.length === 0) return null;
  return { ...base, id: computeSectionId(base) };
}

export function normalizePerson(raw: unknown): Person | null {
  const p = raw as Record<string, unknown>;
  if (!p || typeof p.id !== 'string' || typeof p.handle !== 'string') return null;
  const sched = p.schedule as Record<string, unknown> | null | undefined;
  const sections = Array.isArray(sched?.sections)
    ? (sched.sections.map(normalizeSection).filter(Boolean) as Section[])
    : null;
  return {
    id: p.id,
    handle: p.handle,
    avatar: (p.avatar as Person['avatar']) ?? { kind: 'initials', initials: '??', color: '#8d97af' },
    schedule:
      sections && sched
        ? {
            sections,
            sourceFileName: typeof sched.sourceFileName === 'string' ? sched.sourceFileName : undefined,
            importedAt: typeof sched.importedAt === 'string' ? sched.importedAt : new Date(0).toISOString(),
          }
        : null,
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : new Date(0).toISOString(),
    enabled: p.enabled !== false,
  };
}

/**
 * Tolerant load of v3 storage (roster + member references). Duplicate
 * member references are dropped; DANGLING ones are kept — a private
 * (ids-only) link can reference people who haven't been imported yet, and
 * those pending members must survive reloads so they fill in when their
 * profiles arrive. Returns null when the shape is unusable so the caller
 * can fall back to migration or a fresh library.
 */
export function normalizeLibrary(raw: unknown): Library | null {
  const l = raw as Record<string, unknown>;
  if (!l || !Array.isArray(l.people) || !Array.isArray(l.groups) || l.groups.length === 0) return null;

  const people = l.people.map(normalizePerson).filter(Boolean) as Person[];
  const ids = new Set(people.map((p) => p.id));

  const groups: Group[] = [];
  for (const rawG of l.groups.slice(0, MAX_GROUPS)) {
    const g = rawG as Record<string, unknown>;
    if (!g || typeof g.groupId !== 'string' || !g.groupId) continue;
    const seen = new Set<string>();
    const members: GroupMember[] = [];
    if (Array.isArray(g.members)) {
      for (const rawM of g.members) {
        const m = rawM as Record<string, unknown>;
        if (!m || typeof m.personId !== 'string' || seen.has(m.personId)) continue;
        seen.add(m.personId);
        members.push({ personId: m.personId, enabled: m.enabled !== false });
      }
    }
    groups.push({ groupId: g.groupId, name: typeof g.name === 'string' ? g.name : '', members });
  }
  if (groups.length === 0) return null;

  const activeId = groups.some((g) => g.groupId === l.activeId) ? (l.activeId as string) : groups[0].groupId;
  const pinnedIds = Array.isArray(l.pinnedIds)
    ? (l.pinnedIds as unknown[]).filter((id): id is string => typeof id === 'string' && ids.has(id))
    : [];
  return { activeId, people, groups, pinnedIds };
}

export function normalizeGroup(raw: unknown): GroupState {
  const g = raw as Record<string, unknown>;
  const people = Array.isArray(g?.people)
    ? (g.people.map(normalizePerson).filter(Boolean) as Person[])
    : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    // pre-v4 data has no group identity — empty id routes into the active schedule
    groupId: typeof g?.groupId === 'string' ? g.groupId : '',
    name: typeof g?.name === 'string' ? g.name : '',
    people,
  };
}
