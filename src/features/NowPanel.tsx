import type { Person } from '../types';
import { whoIsFreeNow } from './whoIsFreeNow';
import { AvatarChip } from '../avatar/AvatarChip';
import { displayHandles } from '../state/merge';
import { minutesToFullLabel } from '../util/time';

interface Props {
  people: Person[];
  now: Date;
}

/** prefer the compact code; clip a code-less title for the one-line row */
function shortLabel(section: { courseCode: string; title: string }): string {
  if (section.courseCode) return section.courseCode.replace(/_V(?=\s)/, '');
  return section.title.length > 26 ? `${section.title.slice(0, 24)}…` : section.title;
}

export function NowPanel({ people, now }: Props) {
  const withSchedules = people.filter((p) => p.schedule);
  if (withSchedules.length === 0) return null;

  const statuses = whoIsFreeNow(withSchedules, now);
  const names = displayHandles(people);

  return (
    <div className="panel">
      <h3 className="panel__title">
        Right now
        <span style={{ fontWeight: 400 }}>
          {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </span>
      </h3>
      {statuses.map(({ person, current, next }) => (
        <div key={person.id} className="now-row">
          <AvatarChip avatar={person.avatar} size={24} title={names.get(person.id)} />
          <div className="now-row__body">
            <span className="now-row__handle">{names.get(person.id)}</span>
            {current ? (
              <span className="now-row__status now-row__status--busy">
                {shortLabel(current.section)}
                {current.pattern.buildingCode ? ` · ${current.pattern.buildingCode} ${current.pattern.room ?? ''}` : ''}
                {` · til ${minutesToFullLabel(current.pattern.endMin)}`}
              </span>
            ) : (
              <span className="now-row__status now-row__status--free">
                free
                {next ? ` · ${shortLabel(next.section)} at ${minutesToFullLabel(next.pattern.startMin)}` : ' all day'}
              </span>
            )}
          </div>
          <span className={`now-dot ${current ? 'now-dot--busy' : 'now-dot--free'}`} />
        </div>
      ))}
    </div>
  );
}
