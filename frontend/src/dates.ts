/**
 * Date-only arithmetic for the `date` columns in supabase/schema.sql.
 *
 * `next_renewal`, `trial_ends` and `snoozed_until` are calendar days, not
 * instants. The obvious way to produce one — `d.toISOString().split('T')[0]` —
 * converts to UTC first, and the app's users are at UTC+5:30. Between midnight
 * and 05:30 IST that yields *yesterday*, so a trial set at 1 AM ended a day
 * early and its "ends today" warning fired a day early with it.
 *
 * So: format from the local calendar fields, and parse back to local midnight.
 * Everything here is pure and dependency-free, which is what makes it testable.
 */

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` for the calendar day `d` falls on *locally*. */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Parses `YYYY-MM-DD` as local midnight, or null if unparseable.
 *
 * `new Date('2026-07-30')` is defined to be *UTC* midnight, which in a negative
 * UTC offset is the previous day locally — the mirror image of the bug above,
 * and why this exists rather than calling the Date constructor directly.
 */
export function parseISODate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Local midnight on the day `d` falls on. */
export function startOfLocalDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** `YYYY-MM-DD`, `n` days after `from`, in local time. `n` may be negative. */
export function addDaysISO(from: Date, n: number): string {
  const d = startOfLocalDay(from);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** `YYYY-MM-DD`, `n` days after the date string `iso`. Passes through garbage. */
export function shiftISODate(iso: string, n: number): string {
  const parsed = parseISODate(iso);
  if (!parsed) return iso;
  return addDaysISO(parsed, n);
}

/** Today, as `YYYY-MM-DD` in local time. */
export function todayISO(): string {
  return toISODate(new Date());
}

/**
 * Whole days from `today` to `iso`. 0 is today, negative is past, null when the
 * date cannot be read.
 *
 * Both sides are snapped to local midnight first, so this counts calendar days
 * rather than 24-hour blocks — "tomorrow" stays 1 whether it is asked at 09:00
 * or at 23:00.
 */
export function daysUntilISO(iso: string | null | undefined, today: Date = new Date()): number | null {
  const target = parseISODate(iso);
  if (!target) return null;
  return Math.round((target.getTime() - startOfLocalDay(today).getTime()) / DAY_MS);
}
