import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { displayHandles } from '../state/merge';
import { buildProfileUrl } from '../state/shareLink';
import { AvatarChip } from '../avatar/AvatarChip';
import { SchedulePreview } from './SchedulePreview';
import { useToast } from './Toast';
import { MAX_GROUPS } from '../types';
import type { Person } from '../types';

interface Props {
  onClose: () => void;
}

/**
 * Full-page roster (#people): everyone ever imported on this device. Search
 * by name or course, pin favorites, copy profile links, hover a row for a
 * week-at-a-glance preview — and BUILD schedules: select people, name the
 * schedule, create it (or add the selection to the current schedule).
 */
export function PeoplePage({ onClose }: Props) {
  const { library, group, dispatch } = useStore();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState('');
  const [preview, setPreview] = useState<{ person: Person; anchor: { top: number; left: number; right: number } } | null>(null);

  // fixed full-screen page — lock the calendar's scrollbar away while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const names = displayHandles(library.people);
  const memberIds = new Set(group.people.map((p) => p.id));
  const pinned = new Set(library.pinnedIds);
  const atCap = library.groups.length >= MAX_GROUPS;
  const groupsOf = (personId: string) =>
    library.groups.filter((g) => g.members.some((m) => m.personId === personId));

  const q = query.trim().toLowerCase();
  const matches = (p: Person) =>
    !q ||
    p.handle.toLowerCase().includes(q) ||
    (p.schedule?.sections.some(
      (s) => s.courseCode.toLowerCase().includes(q) || s.title.toLowerCase().includes(q),
    ) ?? false);

  // pinned first (in pin order), then everyone else in roster order
  const rows = [
    ...(library.pinnedIds.map((id) => library.people.find((p) => p.id === id)).filter(Boolean) as Person[]),
    ...library.people.filter((p) => !pinned.has(p.id)),
  ].filter(matches);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function createSchedule() {
    if (selected.size === 0 || atCap) return;
    const name = newName.trim() || `Schedule ${library.groups.length + 1}`;
    dispatch({ type: 'createGroupWithMembers', name, personIds: [...selected] });
    toast(`Created "${name}" with ${selected.size} ${selected.size === 1 ? 'person' : 'people'} 🎉`);
    onClose();
  }

  function addToCurrent() {
    if (selected.size === 0) return;
    const fresh = [...selected].filter((id) => !memberIds.has(id));
    for (const id of fresh) dispatch({ type: 'addToGroup', personId: id });
    toast(
      fresh.length > 0
        ? `Added ${fresh.length} ${fresh.length === 1 ? 'person' : 'people'} to "${group.name || 'Untitled schedule'}"`
        : 'Everyone selected is already in this schedule',
    );
    onClose();
  }

  async function copyProfileLink(p: Person) {
    try {
      await navigator.clipboard.writeText(buildProfileUrl(p));
      toast(`${p.handle}'s profile link copied — it shares just their schedule 📋`);
    } catch {
      toast('Could not access the clipboard.', 'error');
    }
  }

  return (
    <div className="peoplepage">
      <header className="peoplepage__head">
        <button type="button" className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Back to calendar" title="Back to calendar">
          ←
        </button>
        <div className="peoplepage__title">
          Your <em>people</em>
          <span className="peoplepage__count">{library.people.length}</span>
        </div>
        {library.people.length > 0 && (
          <input
            type="text"
            className="people-search"
            placeholder="Search by name or course…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </header>

      <div className="peoplepage__body">
        <div className="peoplepage__list">
          {library.people.length === 0 && (
            <p className="people-empty">
              No one saved yet — drop a schedule export on the main page, or open a share or profile link
              from a friend. Everyone you import collects here, ready to be added to any schedule.
            </p>
          )}
          {library.people.length > 0 && rows.length === 0 && (
            <p className="people-empty">No one matches “{query.trim()}”.</p>
          )}

          {rows.map((p) => {
            const isSelected = selected.has(p.id);
            const isPinned = pinned.has(p.id);
            const inGroup = memberIds.has(p.id);
            const inGroups = groupsOf(p.id);
            const displayName = names.get(p.id) ?? p.handle;
            return (
              <div
                key={p.id}
                className={`person person--roster${isSelected ? ' person--selected' : ''}`}
                onMouseEnter={(e) => {
                  const row = e.currentTarget.getBoundingClientRect();
                  const box = e.currentTarget.closest('.peoplepage__list')?.getBoundingClientRect() ?? row;
                  setPreview({ person: p, anchor: { top: row.top, left: box.left, right: box.right } });
                }}
                onMouseLeave={() => setPreview(null)}
              >
                <button
                  type="button"
                  className={`btn btn--ghost btn--icon person__focus${isSelected ? ' person__focus--active' : ''}`}
                  title={isSelected ? 'Deselect' : 'Select for a new schedule'}
                  aria-pressed={isSelected}
                  onClick={() => toggleSelect(p.id)}
                >
                  <span className="person__focus-mark" aria-hidden="true" />
                </button>
                <AvatarChip avatar={p.avatar} size={30} title={displayName} />
                <div className="person__main" onClick={() => toggleSelect(p.id)} title={isSelected ? 'Deselect' : 'Select for a new schedule'}>
                  <span className="person__handle">
                    {isPinned && <span className="person__pinmark" aria-label="Pinned">📌</span>}
                    {displayName}
                    {inGroup && <span className="person__ingroup">in “{group.name || 'Untitled schedule'}”</span>}
                  </span>
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
                    className={`btn btn--ghost btn--icon${isPinned ? ' person__pin--active' : ''}`}
                    title={isPinned ? 'Unpin' : 'Pin to the top of this list'}
                    onClick={() => dispatch({ type: 'togglePin', personId: p.id })}
                  >
                    {isPinned ? '📌' : '📍'}
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
                        setPreview(null);
                        setSelected((prev) => {
                          const next = new Set(prev);
                          next.delete(p.id);
                          return next;
                        });
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
        </div>
      </div>

      {library.people.length > 0 && (
        <footer className="peoplepage__builder">
          <span className="peoplepage__selcount">
            {selected.size === 0
              ? 'Select people to build a schedule'
              : `${selected.size} selected`}
          </span>
          <input
            type="text"
            className="peoplepage__name"
            placeholder="New schedule name"
            maxLength={32}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createSchedule();
            }}
          />
          <button
            type="button"
            className="btn btn--primary"
            disabled={selected.size === 0 || atCap}
            title={atCap ? `Limit of ${MAX_GROUPS} schedules — delete one first` : undefined}
            onClick={createSchedule}
          >
            Create schedule
          </button>
          <button type="button" className="btn" disabled={selected.size === 0} onClick={addToCurrent}>
            Add to “{group.name || 'Untitled schedule'}”
          </button>
          {selected.size > 0 && (
            <button type="button" className="btn btn--ghost" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          )}
        </footer>
      )}

      {preview && <SchedulePreview person={preview.person} anchor={preview.anchor} />}
    </div>
  );
}
