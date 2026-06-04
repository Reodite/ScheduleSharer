import type { DayCode } from '../types';
import type { CalendarModel, MergedBlock } from './buildCalendar';
import type { FreeInterval } from '../features/freeTime';
import { Block } from './Block';
import { dayCodeOf, minutesNow, minutesToFullLabel } from '../util/time';

const PX_PER_MIN = 1.06;

interface Props {
  model: CalendarModel;
  freeBands: FreeInterval[];
  now: Date;
  /** whether 'now' falls inside the selected term (controls the now-line) */
  termIsLive: boolean;
  /** day pinned by the mobile day-tabs; ignored by desktop CSS */
  activeDay: DayCode;
  onBlockClick: (block: MergedBlock) => void;
}

export function WeekGrid({ model, freeBands, now, termIsLive, activeDay, onBlockClick }: Props) {
  const { days, dayStartMin, dayEndMin, blocksByDay } = model;
  const bodyHeight = (dayEndMin - dayStartMin) * PX_PER_MIN;
  const hourPx = 60 * PX_PER_MIN;

  const today = dayCodeOf(now);
  const nowTop = (minutesNow(now) - dayStartMin) * PX_PER_MIN;
  const showNowLine = termIsLive && nowTop >= 0 && nowTop <= bodyHeight;

  const hours: number[] = [];
  for (let m = dayStartMin + 60; m < dayEndMin; m += 60) hours.push(m);

  return (
    <div className="calendar">
      <div className="cal-head">
        <div className="cal-head__gutter" />
        {days.map((day) => (
          <div
            key={day}
            className={`cal-head__day${day === today && termIsLive ? ' cal-head__day--today' : ''}${day === activeDay ? ' cal-head__day--active' : ''}`}
          >
            {day}
          </div>
        ))}
      </div>
      <div className="cal-body" style={{ height: bodyHeight }}>
        <div className="cal-gutter">
          {hours.map((m) => (
            <span key={m} className="cal-gutter__label" style={{ top: (m - dayStartMin) * PX_PER_MIN }}>
              {minutesToFullLabel(m).replace(':00', '')}
            </span>
          ))}
        </div>
        {days.map((day) => (
          <div
            key={day}
            className={`cal-day${day === activeDay ? ' cal-day--active' : ''}`}
            style={{ '--hour-px': `${hourPx}px` } as React.CSSProperties}
          >
            {freeBands
              .filter((f) => f.day === day)
              .map((f) => (
                <div
                  key={`${f.day}-${f.startMin}`}
                  className="free-band"
                  style={{
                    top: (f.startMin - dayStartMin) * PX_PER_MIN,
                    height: (f.endMin - f.startMin) * PX_PER_MIN,
                  }}
                  title={`Everyone's free ${minutesToFullLabel(f.startMin)}–${minutesToFullLabel(f.endMin)}`}
                />
              ))}
            {(blocksByDay.get(day) ?? []).map((block) => (
              <Block
                key={block.key}
                block={block}
                top={(block.startMin - dayStartMin) * PX_PER_MIN}
                height={(block.endMin - block.startMin) * PX_PER_MIN}
                onClick={onBlockClick}
              />
            ))}
            {showNowLine && day === today && <div className="now-line" style={{ top: nowTop }} />}
          </div>
        ))}
      </div>
    </div>
  );
}
