/**
 * The savings audit — what the app is actually worth paying for.
 *
 * Every check answers one question: "how many rupees a year does acting on this
 * put back in your pocket?" A finding without a number attached is an
 * observation, and observations do not convert. `annualSaving` is therefore not
 * optional on any of them.
 *
 * Three rules the whole file follows:
 *
 *   Annual, always. "Netflix went up ₹150" reads as nothing. "That is ₹1,800 a
 *   year" is the same fact and prompts a decision.
 *
 *   Show the arithmetic. Every finding carries `detail` — the sum it came from,
 *   in words the user can check. A savings claim nobody can verify reads as
 *   marketing, and this is an app about not being quietly taken advantage of.
 *
 *   Never overstate. Where we cannot know something — whether someone is on a
 *   particular telecom plan, whether they want two music services — the finding
 *   says so via `confidence` and is worded as a question. An audit that invents
 *   savings is worse than no audit, because the first time a user checks one and
 *   finds it false, they stop believing all of them.
 *
 * Pure functions, `today` passed in, no imports beyond types and data — so this
 * is unit-tested directly, the same way cycles.ts and trials.ts are.
 */

import type { PriceChange, Subscription } from './api';
import { monthlyEquivalent } from './cycles';
import { bundlesIncluding, OVERLAP_CATEGORIES, planPriceFor } from './savings-data';
import { trialDaysLeft } from './trials';

export type SavingKind =
  | 'annual-switch'
  | 'bundled'
  | 'overlap'
  | 'trial-converting'
  | 'price-rise'
  | 'dormant';

/**
 * How much we trust the number.
 *
 * `certain`  — arithmetic on the user's own data. Cannot be wrong.
 * `likely`   — uses verified reference data, but assumes their plan matches.
 * `check`    — depends on something only the user knows. Worded as a question.
 */
export type SavingConfidence = 'certain' | 'likely' | 'check';

export type Saving = {
  /** Stable across runs, so a dismissal sticks. */
  id: string;
  kind: SavingKind;
  sub: Subscription;
  /** The other subscription involved, for overlaps. */
  related?: Subscription;
  /** Rupees per year, in `currency`, if the user acts. */
  annualSaving: number;
  currency: string;
  /** Headline, imperative. "Switch to annual billing". */
  title: string;
  /** The sum, so the user can check our working. */
  detail: string;
  /** What to actually do. */
  action: string;
  confidence: SavingConfidence;
};

/**
 * Below this a finding is noise. Telling someone they can save ₹40 a year costs
 * more attention than it returns, and a list padded with trivia makes the
 * genuinely large findings harder to see.
 */
const MIN_ANNUAL_SAVING = 100;

// ------------------------------------------------------------------ checks --

/**
 * Paying monthly for something sold cheaper annually.
 *
 * The cleanest finding in the audit: same service, same tier, strictly less
 * money, no downside beyond paying up front.
 */
function checkAnnualSwitch(sub: Subscription, today: Date): Saving | null {
  if (sub.status !== 'active' || sub.billing_cycle !== 'monthly') return null;

  const paidMonthly = sub.amount;
  if (paidMonthly <= 0) return null;

  const plan = planPriceFor(sub.domain, paidMonthly, today);
  if (!plan) return null;

  // Trust what the user actually pays over our table, but only when it is the
  // same order of magnitude — a wildly different figure means they are on a
  // tier we do not have pricing for, and comparing across tiers invents savings.
  const drift = Math.abs(paidMonthly - plan.monthly) / plan.monthly;
  if (drift > 0.25) return null;

  const annualSaving = paidMonthly * 12 - plan.yearly;
  if (annualSaving < MIN_ANNUAL_SAVING) return null;

  return {
    id: `annual-switch:${sub.id}`,
    kind: 'annual-switch',
    sub,
    annualSaving,
    currency: sub.currency ?? plan.currency,
    title: 'Switch to annual billing',
    detail:
      `You pay ${paidMonthly} a month — ${paidMonthly * 12} a year. ` +
      `The same ${plan.tier} plan is ${plan.yearly} paid yearly.`,
    action: `Change ${sub.name} to the yearly plan`,
    confidence: 'likely',
  };
}

/**
 * Paying for something a telecom plan or credit card already includes.
 *
 * The highest-value check, and the one that has to be worded most carefully: we
 * cannot see anyone's plan, so this asks rather than tells. Getting it wrong
 * means someone cancels a service they were paying for legitimately.
 */
