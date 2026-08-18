import { useEffect, useMemo, useRef, useState } from 'react';
import type { DayCode } from '../types';
import { DAY_ORDER } from '../types';
import { useStore } from '../state/store';
import { deriveTerms, defaultTermKey } from '../features/terms';
import { displayHandles } from '../state/merge';
import { dayCodeOf, minutesNow, minutesToFullLabel, toISODate } from '../util/time';
import { loadCampusMap } from './mapData';
import type { CampusMapData } from './mapData';
import { occupancyAt } from './occupancy';
import { CampusMap } from './CampusMap';
import { AvatarChip } from '../avatar/AvatarChip';
import './map.css';

type Mode = 'live' | 'free';

const SLIDER_MIN = 7 * 60;
const SLIDER_MAX = 22 * 60;

/** 780 -> '1 PM' — compact hour label for the slider tick rail */
function hourLabel(min: number): string {
  const h = min / 60;
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
}

// hourly ticks under the slider, each labeled with its time; on narrow
// screens CSS keeps only the "major" every-3-hours labels (16 don't fit)
const SLIDER_TICKS: { min: number; label: string; major: boolean }[] = [];
for (let m = SLIDER_MIN; m <= SLIDER_MAX; m += 60) {
  SLIDER_TICKS.push({ min: m, label: hourLabel(m), major: (m / 60 - 7) % 3 === 0 });
}
const WHEEL_DAYS = DAY_ORDER.slice(0, 5); // the free-mode wheel is weekdays only
const WHEEL_ITEM_PX = 24;

function clampToSlider(min: number): number {
  return Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, Math.round(min / 5) * 5));
}

function weekdayOf(d: Date): DayCode {
  const day = dayCodeOf(d);
  return day === 'Sat' || day === 'Sun' ? 'Mon' : day;
}

/** iOS-picker-style vertical scroll wheel for Mon–Fri */
function DayWheel({ day, onChange }: { day: DayCode; onChange: (d: DayCode) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const dayRef = useRef(day);
  dayRef.current = day;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // mouse drag-to-scroll state; null when idle (touch drags scroll natively)
  const drag = useRef<{ pointerId: number; startY: number; startTop: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  // keep the wheel centered on the selected day (mode switches, external sets);
  // skipped mid-drag so it doesn't yank the wheel out from under the pointer
  useEffect(() => {
    if (drag.current?.moved) return;
    const el = ref.current!;
    const idx = Math.max(0, WHEEL_DAYS.indexOf(day));
    const top = idx * WHEEL_ITEM_PX;
    if (Math.abs(el.scrollTop - top) > 1) el.scrollTo({ top });
  }, [day]);

  // Desktop mouse wheels scroll ~100px per notch; with 24px rows and mandatory
  // snap that flings the picker across several days and fights the recenter
  // effect above. Take over wheel input and step whole days instead — touch
  // scrolling is unaffected. Native listener because React's onWheel is
  // passive, so preventDefault would be ignored.
  useEffect(() => {
    const el = ref.current!;
    let acc = 0;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      let steps: number;
      if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || Math.abs(e.deltaY) >= 60) {
        steps = Math.sign(e.deltaY); // discrete wheel notch: one day per tick
        acc = 0;
      } else {
        acc += e.deltaY; // fine-grained trackpad deltas: accumulate
        steps = Math.trunc(acc / WHEEL_ITEM_PX);
        acc -= steps * WHEEL_ITEM_PX;
      }
      if (steps === 0) return;
      const idx = Math.max(0, WHEEL_DAYS.indexOf(dayRef.current));
      const next = Math.min(WHEEL_DAYS.length - 1, Math.max(0, idx + steps));
      if (next !== idx) onChangeRef.current(WHEEL_DAYS[next]);
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function onScroll() {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const idx = Math.min(WHEEL_DAYS.length - 1, Math.max(0, Math.round(el.scrollTop / WHEEL_ITEM_PX)));
      if (WHEEL_DAYS[idx] !== day) onChange(WHEEL_DAYS[idx]);
    });
  }

  // Browsers only drag-scroll with touch, so click-and-drag on a mouse did
  // nothing. Drive scrollTop from pointer events for mouse input, with snap
  // disabled during the drag (see --dragging in map.css) and the trailing
  // click swallowed so releasing over a day doesn't also select it.
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const el = ref.current!;
    drag.current = { pointerId: e.pointerId, startY: e.clientY, startTop: el.scrollTop, moved: false };
    suppressClick.current = false;
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) < 4) return; // below threshold: still a click
    const el = ref.current!;
    if (!d.moved) {
      d.moved = true;
      el.classList.add('map-daywheel__scroll--dragging');
      // capture only once it's a real drag — capturing on pointerdown would
      // redirect the trailing click away from the day buttons
      el.setPointerCapture(d.pointerId);
    }
    el.scrollTop = d.startTop - dy; // onScroll keeps the selected day in sync
  }

  function onPointerEnd() {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (!d.moved) return; // plain click: the button's onClick handles it
    suppressClick.current = true;
    const el = ref.current!;
    el.classList.remove('map-daywheel__scroll--dragging');
    const idx = Math.min(WHEEL_DAYS.length - 1, Math.max(0, Math.round(el.scrollTop / WHEEL_ITEM_PX)));
    if (WHEEL_DAYS[idx] !== dayRef.current) onChangeRef.current(WHEEL_DAYS[idx]); // recenter effect snaps
    else el.scrollTo({ top: idx * WHEEL_ITEM_PX, behavior: 'smooth' });
  }

  function onClickCapture(e: React.MouseEvent<HTMLDivElement>) {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }

  return (
    <div className="map-daywheel" aria-label="Day of week">
      <div
        ref={ref}
        className="map-daywheel__scroll"
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
      >
        <div className="map-daywheel__pad" />
        {WHEEL_DAYS.map((d) => (
          <button
            key={d}
            type="button"
            className={`map-daywheel__item${d === day ? ' sel' : ''}`}
            onClick={() => {
              onChange(d);
              ref.current?.scrollTo({ top: WHEEL_DAYS.indexOf(d) * WHEEL_ITEM_PX, behavior: 'smooth' });
            }}
          >
            {d}
          </button>
        ))}
        <div className="map-daywheel__pad" />
      </div>
    </div>
  );
}

