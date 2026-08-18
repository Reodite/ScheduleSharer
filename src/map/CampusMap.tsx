import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CampusMapData, MapBuilding } from './mapData';
import { buildingPath, linesPath } from './mapData';
import type { MapAttendee } from './occupancy';
import { courseLabel } from './occupancy';
import { AvatarChip } from '../avatar/AvatarChip';
import { minutesToFullLabel } from '../util/time';

/** screen = map * s + t */
interface View {
  s: number;
  tx: number;
  ty: number;
}

type BBox = [number, number, number, number];

const MAX_SCALE = 14; // px per meter — a lecture hall fills the screen
const MARKER_CHIPS = 3;

interface Props {
  data: CampusMapData;
  /** buildingCode -> attendees (already sorted) */
  occupied: Map<string, MapAttendee[]>;
  /** person id -> disambiguated display handle */
  names: Map<string, string>;
  selected: string | null;
  onSelect: (code: string | null) => void;
}

export function CampusMap({ data, occupied, names, selected, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const [view, setView] = useState<View | null>(null);
  const [panning, setPanning] = useState(false);

  // active pointers (for pan + pinch) and drag-vs-click discrimination
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  /** finger taps jitter several px — only a real drag suppresses the tap */
  const TAP_SLOP = 9;

  const byCode = useMemo(() => new Map(data.buildings.map((b) => [b.code, b])), [data]);
  const shapes = useMemo(() => data.buildings.map((b) => ({ b, d: buildingPath(b) })), [data]);
  const roadsD = useMemo(() => linesPath(data.roads), [data]);
  const coastD = useMemo(() => linesPath(data.coast), [data]);

  const markers = useMemo(() => {
    const list: { b: MapBuilding; attendees: MapAttendee[] }[] = [];
    for (const [code, attendees] of occupied) {
      const b = byCode.get(code);
      if (b) list.push({ b, attendees });
    }
    // stable paint order, north first so southern pins overlap on top
    return list.sort((a, z) => a.b.c[1] - z.b.c[1]);
  }, [occupied, byCode]);

  const minScale = useCallback(() => {
    const { w, h } = sizeRef.current;
    return w && h ? Math.min(w / data.w, h / data.h) * 0.8 : 0.01;
  }, [data]);

  const fitView = useCallback(
    (bbox: BBox, pad = 80): View | null => {
      const { w, h } = sizeRef.current;
      if (!w || !h) return null;
      const bw = bbox[2] - bbox[0] + pad * 2;
      const bh = bbox[3] - bbox[1] + pad * 2;
      const s = Math.max(minScale(), Math.min(MAX_SCALE, Math.min(w / bw, h / bh)));
      return {
        s,
        tx: w / 2 - (s * (bbox[0] + bbox[2])) / 2,
        ty: h / 2 - (s * (bbox[1] + bbox[3])) / 2,
      };
    },
    [minScale],
  );

  /** classroom core, stretched to include every occupied building */
  const frameBBox = useCallback((): BBox => {
    const box: BBox = [...data.core] as BBox;
    for (const { b } of markers) {
      if (b.c[0] < box[0]) box[0] = b.c[0];
      if (b.c[1] < box[1]) box[1] = b.c[1];
      if (b.c[0] > box[2]) box[2] = b.c[0];
      if (b.c[1] > box[3]) box[3] = b.c[1];
    }
    return box;
  }, [data, markers]);

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // first fit once we know both the data and the container size
  useEffect(() => {
    if (!view && size.w > 0) setView(fitView(frameBBox()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, view]);

  const zoomAt = useCallback(
    (cx: number, cy: number, factor: number) => {
      setView((prev) => {
        if (!prev) return prev;
        const s = Math.max(minScale(), Math.min(MAX_SCALE, prev.s * factor));
        const k = s / prev.s;
        return { s, tx: cx - (cx - prev.tx) * k, ty: cy - (cy - prev.ty) * k };
      });
    },
    [minScale],
  );

  // wheel must be a non-passive listener to be allowed to preventDefault
  useEffect(() => {
    const el = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.002));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  function localPoint(e: { clientX: number; clientY: number }) {
    const rect = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: React.PointerEvent) {
    // popup and zoom-button interactions shouldn't start a pan
    if ((e.target as Element).closest('[data-popup]') || (e.target as Element).closest('.map-zoom')) return;
    wrapRef.current!.setPointerCapture(e.pointerId);
    const pt = localPoint(e);
    pointers.current.set(e.pointerId, pt);
    if (pointers.current.size === 1) {
      movedRef.current = false;
      startPos.current = pt;
    }
    setPanning(true);
  }

  function onPointerMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const pt = localPoint(e);

    if (pointers.current.size === 1) {
      const dx = pt.x - prev.x;
      const dy = pt.y - prev.y;
      const start = startPos.current;
      if (start && Math.hypot(pt.x - start.x, pt.y - start.y) > TAP_SLOP) movedRef.current = true;
      setView((v) => (v ? { ...v, tx: v.tx + dx, ty: v.ty + dy } : v));
    } else if (pointers.current.size === 2) {
      movedRef.current = true;
      const [a, b] = [...pointers.current.entries()];
      const other = a[0] === e.pointerId ? b[1] : a[1];
      const dPrev = Math.hypot(prev.x - other.x, prev.y - other.y);
      const dNew = Math.hypot(pt.x - other.x, pt.y - other.y);
      const mid = { x: (pt.x + other.x) / 2, y: (pt.y + other.y) / 2 };
      if (dPrev > 0) zoomAt(mid.x, mid.y, dNew / dPrev);
      setView((v) => (v ? { ...v, tx: v.tx + (pt.x - prev.x) / 2, ty: v.ty + (pt.y - prev.y) / 2 } : v));
    }
    pointers.current.set(e.pointerId, pt);
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size === 0) setPanning(false);
    if (movedRef.current || pointers.current.size > 0) return;
    // a tap: pointer capture retargets events, so hit-test by coordinates
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el?.closest('[data-popup]') || el?.closest('.map-zoom')) return;
    const hit = el?.closest('[data-code]');
    onSelect(hit ? hit.getAttribute('data-code') : null);
  }

  const selBuilding = selected ? byCode.get(selected) : undefined;
  const selAttendees = selected ? (occupied.get(selected) ?? []) : [];
  const selPos = selBuilding && view
    ? { x: selBuilding.c[0] * view.s + view.tx, y: selBuilding.c[1] * view.s + view.ty }
    : null;

  return (
    <div
      ref={wrapRef}
      className={`map-canvas${panning ? ' map-canvas--panning' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {view && (
        <>
          <svg>
            <g transform={`matrix(${view.s},0,0,${view.s},${view.tx},${view.ty})`}>
              <path className="map-coast" d={coastD} vectorEffect="non-scaling-stroke" />
              <path className="map-roads" d={roadsD} vectorEffect="non-scaling-stroke" />
              {shapes.map(({ b, d }) => {
                const occ = occupied.has(b.code);
                const sel = b.code === selected;
                return (
                  <path
                    key={b.code}
                    d={d}
                    data-code={b.code}
                    className={`map-bldg${occ ? ' map-bldg--occ' : ''}${sel ? ' map-bldg--sel' : ''}`}
                    vectorEffect="non-scaling-stroke"
                  >
                    <title>{b.name}</title>
                  </path>
                );
              })}
            </g>
          </svg>

          <div className="map-markers">
            {markers.map(({ b, attendees }) => {
              const x = b.c[0] * view.s + view.tx;
              const y = b.c[1] * view.s + view.ty;
              if (x < -80 || x > size.w + 80 || y < -40 || y > size.h + 100) return null;
              return (
                <button
                  key={b.code}
                  type="button"
                  data-code={b.code}
                  className={`map-marker${b.code === selected ? ' map-marker--sel' : ''}`}
                  style={{ left: x, top: y, zIndex: Math.max(1, Math.round(y)) }}
                  title={`${b.name} — ${attendees.map((a) => names.get(a.person.id) ?? a.person.handle).join(', ')}`}
                >
                  {attendees.slice(0, MARKER_CHIPS).map((a) => (
                    <AvatarChip key={a.person.id} avatar={a.person.avatar} size={22} />
                  ))}
                  {attendees.length > MARKER_CHIPS && (
                    <span className="map-marker__more">+{attendees.length - MARKER_CHIPS}</span>
                  )}
                </button>
              );
            })}
          </div>

          {selBuilding && selPos && (
            <div
              data-popup
              className={`map-popup${selPos.y > size.h * 0.55 ? ' map-popup--above' : ''}`}
              style={
                {
                  '--px': `${Math.min(Math.max(selPos.x, 155), Math.max(size.w - 155, 155))}px`,
                  '--py': `${selPos.y}px`,
                  zIndex: 30,
                } as React.CSSProperties
              }
            >
              <div className="map-popup__head">
                <span className="map-popup__name">{selBuilding.name}</span>
                <span className="map-popup__code">{selBuilding.code}</span>
                <button type="button" className="map-popup__close" onClick={() => onSelect(null)} aria-label="Close">
                  ✕
                </button>
              </div>
              {selAttendees.length === 0 ? (
                <div className="map-popup__empty">no one here at this time</div>
              ) : (
                selAttendees.map(({ person, section, pattern }) => (
                  <div key={person.id} className="map-popup__row">
                    <AvatarChip avatar={person.avatar} size={26} />
                    <div className="map-popup__who">
                      <span className="map-popup__handle">{names.get(person.id) ?? person.handle}</span>
                      <span className="map-popup__course">
                        {courseLabel(section)}
                        {pattern.room ? ` · Room ${pattern.room}` : ''}
                        {` · til ${minutesToFullLabel(pattern.endMin)}`}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          <div className="map-zoom">
            <button type="button" aria-label="Zoom in" onClick={() => zoomAt(size.w / 2, size.h / 2, 1.5)}>
              +
            </button>
            <button type="button" aria-label="Zoom out" onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.5)}>
              −
            </button>
            <button type="button" aria-label="Recenter" title="Recenter" onClick={() => setView(fitView(frameBBox()))}>
              ⌖
            </button>
          </div>
        </>
      )}
    </div>
  );
}
