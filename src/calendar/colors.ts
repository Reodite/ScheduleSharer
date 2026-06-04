import { fnv1a } from '../util/hash';

/**
 * Course accent palette — 12 well-spaced hues tuned for the dark UI.
 * Blocks tint these to ~16% over the panel color; the spine and text use
 * them at full strength. Color identifies the COURSE; avatars identify people.
 */
const COURSE_COLORS = [
  '#6ea8fe', // cornflower
  '#ffb46b', // tangerine
  '#62d2a2', // jade
  '#e886c9', // orchid
  '#ffd166', // amber
  '#7ee0e6', // ice
  '#b69cff', // lavender
  '#9bd356', // pear
  '#ff8f8f', // salmon
  '#5fd0c0', // lagoon
  '#f3a6ff', // pink quartz
  '#d9c79b', // sandstone
];

export function courseColor(courseCode: string): string {
  const idx = parseInt(fnv1a(courseCode), 16) % COURSE_COLORS.length;
  return COURSE_COLORS[idx];
}
