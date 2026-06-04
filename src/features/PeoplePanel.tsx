import { useRef, useState } from 'react';
import type { Person } from '../types';
import { useStore } from '../state/store';
import { displayHandles } from '../state/merge';
import { AvatarChip } from '../avatar/AvatarChip';
import { parseScheduleXlsx } from '../parse/scheduleParser';
import { useToast } from '../ui/Toast';

interface Props {
  onEdit: (person: Person) => void;
}

export function PeoplePanel({ onEdit }: Props) {
  const { group, dispatch } = useStore();
  const toast = useToast();
  const reuploadRef = useRef<HTMLInputElement>(null);
  const [reuploadFor, setReuploadFor] = useState<string | null>(null);

  if (group.people.length === 0) return null;

  const names = displayHandles(group.people);
  const allOn = group.people.every((p) => p.enabled);

  async function handleReupload(file: File | undefined) {
    if (!file || !reuploadFor) return;
    const person = group.people.find((p) => p.id === reuploadFor);
    try {
      const schedule = parseScheduleXlsx(await file.arrayBuffer(), file.name);
      dispatch({ type: 'replaceSchedule', id: reuploadFor, schedule });
      toast(`${person?.handle ?? 'Schedule'} updated · ${schedule.sections.length} sections`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not parse that file.', 'error');
    } finally {
      setReuploadFor(null);
    }
  }

  return (
    <div className="panel">
      <h3 className="panel__title">
        Crew · {group.people.length}
        {!allOn && (
          <button type="button" className="btn btn--ghost btn--icon" onClick={() => dispatch({ type: 'enableAll' })}>
            show all
          </button>
        )}
      </h3>
      {group.people.map((p) => (
        <div key={p.id} className={`person${p.enabled ? '' : ' person--off'}`}>
          <AvatarChip avatar={p.avatar} size={30} title={names.get(p.id)} />
          <div
            className="person__main"
            title="Click to show/hide on the calendar"
            onClick={() => dispatch({ type: 'togglePerson', id: p.id, enabled: !p.enabled })}
          >
            <span className="person__handle">{names.get(p.id)}</span>
            <span className="person__meta">
              {p.schedule
                ? `${new Set(p.schedule.sections.map((s) => s.courseCode || s.title)).size} courses`
                : 'no schedule yet'}
            </span>
          </div>
          <div className="person__actions">
            <button type="button" className="btn btn--ghost btn--icon" title="Edit handle / avatar" onClick={() => onEdit(p)}>
              ✎
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              title="Replace schedule (new .xlsx)"
              onClick={() => {
                setReuploadFor(p.id);
                reuploadRef.current?.click();
              }}
            >
              ⟳
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--danger"
              title="Remove from group"
              onClick={() => {
                if (window.confirm(`Remove ${p.handle} and their schedule from this calendar?`)) {
                  dispatch({ type: 'removePerson', id: p.id });
                }
              }}
            >
              ×
            </button>
          </div>
        </div>
      ))}
      <input
        ref={reuploadRef}
        type="file"
        accept=".xlsx"
        hidden
        onChange={(e) => {
          void handleReupload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
