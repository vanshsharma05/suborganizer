/**
 * Free-trial logic.
 *
 * A trial is the one moment where a reminder is worth more than everything else
 * the app does: the user actively wants out before a date, and if they miss it
 * they pay for something they had already decided against. Around seven in ten
 * people have been charged for a trial they meant to cancel.
 *
 * `is_trial` records that a subscription *started* as a trial. Whether the user
 * is still inside it is derived from `trial_ends` against today, so a trial
 * converts by itself — nothing has to run server-side on the expiry date, and a
 * device that was offline for a week still shows the right thing on wake.
 *
 * Everything here is pure and takes `today` explicitly so it can be tested at
 * any date without mocking the clock.
 */

import type { Subscription } from './api';
import { daysUntilISO } from './dates';

/**
 * Days before the trial ends on which to warn.
 *
 * Three, not one: a week out is when cancelling is still a calm decision, two
 * days is the nudge that catches people who meant to and forgot, and the
 * morning of is the last moment it can still be free. A single reminder is what
 * the renewal flow already does, and it is exactly what people miss.
 */
export const TRIAL_WARNING_DAYS: readonly number[] = [7, 2, 0];

/**
 * Whole days from `today` until the trial ends. 0 means it ends today, negative
 * means it has already converted. Null when this is not a trial, or the date is
 * missing or unparseable.
 */
export function trialDaysLeft(sub: Subscription, today: Date = new Date()): number | null {
  if (!sub.is_trial) return null;
  return daysUntilISO(sub.trial_ends, today);
}

/**
 * True while the user is still inside a free trial — nothing has been charged
 * yet. Once the end date passes this goes false on its own and the
 * subscription behaves like any other.
 */
export function isInTrial(sub: Subscription, today: Date = new Date()): boolean {
  if (sub.status !== 'active') return false;
  const left = trialDaysLeft(sub, today);
  return left !== null && left >= 0;
}

/**
 * Trials still running, soonest to expire first.
 *
 * Cancelled and paused subscriptions are excluded by `isInTrial`, so a trial the
 * user already dealt with does not keep nagging.
 */
export function activeTrials(subs: Subscription[], today: Date = new Date()): Subscription[] {
  return subs
    .filter((s) => isInTrial(s, today))
    .sort((a, b) => (trialDaysLeft(a, today) ?? 0) - (trialDaysLeft(b, today) ?? 0));
}

/**
 * Splits active subscriptions into what is being charged today and what is
 * still free.
 *
 * The dashboard total must not count a trial: the user is paying nothing for it
 * right now, and folding it in overstates what leaves their account. It is
 * surfaced separately as what the total *becomes* on conversion, which is the
 * number that actually prompts a decision.
 */
export function splitByTrial(
  subs: Subscription[],
  today: Date = new Date(),
): { charging: Subscription[]; trialing: Subscription[] } {
  const charging: Subscription[] = [];
  const trialing: Subscription[] = [];

  for (const s of subs) {
    if (isInTrial(s, today)) trialing.push(s);
    else charging.push(s);
  }

  return { charging, trialing };
}

/** Wording for a trial card: "ends today", "ends tomorrow", "5 days left". */
export function trialLabel(daysLeft: number): string {
  if (daysLeft < 0) return 'trial ended';
  if (daysLeft === 0) return 'ends today';
  if (daysLeft === 1) return 'ends tomorrow';
  return `${daysLeft} days left`;
}
