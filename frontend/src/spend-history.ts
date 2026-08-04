/**
 * What a subscription has cost you so far.
 *
 * Every other number in the app looks forwards — what renews next, what a year
 * would cost, what cancelling would save. All of them are projections, and a
 * projection is easy to shrug at. *"You have paid Netflix ₹11,388"* is not a
 * projection. It already happened, and it is the number that makes people act.
 *
 * Nothing records the payments themselves. There is no ledger, no receipt table,
 * no bank feed — so the charges are reconstructed from the billing grid: the
 * renewal date, the cycle, and the anchor day walked backwards until they run
 * off the start of the tracking window.
 *
 * Two honesty constraints shape the whole module:
 *
 * The window starts when the subscription was *added to the app*, not when the
 * person first subscribed. The app has never known the latter. So every figure
 * here is "since you added this", and the wording at the call site has to say
 * so — a total labelled "total paid" would be a smaller number than the truth,
 * presented as though it were the truth.
 *
 * And a subscription that is paused or cancelled stopped being charged on a day
 * nothing recorded. Counting it to today would invent payments that never
 * happened, so `spentSince` refuses rather than guesses.
 */

import { currentRenewal, retreatRenewal } from './cycles';

/** One logged amount change, as `listPriceChanges` returns it. */
export type AmountChange = {
  /** ISO timestamp or date. Only the date part is read. */
  changed_at: string;
  old_amount: number;
  new_amount: number;
};

/**
 * A safety rail, not a real limit. Weekly for twenty years is a thousand
 * charges; anything past this is a corrupt date, and the loop must end.
 */
const MAX_CHARGES = 2000;

/**
 * The charge dates that have already happened, newest first.
 *
 * A renewal falling exactly on `todayISO` counts as charged — the merchant
 * takes the money on the day, and treating today as still pending would make
 * the total flicker down for one day in every cycle.
 *
 * `fromISO` is exclusive. A subscription added on the day it renews has not yet
 * been charged *through this app*, and counting that charge would attribute a
 * payment to a window that did not contain it.
 */
export function chargeDates(opts: {
  nextRenewalISO: string;
  cycle: string;
  anchorDay?: number | null;
  /** When tracking began — the subscription's created_at, as an ISO day. */
  fromISO: string;
  todayISO: string;
}): string[] {
  const { nextRenewalISO, cycle, anchorDay, fromISO, todayISO } = opts;
  if (!nextRenewalISO || !fromISO || fromISO > todayISO) return [];

  // Start from the first renewal that has not happened yet. The stored date is
  // not reliably that: it goes stale for anyone who does not open the app, and
  // a stale date would hide every charge that has happened since.
  let at = currentRenewal(nextRenewalISO, cycle, todayISO, anchorDay);

  const out: string[] = [];
  for (let guard = 0; guard < MAX_CHARGES; guard += 1) {
    if (at <= todayISO) break;
    const back = retreatRenewal(at, cycle, anchorDay);
    // A date it cannot parse returns itself, which would spin forever.
    if (back >= at) return out;
    at = back;
  }

  for (let guard = 0; guard < MAX_CHARGES; guard += 1) {
    if (at <= fromISO) break;
    out.push(at);
    const back = retreatRenewal(at, cycle, anchorDay);
    if (back >= at) break;
    at = back;
  }

  return out;
}

/**
 * The amount that was in effect on `onISO`.
 *
 * `price_changes` rows are written by a trigger and record both sides of each
 * change, which is what makes history recoverable: the amount before the
 * earliest change is that change's `old_amount`, and the current amount is only
 * correct for dates after the most recent one.
 *
 * Charging today's price for last year's renewals is the obvious mistake here,
 * and it always overstates — every subscription that has ever risen in price
 * would report more than was paid.
 */
export function amountOn(
  onISO: string,
  currentAmount: number,
  changes: readonly AmountChange[],
): number {
  const sorted = [...changes]
    .map((c) => ({ ...c, on: c.changed_at.slice(0, 10) }))
    .sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));

  if (sorted.length === 0) return currentAmount;

  // Before the first recorded change, the price was whatever that change moved
  // away from.
  if (onISO < sorted[0].on) return sorted[0].old_amount;

  let amount = sorted[0].new_amount;
  for (const change of sorted) {
    if (change.on > onISO) break;
    amount = change.new_amount;
  }
  return amount;
}

/**
 * What this subscription has cost since it was added, or null when that cannot
 * be answered honestly.
 *
 * Null rather than zero, and null rather than a guess. Zero is a claim — it
 * says "you have paid nothing" — and for a subscription that was cancelled on a
 * day nothing recorded, any number at all would be invented. The interface
 * shows nothing in that case, which is the only truthful option available.
 */
export function spentSince(opts: {
  nextRenewalISO: string;
  cycle: string;
  anchorDay?: number | null;
  amount: number;
  status: string;
  createdAtISO?: string | null;
  changes?: readonly AmountChange[];
  todayISO: string;
}): number | null {
  const { nextRenewalISO, cycle, anchorDay, amount, status, createdAtISO, todayISO } = opts;

  // Paused and cancelled both stopped being charged on a day nothing recorded.
  if (status !== 'active') return null;
  if (!createdAtISO) return null;

  const from = createdAtISO.slice(0, 10);
  const dates = chargeDates({ nextRenewalISO, cycle, anchorDay, fromISO: from, todayISO });
  if (dates.length === 0) return 0;

  const changes = opts.changes ?? [];
  return dates.reduce((sum, on) => sum + amountOn(on, amount, changes), 0);
}

/**
 * How many days of tracking the figure covers.
 *
 * Shown beside the total, because ₹11,388 means one thing over three years and
 * something much more alarming over three months.
 */
export function trackedDays(createdAtISO: string | null | undefined, todayISO: string): number {
  if (!createdAtISO) return 0;
  const from = Date.parse(`${createdAtISO.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${todayISO}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}
