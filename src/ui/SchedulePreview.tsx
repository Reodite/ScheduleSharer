import { useMemo } from 'react';
import type { DayCode, Person } from '../types';
import { DAY_ORDER } from '../types';
import { expandBlocks } from '../calendar/buildCalendar';
import { deriveTerms, defaultTermKey } from '../features/terms';
import { courseColor } from '../calendar/colors';
import { toISODate } from '../util/time';

interface Props {
  person: Person;
  /** viewport-fixed anchor: the preview sits beside this rect */
  anchor: { top: number; left: number; right: number };
}

const PREVIEW_W = 240;
const GRID_H = 150;

/**
 * Tiny week-at-a-glance popover shown when hovering a person: their current
 * term's meetings as colored blocks. Pure display — no interaction.
 */
export function SchedulePreview({ person, anchor }: Props) {
  const view = useMemo(() => {
    const one = [{ ...person, enabled: true }];
    const terms = deriveTerms(one);
    const key = defaultTermKey(terms, toISODate(new Date()));
    const term = terms.find((t) => t.key === key) ?? null;
    const blocks = expandBlocks(one, term);
    const days: DayCode[] = DAY_ORDER.slice(0, blocks.some((b) => b.day === 'Sat' || b.day === 'Sun') ? 7 : 5);
    let minMin = Infinity;
    let maxMin = -Infinity;
    for (const b of blocks) {
      if (b.startMin < minMin) minMin = b.startMin;
      if (b.endMin > maxMin) maxMin = b.endMin;
    }
    if (blocks.length === 0) {
      minMin = 9 * 60;
      maxMin = 17 * 60;
    }
    // breathe half an hour on both ends
    minMin = Math.max(0, minMin - 30);
    maxMin = Math.min(24 * 60, maxMin + 30);
    return { term, blocks, days, minMin, maxMin };
  }, [person]);

  // beside the row: right of the anchor when it fits, else left
  const fitsRight = anchor.right + 12 + PREVIEW_W <= window.innerWidth;
  const left = fitsRight ? anchor.right + 12 : Math.max(8, anchor.left - 12 - PREVIEW_W);
  const top = Math.max(8, Math.min(anchor.top - 40, window.innerHeight - GRID_H - 80));

  const span = view.maxMin - view.minMin;
  const y = (min: number) => ((min - view.minMin) / span) * 100;

  return (
    <div className="sched-preview" style={{ left, top, width: PREVIEW_W }}>
      <div className="sched-preview__head">
        <b>{person.handle}</b>
        {view.term && <span>{view.term.label}</span>}
      </div>
      {view.blocks.length === 0 ? (
        <div className="sched-preview__empty">no classes this term</div>
      ) : (
        <div className="sched-preview__grid" style={{ height: GRID_H }}>
          {view.days.map((d) => (
            <div key={d} className="sched-preview__day">
              <span className="sched-preview__daylabel">{d[0]}</span>
              {view.blocks
                .filter((b) => b.day === d)
                .map((b, i) => (
                  <span
                    key={`${b.section.id}-${b.startMin}-${i}`}
                    className="sched-preview__block"
                    style={{
                      top: `${y(b.startMin)}%`,
                      height: `${Math.max(3, y(b.endMin) - y(b.startMin))}%`,
                      background: courseColor(b.section),
                    }}
                  />
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