function checkBundled(sub: Subscription, today: Date): Saving | null {
  if (sub.status !== 'active') return null;

  const bundles = bundlesIncluding(sub.domain, today);
  if (!bundles.length) return null;

  const annualSaving = monthlyEquivalent(sub.amount, sub.billing_cycle) * 12;
  if (annualSaving < MIN_ANNUAL_SAVING) return null;

  const names = bundles.map((b) => `${b.provider} ${b.plan}`).join(', ');

  return {
    id: `bundled:${sub.id}`,
    kind: 'bundled',
    sub,
    annualSaving,
    currency: sub.currency ?? 'INR',
    title: `You might already have ${sub.name}`,
    detail: `${names} includes it at no extra cost. ${bundles[0].note}`,
    action: `Check your plan — if it is included, cancel ${sub.name}`,
    confidence: 'check',
  };
}

/**
 * A trial about to start charging.
 *
 * The saving is the entire cost, because cancelling before the date costs
 * nothing at all. This is the most time-critical thing the audit finds, which
 * is why it is not filtered by MIN_ANNUAL_SAVING — a small trial converting is
 * still money the user actively decided not to spend.
 */
function checkTrialConverting(sub: Subscription, today: Date): Saving | null {
  const left = trialDaysLeft(sub, today);
  if (left === null || left < 0 || sub.status !== 'active') return null;

  const annualSaving = monthlyEquivalent(sub.amount, sub.billing_cycle) * 12;
  if (annualSaving <= 0) return null;

  const when = left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${left} days`;

  return {
    id: `trial:${sub.id}`,
    kind: 'trial-converting',
    sub,
    annualSaving,
    currency: sub.currency ?? 'INR',
    title: `${sub.name} starts charging ${when}`,
    detail:
      `Cancel before it converts and you pay nothing. Keep it and it is ` +
      `${Math.round(annualSaving)} a year.`,
    action: `Decide on ${sub.name} before the trial ends`,
    confidence: 'certain',
  };
}

/**
 * Two active subscriptions in a category where one usually does.
 *
 * Worded as a prompt, not a verdict — plenty of people knowingly want both
 * Netflix and Prime. The saving quoted is the cheaper of the two, because that
 * is the one someone would realistically drop.
 */
function checkOverlaps(subs: Subscription[]): Saving[] {
  const byCategory = new Map<string, Subscription[]>();

  for (const s of subs) {
    if (s.status !== 'active') continue;
    if (!OVERLAP_CATEGORIES[s.category]) continue;
    const list = byCategory.get(s.category) ?? [];
    list.push(s);
    byCategory.set(s.category, list);
  }

  const out: Saving[] = [];

  for (const [category, list] of byCategory) {
    if (list.length < 2) continue;

    // Annual cost each, most expensive first — the cheapest is the candidate.
    const ranked = [...list].sort(
      (a, b) =>
        monthlyEquivalent(b.amount, b.billing_cycle) -
        monthlyEquivalent(a.amount, a.billing_cycle),
    );
    const keep = ranked[0];
    const drop = ranked[ranked.length - 1];

    const annualSaving = monthlyEquivalent(drop.amount, drop.billing_cycle) * 12;
    if (annualSaving < MIN_ANNUAL_SAVING) continue;

    out.push({
      id: `overlap:${drop.id}`,
      kind: 'overlap',
      sub: drop,
      related: keep,
      annualSaving,
      currency: drop.currency ?? 'INR',
      title: `You pay for ${OVERLAP_CATEGORIES[category]}`,
      detail:
        `${keep.name} and ${drop.name} are both active. Dropping ${drop.name} ` +
        `saves ${Math.round(annualSaving)} a year.`,
      action: `Decide whether you use both`,
      confidence: 'check',
    });
  }

  return out;
}

/**
 * A subscription whose price rose, framed as what the rise costs over a year.
 *
 * The saving is the increase, not the whole subscription: going back to the old
 * price is the thing on the table, whether by downgrading a tier or leaving.
 */
function checkPriceRises(changes: PriceChange[], subs: Subscription[]): Saving[] {
  const byId = new Map(subs.map((s) => [s.id, s]));
  const out: Saving[] = [];

  for (const change of changes) {
    const sub = byId.get(change.subscription_id);
    if (!sub || sub.status !== 'active') continue;

    const delta = change.new_amount - change.old_amount;
    if (delta <= 0) continue;

    const annualSaving = monthlyEquivalent(delta, sub.billing_cycle) * 12;
    if (annualSaving < MIN_ANNUAL_SAVING) continue;

    out.push({
      id: `rise:${change.id}`,
      kind: 'price-rise',
      sub,
      annualSaving,
      currency: change.currency,
      title: `${sub.name} costs more than it did`,
      detail:
        `It went from ${change.old_amount} to ${change.new_amount} — ` +
        `${Math.round(annualSaving)} more per year.`,
      action: `Check whether a cheaper tier covers you`,
      confidence: 'certain',
    });
  }

  return out;
}

/**
 * Active, renewing, and not touched in a long time.
 *
 * Deliberately conservative: only fires when the next renewal is far enough away
 * that the subscription has plainly been sitting there, and only for things
 * costing real money. Without usage data this is the best available proxy, and
 * over-firing it would make the audit feel like it is guessing.
 */
function checkDormant(sub: Subscription): Saving | null {
  if (sub.status !== 'paused') return null;

  const annualSaving = monthlyEquivalent(sub.amount, sub.billing_cycle) * 12;
  if (annualSaving < MIN_ANNUAL_SAVING) return null;

  // A paused row still exists at the merchant — pausing here is bookkeeping.
  return {
    id: `dormant:${sub.id}`,
    kind: 'dormant',
    sub,
    annualSaving,
    currency: sub.currency ?? 'INR',
    title: `${sub.name} is paused, not cancelled`,
    detail:
      `Pausing it here does not stop the charge — only the merchant can. ` +
      `It is ${Math.round(annualSaving)} a year if it is still billing.`,
    action: `Cancel ${sub.name} properly, or mark it active`,
    confidence: 'check',
  };
}

// ------------------------------------------------------------------- audit --

export type Audit = {
  savings: Saving[];
  /** The headline. Sum of everything found, per year. */
  totalAnnual: number;
  /** Currency the total is expressed in. */
  currency: string;
  /** How many findings are safe to state outright. */
  certainCount: number;
};

/**
 * Everything worth acting on, largest annual saving first.
 *
 * `convert` maps an amount from a subscription's currency into the user's
 * primary one, so the headline total is a single honest number rather than a
 * mix of rupees and dollars added together.
 */
export function runAudit(
  subs: Subscription[],
  changes: PriceChange[],
  options: {
    primaryCurrency?: string;
    convert?: (amount: number, from: string | undefined, to: string) => number;
    today?: Date;
  } = {},
): Audit {
  const today = options.today ?? new Date();
  const primary = (options.primaryCurrency ?? 'INR').toUpperCase();
  const convert = options.convert ?? ((amount) => amount);

  const savings: Saving[] = [
    ...checkOverlaps(subs),
    ...checkPriceRises(changes, subs),
  ];

  for (const sub of subs) {
    const found = [
      checkTrialConverting(sub, today),
      checkBundled(sub, today),
      checkAnnualSwitch(sub, today),
      checkDormant(sub),
    ].filter((s): s is Saving => s !== null);

    savings.push(...found);
  }

  // One finding per subscription. Several checks can fire on the same row, and
  // a list that says "cancel Netflix" three ways looks broken — and worse, the
  // total would count the same rupees more than once.
  const best = new Map<string, Saving>();
  for (const s of savings) {
    const prior = best.get(s.sub.id);
    if (!prior || rank(s) > rank(prior)) best.set(s.sub.id, s);
  }

  const deduped = [...best.values()].sort(
    (a, b) =>
      convert(b.annualSaving, b.currency, primary) -
      convert(a.annualSaving, a.currency, primary),
  );

  return {
    savings: deduped,
    totalAnnual: deduped.reduce(
      (sum, s) => sum + convert(s.annualSaving, s.currency, primary),
      0,
    ),
    currency: primary,
    certainCount: deduped.filter((s) => s.confidence === 'certain').length,
  };
}

/**
 * Which finding wins when several fire on one subscription.
 *
 * A deadline beats a maybe: a trial converting on Friday matters more than the
 * observation that two video services overlap, however large the second number.
 */
function rank(s: Saving): number {
  const byKind: Record<SavingKind, number> = {
    'trial-converting': 5,
    bundled: 4,
    'annual-switch': 3,
    'price-rise': 2,
    dormant: 1,
    overlap: 0,
  };
  return byKind[s.kind];
}

/** Findings safe to state as fact, for the headline on the paywall. */
export function certainSavings(audit: Audit): Saving[] {
  return audit.savings.filter((s) => s.confidence === 'certain');
}
