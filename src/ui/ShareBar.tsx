import { useRef } from 'react';
import { useStore } from '../state/store';
import { importIntoLibrary } from '../state/library';
import { buildShareUrl, encodeShareHash, URL_WARN_LENGTH } from '../state/shareLink';
import { exportBackup, parseBackup } from '../state/fileBackup';
import { useToast } from './Toast';

export function ShareBar() {
  const { library, group, dispatch } = useStore();
  const toast = useToast();
  const importRef = useRef<HTMLInputElement>(null);
  const hasPeople = group.people.length > 0;

  async function copyLink() {
    const url = buildShareUrl(group);
    // Reflect what was copied in the address bar (without adding history entries).
    history.replaceState(null, '', encodeShareHash(group));
    try {
      await navigator.clipboard.writeText(url);
      toast('Share link copied — paste it in the group chat 📋');
    } catch {
      toast('Could not access the clipboard — copy the address bar URL instead.', 'error');
    }
    if (url.length > URL_WARN_LENGTH) {
      toast('That link is getting long — some chat apps may cut it. Consider Export JSON.', 'error');
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      const incoming = parseBackup(await file.text());
      const { outcome } = importIntoLibrary(library, incoming);
      if (outcome === 'full') {
        toast('Schedule cache is full (5/5) — delete one from the schedule menu first.', 'error');
        return;
      }
      dispatch({ type: 'importIncoming', incoming });
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
      <button type="button" className="btn btn--primary" disabled={!hasPeople} onClick={() => void copyLink()}>
        Copy share link
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
