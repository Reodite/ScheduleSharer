import { useRef } from 'react';
import { useStore } from '../state/store';
import { buildShareUrl, encodeShareHash, URL_WARN_LENGTH } from '../state/shareLink';
import { exportBackup, parseBackup } from '../state/fileBackup';
import { useToast } from './Toast';

export function ShareBar() {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const importRef = useRef<HTMLInputElement>(null);
  const hasPeople = state.people.length > 0;

  async function copyLink() {
    const url = buildShareUrl(state);
    // Reflect what was copied in the address bar (without adding history entries).
    history.replaceState(null, '', encodeShareHash(state));
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
      dispatch({ type: 'mergeIncoming', incoming });
      toast(`Imported ${incoming.people.length} ${incoming.people.length === 1 ? 'person' : 'people'} from file`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Import failed.', 'error');
    }
  }

  return (
    <>
      <button type="button" className="btn btn--primary" disabled={!hasPeople} onClick={() => void copyLink()}>
        Copy share link
      </button>
      <button type="button" className="btn" disabled={!hasPeople} onClick={() => exportBackup(state)}>
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
