import { useState } from 'react';
import { MAX_GROUPS } from '../types';
import { useStore } from '../state/store';
import { AvatarChip } from '../avatar/AvatarChip';

interface Props {
  onClose: () => void;
}

export function ScheduleManager({ onClose }: Props) {
  const { library, dispatch } = useStore();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  function commitRename(groupId: string) {
    const name = draftName.trim();
    if (name) dispatch({ type: 'renameGroup', groupId, name });
    setRenaming(null);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          Schedules{' '}
          <span className="sched-count">
            {library.groups.length}/{MAX_GROUPS}
          </span>
        </h2>

        {library.groups.map((g) => {
          const active = g.groupId === library.activeId;
          const onlySchedule = library.groups.length === 1;
          const full = library.groups.length >= MAX_GROUPS;
          return (
            <div key={g.groupId} className={`sched-row${active ? ' sched-row--active' : ''}`}>
              <button
                type="button"
                className="sched-row__main"
                onClick={() => {
                  dispatch({ type: 'switchGroup', groupId: g.groupId });
                  onClose();
                }}
              >
                {renaming === g.groupId ? (
                  <input
                    type="text"
                    className="sched-row__rename"
                    value={draftName}
                    autoFocus
                    maxLength={32}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => commitRename(g.groupId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(g.groupId);
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <span className="sched-row__name">
                    {g.name || 'Untitled schedule'}
                    {active && <span className="sched-row__badge">current</span>}
                  </span>
                )}
                <span className="sched-row__crew">
                  {g.people.length === 0 ? (
                    <span className="sched-row__empty">empty</span>
                  ) : (
                    <>
                      {g.people.slice(0, 6).map((p) => (
                        <AvatarChip key={p.id} avatar={p.avatar} size={18} title={p.handle} />
                      ))}
                      <span className="sched-row__names">
                        {g.people.map((p) => p.handle).join(', ')}
                      </span>
                    </>
                  )}
                </span>
              </button>
              <div className="sched-row__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  title="Rename"
                  onClick={() => {
                    setDraftName(g.name);
                    setRenaming(g.groupId);
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  disabled={full}
                  title={
                    full
                      ? `Limit of ${MAX_GROUPS} schedules — delete one first`
                      : 'Duplicate — same people, but a new identity: its share links are independent of the original'
                  }
                  onClick={() => dispatch({ type: 'duplicateGroup', groupId: g.groupId })}
                >
                  ⧉
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon btn--danger"
                  title="Delete from this device"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete "${g.name || 'Untitled schedule'}" from this device? ` +
                          'Anyone with a share link still has their copy.',
                      )
                    ) {
                      dispatch({ type: 'deleteGroup', groupId: g.groupId });
                      if (onlySchedule) onClose();
                    }
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}

        <div className="modal__actions" style={{ justifyContent: 'space-between' }}>
          <button
            type="button"
            className="btn"
            disabled={library.groups.length >= MAX_GROUPS}
            title={library.groups.length >= MAX_GROUPS ? `Limit of ${MAX_GROUPS} schedules — delete one first` : undefined}
            onClick={() => {
              dispatch({ type: 'createGroup', name: `Schedule ${library.groups.length + 1}` });
              onClose();
            }}
          >
            + New schedule
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
