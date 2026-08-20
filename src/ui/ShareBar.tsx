import { useRef } from 'react';
import { useStore } from '../state/store';
import { importIntoLibrary } from '../state/library';
import {
  buildPrivateShareUrl,
  buildShareUrl,
  encodePrivateShareHash,
  encodeShareHash,
  URL_WARN_LENGTH,
} from '../state/shareLink';
import { exportBackup, parseBackup } from '../state/fileBackup';
import { useToast } from './Toast';

export function ShareBar() {
  const { library, group, dispatch } = useStore();
  const toast = useToast();
  const importRef = useRef<HTMLInputElement>(null);
  const hasPeople = group.people.length > 0;

  async function copyLink(mode: 'public' | 'private') {
    const url = mode === 'public' ? buildShareUrl(group) : buildPrivateShareUrl(group);
    // Reflect what was copied in the address bar (without adding history entries).
    history.replaceState(null, '', mode === 'public' ? encodeShareHash(group) : encodePrivateShareHash(group));
    try {
      await navigator.clipboard.writeText(url);
      toast(
        mode === 'public'
          ? 'Public link copied — includes everyone’s schedules 📋'
          : 'Private link copied — ids only; it renders solely for people who already have these profiles 🔒',
      );
    } catch {
      toast('Could not access the clipboard — copy the address bar URL instead.', 'error');
    }
    if (mode === 'public' && url.length > URL_WARN_LENGTH) {
      toast('That link no longer fits one Discord message (2000 chars) — send it elsewhere or use Export JSON.', 'error');
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      const incoming = parseBackup(await file.text());
      const { outcome } = importIntoLibrary(library, incoming);
      dispatch({ type: 'importIncoming', incoming });
      if (outcome === 'full') {
        toast('Saved the people to your list, but the schedule cache is full (5/5) — delete one to cache this schedule.', 'error');
        return;
      }
      toast(
        outcome === 'added'
          ? `Saved new schedule "${incoming.name || 'Untitled'}" from file`
          : `Imported ${incoming.people.length} ${incoming.people.length === 1 ? 'person' : 'people'} from file`,
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Import failed.', 'error');
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn--primary"
        disabled={!hasPeople}
        title="Public link — carries everyone's full schedules"
        onClick={() => void copyLink('public')}
      >
        Copy share link
      </button>
      <button
        type="button"
        className="btn btn--icon sharebar-lock"
        disabled={!hasPeople}
        title="Copy private link — member ids only, no schedule data; it renders solely for people who already have these profiles"
        aria-label="Copy private share link"
        onClick={() => void copyLink('private')}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </button>
      <button type="button" className="btn" disabled={!hasPeople} onClick={() => exportBackup(group)}>
        Export
      </button>
      <button type="button" className="btn" onClick={() => importRef.current?.click()}>
        Import
      </button>
      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          void importFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </>
  );
}
