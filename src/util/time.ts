import type { DayCode } from '../types';
import { DAY_ORDER } from '../types';

/** 570 -> '9:30', 750 -> '12:30' (no am/pm; calendar gutter adds it) */
export function minutesToLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}` : `${h12}:${String(m).padStart(2, '0')}`;
}

/** 570 -> '9:30 AM' */
export function minutesToFullLabel(min: number): string {
  const h = Math.floor(min / 60);
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${minutesToLabel(min)} ${ampm}`;
}

/** '9:30–11:00' style compact range */
export function rangeLabel(startMin: number, endMin: number): string {
  return `${minutesToLabel(startMin)}–${minutesToLabel(endMin)}`;
}

/** Date -> local ISO 'YYYY-MM-DD' */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Date -> 'Mon' | 'Tue' | ... */
export function dayCodeOf(d: Date): DayCode {
  // JS getDay(): 0=Sun..6=Sat; DAY_ORDER starts at Mon
  const jsDay = d.getDay();
  return DAY_ORDER[(jsDay + 6) % 7];
}

/** inclusive ISO-string date range check (lexicographic compare is safe for ISO) */
export function dateInRange(iso: string, startIso: string, endIso: string): boolean {
  return iso >= startIso && iso <= endIso;
}

export function minutesNow(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}
