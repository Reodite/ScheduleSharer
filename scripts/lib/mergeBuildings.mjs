/**
 * Append-only merge of the previous BUILDINGS table with freshly-fetched data.
 *
 * - Indices [0, prev.length) are positional-stable. Each prev row is kept
 *   verbatim for codes still present in `next` and even for codes that no
 *   longer appear upstream — the wire-format-stable contract never shrinks.
 *   Names update only by happening to land in a fresh row at append-time.
 * - Codes only in `next`: appended at the end, sorted alphabetically among
 *   themselves, so two re-runs of the same upstream data produce
 *   byte-identical output.
 *
 * @param {readonly (readonly [string, string])[]} prev
 * @param {readonly (readonly [string, string])[]} next  sorted by code
 * @returns {readonly [string, string][]}
 */
export function mergeBuildings(prev, next) {
  const seen = new Set(prev.map(([c]) => c));
  const newcomers = next.filter(([c]) => !seen.has(c));
  newcomers.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return [...prev, ...newcomers];
}
