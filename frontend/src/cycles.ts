/**
 * Billing-cycle arithmetic.
 *
 * Split out of currency.ts so it can be tested on its own: currency.ts reaches
 * for AsyncStorage and React to hold the live exchange rate, which makes it
 * awkward to import from a plain test process. This file has no dependencies at
 * all, which is what you want from the code that decides what a subscription
 * costs per month.
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
