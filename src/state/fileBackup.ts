import type { GroupState } from '../types';
import { SCHEMA_VERSION } from '../types';
import { normalizeGroup } from './normalize';

/**
 * JSON file export/import — the full-fidelity sharing path. Unlike share
 * links, exported files keep photo avatars and every schedule field.
 */

export function exportBackup(state: GroupState): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const slug = (state.name || 'schedule')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `schedulesharer-${slug || 'schedule'}-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export class BackupParseError extends Error {}

export function parseBackup(text: string): GroupState {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupParseError('That file is not valid JSON.');
  }
  const state = data as GroupState;
  if (typeof state?.schemaVersion !== 'number' || !Array.isArray(state?.people)) {
    throw new BackupParseError('That file is not a ScheduleSharer export.');
  }
  if (state.schemaVersion > SCHEMA_VERSION) {
    throw new BackupParseError('That file was made with a newer version of ScheduleSharer — refresh the app.');
  }
  for (const p of state.people) {
    if (typeof p?.id !== 'string' || typeof p?.handle !== 'string' || typeof p?.updatedAt !== 'string') {
      throw new BackupParseError('That file is missing person data.');
    }
  }
  // migrates v1 exports (course codes, per-meeting dates) to the current shape
  return normalizeGroup(state);
}
