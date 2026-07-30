/**
 * Noticing that a subscription got more expensive.
 *
 * Streaming and software prices creep upward in small steps, on autopay, and
 * almost nobody catches it — the charge is already authorised, so there is no
 * moment where the user is asked to agree to the new figure. The app already
 * stores the amount; the trigger in supabase/schema.sql now stores the previous
 * one, which is all that is needed to say something useful.
 *
 * The framing that matters is annual. "Netflix went up ₹150" reads as small.
 * "That is ₹1,800 a year" is the same fact and prompts a decision.
 *
 * Pure functions, `today` passed in, so this is testable without a clock.
 */

import type { PriceChange, Subscription } from './api';
// From cycles.ts, not currency.ts, so this module stays dependency-free and
// testable — currency.ts pulls in AsyncStorage and React for the live rate.
import { monthlyEquivalent } from './cycles';

export type PriceRise = {
  change: PriceChange;
  sub: Subscription;
  /** How much more, per billing period. */
  delta: number;
  /** Percentage increase, rounded to a whole number. */
  percent: number;
  /** The part that lands: extra cost over a year at the new price. */
  annualDelta: number;
};

/**
 * Below this, a change is noise rather than news — a corrected typo, a rounding
 * difference from a Gmail scan. Percentage rather than an absolute floor because
 * the app holds both rupee and dollar amounts, and any fixed number would be
 * wrong for one of them.
 */
const MIN_PERCENT = 1;

/**
 * Increases worth telling the user about, largest annual impact first.
 *
 * Decreases are deliberately not returned. A price going down needs no decision
 * from anyone, and mixing the two turns a list of things to act on into a
 * changelog.
 */
export function findPriceRises(
  changes: PriceChange[],
  subs: Subscription[],
): PriceRise[] {
  const byId = new Map(subs.map((s) => [s.id, s]));
  const rises: PriceRise[] = [];

  for (const change of changes) {
    const sub = byId.get(change.subscription_id);
    // The subscription was deleted; the row will go with it on cascade.
    if (!sub) continue;
    // A cancelled subscription's old price rise is history, not a decision.
    if (sub.status === 'cancelled') continue;

    const delta = change.new_amount - change.old_amount;
    if (delta <= 0) continue;
    if (change.old_amount <= 0) continue;

    // Threshold against the exact value, round only for display. Rounding
    // first lets 0.5% become 1% and defeat the filter entirely.
    const exactPercent = (delta / change.old_amount) * 100;
    if (exactPercent < MIN_PERCENT) continue;
    const percent = Math.round(exactPercent);

    rises.push({
      change,
      sub,
      delta,
      percent,
      // Reuses monthlyEquivalent so a weekly or yearly cycle is handled the
      // same way the dashboard totals handle it, rather than diverging.
      annualDelta: monthlyEquivalent(delta, sub.billing_cycle) * 12,
    });
  }

  return rises.sort((a, b) => b.annualDelta - a.annualDelta);
}

/**
 * The total extra per year across every unaddressed rise — the headline number
 * for the alert, and the reason to look at the list at all.
 */
export function totalAnnualIncrease(rises: PriceRise[]): number {
  return rises.reduce((sum, r) => sum + r.annualDelta, 0);
}
