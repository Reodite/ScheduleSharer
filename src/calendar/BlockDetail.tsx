import type { MergedBlock } from './buildCalendar';
import { courseColor } from './colors';
import { displayCode } from './Block';
import { AvatarChip } from '../avatar/AvatarChip';
import { minutesToFullLabel } from '../util/time';

interface Props {
  block: MergedBlock;
  onClose: () => void;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function BlockDetail({ block, onClose }: Props) {
  const s = block.section;
  const color = courseColor(s);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="detail__head">
          <span className="detail__swatch" style={{ background: color }} />
          <h2 className="detail__title">
            {s.courseCode ? `${displayCode(s)} — ${s.title}` : s.title}
          </h2>
        </div>
        <div className="detail__sub">
          {s.component}
          {s.termStart && s.termEnd ? ` · ${fmtDate(s.termStart)} → ${fmtDate(s.termEnd)}` : ''}
        </div>

        <div className="detail__rows">
          {s.instructors.length > 0 && (
            <div className="detail__row">
              <dt>Taught by</dt>
              <dd>{s.instructors.join(', ')}</dd>
            </div>
          )}

          <div className="detail__row">
            <dt>Meets</dt>
            <dd>
              {s.meetings.map((m, i) => (
                <div key={i} className="mono">
                  {m.days.join(' ')} {minutesToFullLabel(m.startMin)}–{minutesToFullLabel(m.endMin)}
                </div>
              ))}
            </dd>
          </div>

          {(block.pattern.buildingName || block.pattern.room) && (
            <div className="detail__row">
              <dt>Where</dt>
              <dd>
                {block.pattern.buildingName}
                {block.pattern.buildingCode ? ` (${block.pattern.buildingCode})` : ''}
                {block.pattern.floor ? ` · floor ${block.pattern.floor}` : ''}
                {block.pattern.room ? ` · room ${block.pattern.room}` : ''}
              </dd>
            </div>
          )}

          <div className="detail__row">
            <dt>Who</dt>
            <dd className="detail__people">
              {block.people.map((p) => (
                <span key={p.id} className="detail__person">
                  <AvatarChip avatar={p.avatar} size={22} />
                  {p.handle}
                </span>
              ))}
            </dd>
          </div>
        </div>

        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
