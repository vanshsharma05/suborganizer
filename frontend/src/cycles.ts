/**
 * Billing-cycle arithmetic.
 *
 * Split out of currency.ts so it can be tested on its own: currency.ts reaches
 * for AsyncStorage and React to hold the live exchange rate, which makes it
 * awkward to import from a plain test process. This file has no dependencies at
 * all, which is what you want from the code that decides what a subscription
 * costs per month.
 */

/**
 * The only three cycles the schema stores. `Cycle` is the alias the Gmail
 * classifier uses; they are the same thing and must stay that way, so the
 * classifier imports from here rather than declaring its own.
 */
export type BillingCycle = 'weekly' | 'monthly' | 'yearly';

/**
 * What one billing period costs per month.
 *
 * 4.33 rather than 4 for weekly: there are 52 weeks in a year, not 48, and
 * rounding down understates a weekly subscription by about 8% — which is exactly
 * the kind of quiet error this app exists to catch.
 */
export function monthlyEquivalent(amount: number, cycle: string): number {
  if (cycle === 'yearly') return amount / 12;
  if (cycle === 'weekly') return amount * 4.33;
  return amount;
}

/** Nominal length of a cycle in days, for renewal maths. */
export const CYCLE_DAYS: Record<BillingCycle, number> = {
  weekly: 7,
  monthly: 30,
  yearly: 365,
};

/**
 * The next renewal after `nextRenewalISO`, one cycle later.
 *
 * The month-end clamp is the part that matters: 31 January on a monthly cycle
 * has to land on 28 (or 29) February, because letting the day overflow puts it
 * in March and every subsequent renewal is then a month adrift.
 *
 * Built with `Date.UTC` and read back with `toISOString`, so both ends are on
 * the same clock and no timezone can shift the day. That is safe *here* because
 * this function never touches the current time — do not copy the pattern
 * anywhere that starts from `new Date()`; use src/dates.ts for those. See the
 * note in README.md.
 */
export function advanceRenewal(nextRenewalISO: string, cycle: string): string {
  const [y, m, d] = nextRenewalISO.split('-').map(Number);
  if (!y || !m || !d) return nextRenewalISO;

  if (cycle === 'weekly') {
    return utcDateString(y, m - 1, d + 7);
  }

  if (cycle === 'yearly') {
    // Day 0 of the following month is the last day of this one.
    const lastDay = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
    return utcDateString(y + 1, m - 1, Math.min(d, lastDay));
  }

  // monthly
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return utcDateString(ny, nm - 1, Math.min(d, lastDay));
}

function utcDateString(year: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}