interface Props {
  onClose: () => void;
}

export default function MapPage({ onClose }: Props) {
  const { group } = useStore();

  const [data, setData] = useState<CampusMapData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  const [mode, setMode] = useState<Mode>('live');
  const [freeDay, setFreeDay] = useState<DayCode>(() => weekdayOf(new Date()));
  const [freeMin, setFreeMin] = useState(() => clampToSlider(minutesNow(new Date())));
  const [selected, setSelected] = useState<string | null>(null);

  // the map is a fixed overlay — lock the page's scrollbar away while open,
  // otherwise the calendar behind it keeps a scrollbar that scrolls nothing
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // live mode ticks on the half-minute so classes flip on time
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (mode !== 'live') return;
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, [mode]);

  useEffect(() => {
    let stale = false;
    setLoadError(null);
    loadCampusMap().then(
      (d) => !stale && setData(d),
      (e) => !stale && setLoadError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      stale = true;
    };
  }, [retry]);

  const terms = useMemo(() => deriveTerms(group.people), [group.people]);
  const term = useMemo(() => {
    const key = defaultTermKey(terms, toISODate(new Date()));
    return terms.find((t) => t.key === key) ?? null;
  }, [terms]);

  const probeDay = mode === 'live' ? dayCodeOf(now) : freeDay;
  const probeMin = mode === 'live' ? minutesNow(now) : freeMin;

  const occ = useMemo(
    () => occupancyAt(group.people, term, probeDay, probeMin),
    [group.people, term, probeDay, probeMin],
  );
  const names = useMemo(() => displayHandles(group.people), [group.people]);

  // occupied buildings the map has no shape for (other campuses, odd codes)
  const offMap = useMemo(() => {
    if (!data) return [];
    const known = new Set(data.buildings.map((b) => b.code));
    const rows: { key: string; label: string; handles: string[] }[] = [];
    for (const [code, attendees] of occ.byBuilding) {
      if (known.has(code)) continue;
      rows.push({
        key: code,
        label: attendees[0].pattern.buildingName || code,
        handles: attendees.map((a) => names.get(a.person.id) ?? a.person.handle),
      });
    }
    if (occ.unlocated.length > 0) {
      rows.push({
        key: '·unlocated',
        label: 'no listed room',
        handles: occ.unlocated.map((a) => names.get(a.person.id) ?? a.person.handle),
      });
    }
    return rows;
  }, [data, occ, names]);

  const hasSchedules = group.people.some((p) => p.enabled && p.schedule);
  const timeLabel = minutesToFullLabel(probeMin);

  // when nobody is in class the "available" card already tells the story
  const status = hasSchedules ? null : 'no schedules on the calendar yet — add some from the main page';

  return (
    <div className="mappage">
      <header className="mappage__head">
        <button type="button" className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Back to calendar" title="Back to calendar">
          ←
        </button>
        <div className="mappage__title">
          Campus <em>map</em>
          {term && <span className="mappage__term">{term.label}</span>}
        </div>
        <div className="mappage__spacer" />
        {occ.busyCount > 0 && (
          <span className="mappage__count">
            {occ.busyCount} in class · {probeDay} {timeLabel}
          </span>
        )}
        <div className="terms" role="tablist" aria-label="Map mode">
          <button
            type="button"
            className={`terms__opt${mode === 'live' ? ' terms__opt--active' : ''}`}
            onClick={() => setMode('live')}
          >
            Live
          </button>
          <button
            type="button"
            className={`terms__opt${mode === 'free' ? ' terms__opt--active' : ''}`}
            onClick={() => {
              // pick up from the live moment so switching feels continuous
              if (mode === 'live') {
                setFreeDay(weekdayOf(now));
                setFreeMin(clampToSlider(minutesNow(now)));
              }
              setMode('free');
            }}
          >
            Free
          </button>
        </div>
      </header>

      <div className="mappage__canvas">
        {data ? (
          <CampusMap data={data} occupied={occ.byBuilding} names={names} selected={selected} onSelect={setSelected} />
        ) : (
          <div className="mappage__loading">
            {loadError ? (
              <>
                <span>couldn't load the campus map — {loadError}</span>
                <button type="button" className="btn" onClick={() => setRetry((r) => r + 1)}>
                  Retry
                </button>
              </>
            ) : (
              <span>loading campus…</span>
            )}
          </div>
        )}

        {data && occ.free.length > 0 && (
          <div className="map-avail">
            <div className="map-avail__title">
              <span className="map-avail__dot" />
              available · {occ.free.length}
            </div>
            {occ.free.map(({ person, nextStartMin, hasClassesToday }) => (
              <div key={person.id} className="map-avail__row">
                <AvatarChip avatar={person.avatar} size={20} />
                <span className="map-avail__name">{names.get(person.id) ?? person.handle}</span>
                <span className="map-avail__til">
                  {nextStartMin != null
                    ? `til ${minutesToFullLabel(nextStartMin)}`
                    : hasClassesToday
                      ? 'rest of day' // classes are done — not the same as no classes at all
                      : 'all day'}
                </span>
              </div>
            ))}
          </div>
        )}

        {data && status && <div className="mappage__status">{status}</div>}
      </div>

      <footer className="mappage__foot">
        {offMap.length > 0 && (
          <div className="map-elsewhere">
            <span className="map-elsewhere__label">off map</span>
            {offMap.map((row) => (
              <span key={row.key} className="map-elsewhere__item">
                <b>{row.handles.join(', ')}</b>
                {row.label}
              </span>
            ))}
          </div>
        )}
        {mode === 'live' ? (
          <div className="map-livebar">
            <span className="map-livedot" />
            Live · {probeDay}{' '}
            {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </div>
        ) : (
          <div className="map-timerow">
            <DayWheel day={freeDay} onChange={setFreeDay} />
            <div className="map-timecard">
              <div className="map-timecard__time">{timeLabel}</div>
              <input
                type="range"
                className="map-slider"
                min={SLIDER_MIN}
                max={SLIDER_MAX}
                step={5}
                value={freeMin}
                onChange={(e) => setFreeMin(Number(e.target.value))}
                aria-label="Time of day"
              />
              <div className="map-ticks" aria-hidden>
                {SLIDER_TICKS.map((t) => (
                  <span
                    key={t.min}
                    className={`map-tick${t.major ? ' map-tick--major' : ''}`}
                    style={{ left: `${((t.min - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100}%` }}
                  >
                    <span className={`map-tick__label${t.major ? '' : ' map-tick__label--minor'}`}>{t.label}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </footer>
    </div>
  );
}
