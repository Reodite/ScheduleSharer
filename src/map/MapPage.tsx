import { useEffect, useMemo, useState } from 'react';
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
import './map.css';

type Mode = 'live' | 'free';

const SLIDER_MIN = 7 * 60;
const SLIDER_MAX = 22 * 60;
const HOUR_MARKS = ['8 AM', '10', '12 PM', '2', '4', '6', '8 PM', '10'];

function clampToSlider(min: number): number {
  return Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, Math.round(min / 5) * 5));
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
  const [freeDay, setFreeDay] = useState<DayCode>(() => dayCodeOf(new Date()));
  const [freeMin, setFreeMin] = useState(() => clampToSlider(minutesNow(new Date())));
  const [selected, setSelected] = useState<string | null>(null);

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

  const status = !hasSchedules
    ? 'no schedules on the calendar yet — add some from the main page'
    : occ.busyCount === 0
      ? mode === 'live'
        ? "no one's in class right now"
        : `no one's in class ${probeDay} at ${timeLabel}`
      : null;

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
                setFreeDay(dayCodeOf(now));
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

        {mode === 'free' && (
          <div className="map-dayrail" aria-label="Day of week">
            {DAY_ORDER.map((d) => (
              <button
                key={d}
                type="button"
                className={d === freeDay ? 'sel' : ''}
                onClick={() => setFreeDay(d)}
              >
                {d}
              </button>
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
          <>
            <div className="map-timerow">
              <span className="map-timerow__label">
                {freeDay} {timeLabel}
              </span>
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
            </div>
            <div className="map-hours" aria-hidden>
              {HOUR_MARKS.map((h, i) => (
                <span key={i}>{h}</span>
              ))}
            </div>
          </>
        )}
      </footer>
    </div>
  );
}
