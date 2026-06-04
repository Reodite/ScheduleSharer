/**
 * Excel serial date (1900 date system) -> ISO 'YYYY-MM-DD'.
 * Day 1 = 1900-01-01, with the fictitious 1900-02-29 — anchoring the epoch at
 * 1899-12-30 absorbs that bug for all dates after Feb 1900 (all we care about).
 * Verified: 46274 -> 2026-09-09 (matches the in-pattern ISO start dates).
 */
export function dateFromSerial(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}
