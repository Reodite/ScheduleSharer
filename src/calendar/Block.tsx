import type { MergedBlock } from './buildCalendar';
import { courseColor } from './colors';
import { AvatarChip } from '../avatar/AvatarChip';
import { rangeLabel } from '../util/time';

const MAX_CHIPS = 4;

const COMPONENT_ABBREV: Record<string, string> = {
  Lecture: 'lec',
  Laboratory: 'lab',
  Discussion: 'dis',
  Seminar: 'sem',
};

export function componentAbbrev(component: string): string {
  return COMPONENT_ABBREV[component] ?? component.slice(0, 3).toLowerCase();
}

/** 'CPSC_V 221' -> 'CPSC 221'; falls back to the title for code-less data */
export function displayCode(section: { courseCode: string; title: string }): string {
  return section.courseCode ? section.courseCode.replace(/_V(?=\s)/, '') : section.title;
}

interface Props {
  block: MergedBlock;
  top: number;
  height: number;
  onClick: (block: MergedBlock) => void;
}

export function Block({ block, top, height, onClick }: Props) {
  const color = courseColor(block.section);
  const size = height < 42 ? 'xs' : height < 62 ? 'sm' : 'lg';
  const gapPct = 100 / block.cols;

  const loc = block.pattern.buildingCode
    ? `${block.pattern.buildingCode} ${block.pattern.room ?? ''}`.trim()
    : block.pattern.room ?? '';

  const style = {
    top,
    height: Math.max(height - 2, 18),
    left: `calc(${block.col * gapPct}% + 2px)`,
    width: `calc(${gapPct}% - 5px)`,
    zIndex: block.col + 1,
    '--block-color': color,
  } as React.CSSProperties;

  return (
    <button
      type="button"
      className="cal-block"
      style={style}
      data-size={size}
      title={`${displayCode(block.section)} — ${block.section.title} (${block.section.component}) · ${rangeLabel(block.startMin, block.endMin)}${loc ? ` · ${loc}` : ''} · ${block.people.map((p) => p.handle).join(', ')}`}
      onClick={() => onClick(block)}
    >
      <span className="cal-block__code">
        {displayCode(block.section)} <small>{componentAbbrev(block.section.component)}</small>
      </span>
      <span className="cal-block__meta">{rangeLabel(block.startMin, block.endMin)}</span>
      {loc && <span className="cal-block__meta cal-block__meta--loc">{loc}</span>}
      <span className="cal-block__chips">
        {block.people.slice(0, MAX_CHIPS).map((p) => (
          <AvatarChip key={p.id} avatar={p.avatar} size={17} title={p.handle} />
        ))}
        {block.people.length > MAX_CHIPS && (
          <span className="cal-block__more">+{block.people.length - MAX_CHIPS}</span>
        )}
      </span>
    </button>
  );
}
