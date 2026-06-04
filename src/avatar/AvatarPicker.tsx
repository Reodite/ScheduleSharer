import { useRef, useState } from 'react';
import type { Avatar } from '../types';
import { AVATAR_COLORS, AVATAR_EMOJI, downscaleImage, initialsFor } from './avatarUtils';
import { useToast } from '../ui/Toast';

interface Props {
  handle: string;
  avatar: Avatar;
  onChange: (avatar: Avatar) => void;
}

type Tab = 'emoji' | 'initials' | 'photo';

export function AvatarPicker({ handle, avatar, onChange }: Props) {
  const [tab, setTab] = useState<Tab>(avatar.kind === 'image' ? 'photo' : avatar.kind);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const setColor = (color: string) => onChange({ ...avatar, color });

  return (
    <div className="field">
      <label>Avatar</label>
      <div className="avatar-tabs">
        {(['emoji', 'initials', 'photo'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`btn btn--icon${tab === t ? ' btn--primary' : ''}`}
            onClick={() => {
              setTab(t);
              if (t === 'initials') {
                onChange({ kind: 'initials', initials: initialsFor(handle || '??'), color: avatar.color });
              }
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'emoji' && (
        <div className="avatar-grid">
          {AVATAR_EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              className={avatar.kind === 'emoji' && avatar.emoji === e ? 'sel' : ''}
              onClick={() => onChange({ kind: 'emoji', emoji: e, color: avatar.color })}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {tab === 'photo' && (
        <>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            {avatar.imageDataUrl ? 'Replace photo' : 'Upload photo'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                const imageDataUrl = await downscaleImage(file);
                onChange({
                  kind: 'image',
                  imageDataUrl,
                  initials: initialsFor(handle || '??'),
                  color: avatar.color,
                });
              } catch {
                toast('Could not read that image.', 'error');
              }
            }}
          />
          <div className="modal__preview-meta" style={{ marginTop: 8 }}>
            Photos stay on this device and in JSON exports — share links show your initials instead.
          </div>
        </>
      )}

      <div className="swatches">
        {AVATAR_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch${avatar.color === c ? ' sel' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
            aria-label={`color ${c}`}
          />
        ))}
      </div>
    </div>
  );
}
