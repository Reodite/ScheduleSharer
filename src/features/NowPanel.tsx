import type { Person } from '../types';
import { whoIsFreeNow } from './whoIsFreeNow';
import { AvatarChip } from '../avatar/AvatarChip';
import { displayHandles } from '../state/merge';
import { minutesToFullLabel } from '../util/time';

interface Props {
  people: Person[];
  now: Date;
}

/** course titles can be long — clip for the one-line status row */
function shortTitle(title: string): string {
  return title.length > 26 ? `${title.slice(0, 24)}…` : title;
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
                {shortTitle(current.section.title)}
                {current.pattern.buildingCode ? ` · ${current.pattern.buildingCode} ${current.pattern.room ?? ''}` : ''}
                {` · til ${minutesToFullLabel(current.pattern.endMin)}`}
              </span>
            ) : (
              <span className="now-row__status now-row__status--free">
                free
                {next ? ` · ${shortTitle(next.section.title)} at ${minutesToFullLabel(next.pattern.startMin)}` : ' all day'}
              </span>
            )}
          </div>
          <span className={`now-dot ${current ? 'now-dot--busy' : 'now-dot--free'}`} />
        </div>
      ))}
    </div>
  );
}
