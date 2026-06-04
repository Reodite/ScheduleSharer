import { useState } from 'react';
import type { Avatar, Person, Schedule } from '../types';
import { AvatarChip } from '../avatar/AvatarChip';
import { AvatarPicker } from '../avatar/AvatarPicker';
import { colorFor, initialsFor } from '../avatar/avatarUtils';

export interface ProfileDraft {
  /** present when adding a new person from a fresh upload */
  schedule?: Schedule;
  /** present when editing an existing person */
  person?: Person;
}

interface Props {
  draft: ProfileDraft;
  takenHandles: string[];
  onSave: (handle: string, avatar: Avatar) => void;
  onCancel: () => void;
}

export function ProfileModal({ draft, takenHandles, onSave, onCancel }: Props) {
  const editing = draft.person;
  const [handle, setHandle] = useState(editing?.handle ?? '');
  const [avatar, setAvatar] = useState<Avatar>(
    editing?.avatar ?? { kind: 'initials', initials: '??', color: colorFor('new') },
  );
  const [touched, setTouched] = useState(!!editing);
  const [error, setError] = useState('');

  // Until the user explicitly picks an avatar, initials track the handle.
  const liveAvatar: Avatar =
    !touched && avatar.kind === 'initials' && handle.trim()
      ? { kind: 'initials', initials: initialsFor(handle), color: colorFor(handle) }
      : avatar;

  const sectionCount = (editing ? editing.schedule?.sections.length : draft.schedule?.sections.length) ?? 0;
  const courseCount = new Set(
    (editing ? editing.schedule?.sections : draft.schedule?.sections)?.map((s) => s.title) ?? [],
  ).size;

  function save() {
    const trimmed = handle.trim();
    if (!trimmed) {
      setError('Pick a handle.');
      return;
    }
    if (takenHandles.some((h) => h.toLowerCase() === trimmed.toLowerCase())) {
      setError('That handle is taken in this group — pick another.');
      return;
    }
    onSave(trimmed, liveAvatar);
  }

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{editing ? `Edit ${editing.handle}` : 'Who is this schedule for?'}</h2>

        <div className="modal__preview">
          <AvatarChip avatar={liveAvatar} size={40} />
          <div>
            <div style={{ fontWeight: 700 }}>{handle.trim() || '—'}</div>
            <div className="modal__preview-meta">
              {courseCount} courses · {sectionCount} sections
            </div>
          </div>
        </div>

        <div className="field">
          <label>Handle</label>
          <input
            type="text"
            value={handle}
            autoFocus
            maxLength={24}
            placeholder="e.g. max"
            onChange={(e) => {
              setHandle(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </div>

        {error && <div className="modal__error">{error}</div>}

        <AvatarPicker
          handle={handle}
          avatar={liveAvatar}
          onChange={(a) => {
            setAvatar(a);
            setTouched(true);
          }}
        />

        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={save}>
            {editing ? 'Save' : 'Add to calendar'}
          </button>
        </div>
      </div>
    </div>
  );
}
