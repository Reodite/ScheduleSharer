import { useStore } from '../state/store';
import { displayHandles } from '../state/merge';
import { buildProfileUrl } from '../state/shareLink';
import { AvatarChip } from '../avatar/AvatarChip';
import { useToast } from './Toast';
import type { Person } from '../types';

interface Props {
  onClose: () => void;
}

/**
 * The roster: everyone ever imported on this device, independent of which
 * schedules they're in. Add them to the current schedule, copy their
 * profile link, or remove them from the device entirely.
 */
export function PeopleManager({ onClose }: Props) {
  const { library, group, dispatch } = useStore();
  const toast = useToast();

  const names = displayHandles(library.people);
  const memberIds = new Set(group.people.map((p) => p.id));
  const groupsOf = (personId: string) =>
    library.groups.filter((g) => g.members.some((m) => m.personId === personId));

  async function copyProfileLink(p: Person) {
    try {
      await navigator.clipboard.writeText(buildProfileUrl(p));
      toast(`${p.handle}'s profile link copied — it shares just their schedule 📋`);
    } catch {
      toast('Could not access the clipboard.', 'error');
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          People <span className="sched-count">{library.people.length}</span>
        </h2>

        {library.people.length === 0 && (
          <p className="people-empty">
            No one saved yet — drop a schedule export on the main page, or open a share or profile link
            from a friend. Everyone you import collects here, ready to be added to any schedule.
          </p>
        )}

        {library.people.map((p) => {
          const inGroup = memberIds.has(p.id);
          const inGroups = groupsOf(p.id);
          const displayName = names.get(p.id) ?? p.handle;
          return (
            <div key={p.id} className="person person--roster">
              <AvatarChip avatar={p.avatar} size={30} title={displayName} />
              <div className="person__main person__main--static">
                <span className="person__handle">{displayName}</span>
                <span className="person__meta">
                  {p.schedule
                    ? (() => {
                        const n = new Set(p.schedule.sections.map((s) => s.courseCode || s.title)).size;
                        return `${n} ${n === 1 ? 'course' : 'courses'}`;
                      })()
                    : 'no schedule yet'}
                  {' · '}
                  {inGroups.length === 0
                    ? 'in no schedules'
                    : `in ${inGroups.length} ${inGroups.length === 1 ? 'schedule' : 'schedules'}`}
                </span>
              </div>
              <div className="person__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  disabled={inGroup}
                  title={
                    inGroup
                      ? `Already in "${group.name || 'Untitled schedule'}"`
                      : `Add to "${group.name || 'Untitled schedule'}"`
                  }
                  onClick={() => {
                    dispatch({ type: 'addToGroup', personId: p.id });
                    toast(`${p.handle} added to "${group.name || 'Untitled schedule'}"`);
                  }}
                >
                  {inGroup ? '✓' : '＋'}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  title="Copy profile link — shares just this person's schedule"
                  onClick={() => void copyProfileLink(p)}
                >
                  🔗
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon btn--danger"
                  title="Remove from this device"
                  onClick={() => {
                    const n = groupsOf(p.id).length;
                    if (
                      window.confirm(
                        `Remove ${p.handle} from your people? ` +
                          (n > 0
                            ? `They'll also be removed from ${n} ${n === 1 ? 'schedule' : 'schedules'} on this device.`
                            : 'They are in no schedules.'),
                      )
                    ) {
                      dispatch({ type: 'removeFromRoster', personId: p.id });
                    }
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}

        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
