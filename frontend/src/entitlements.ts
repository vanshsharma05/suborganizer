/**
 * What a user has paid for, and what that unlocks.
 *
 * Two one-time purchases, no subscriptions. Charging a monthly fee to an app
 * whose entire pitch is "you are paying too many monthly fees" is a joke the
 * user makes before you do.
 *
 *   scan_unlock  — reads their Gmail and finds what they pay for.
 *   pro_lifetime — every finding in the savings audit, in full.
 *
 * The cheap one is not a revenue line. It is the step from "person who has never
 * paid for anything in this app" to "person with a payment method on file and a
 * receipt in their inbox", which is the hard one; ₹199 afterwards is a much
 * smaller ask than ₹199 from cold. It also costs a scan real money in Gmail API
 * quota, so a free-for-everyone scan is a bill we pay for tyre-kickers.
 *
 * It cannot be ₹1: Play's minimum for an in-app product in India is ₹10.
 *
 * Prices appear nowhere in this file, deliberately. The store is the authority
 * on what something costs — it knows the user's country, their currency, and
 * whatever sale is running. Hardcoding "₹199" here means shipping a lie the
 * first time any of those change. See billing.ts.
 *
 * Pure module: no React, no storage, no network, so the rules that decide what
 * a user can see are testable on their own.
 */

import type { Saving, SavingKind } from './savings';

/** Product IDs. These must match the SKUs created in Play Console exactly. */
export const PRODUCTS = {
  scan: 'scan_unlock',
  pro: 'pro_lifetime',
} as const;

export type ProductId = (typeof PRODUCTS)[keyof typeof PRODUCTS];

export const ALL_PRODUCTS: ProductId[] = [PRODUCTS.scan, PRODUCTS.pro];

export function isProductId(v: string): v is ProductId {
  return (ALL_PRODUCTS as string[]).includes(v);
}

/** What a user is allowed to do, derived from what they own. */
export type Entitlement = 'scan' | 'pro';

/**
 * Pro includes the scan.
 *
 * Someone who paid ₹199 and is then asked for another ₹1 to use the headline
 * feature will not remember which of the two prices annoyed them, only that the
 * app did.
 */
export function entitlementsFor(owned: readonly ProductId[]): Set<Entitlement> {
  const out = new Set<Entitlement>();
  if (owned.includes(PRODUCTS.scan)) out.add('scan');
  if (owned.includes(PRODUCTS.pro)) {
    out.add('pro');
    out.add('scan');
  }
  return out;
}

export function canScan(owned: readonly ProductId[]): boolean {
  return entitlementsFor(owned).has('scan');
}

export function isPro(owned: readonly ProductId[]): boolean {
  return entitlementsFor(owned).has('pro');
}

// ------------------------------------------------------------ audit reveal --

/**
 * A finding, plus whether this user may read it.
 *
 * Locked findings are still returned rather than filtered out: the whole
 * mechanism depends on the user seeing that specific, quantified money exists
 * and that they cannot currently reach it. A paywall that hides the fact there
 * is anything behind it is just a smaller app.
 */
export type Reveal = { saving: Saving; locked: boolean };

/**
 * Decides which findings a free user can read in full.
 *
 * Exactly one is given away, and it is the *cheapest* one. Both halves of that
 * matter. Giving one away is what proves the audit is real — anyone can print a
 * total, and a wall of blurred cards reads as a total with decoration on it.
 * Making it the cheapest means the free finding can never be the reason not to
 * pay: what remains locked is always worth more than what was shown.
 *
 * A `certain` finding is preferred as the freebie, because the proof only works
 * if the user checks it and finds it true. Handing over the shakiest inference
 * we have as the sample is how you teach someone the rest is guesswork.
 */
export function revealAudit(savings: readonly Saving[], pro: boolean): Reveal[] {
  if (pro) return savings.map((saving) => ({ saving, locked: false }));
  if (savings.length === 0) return [];

  const cheapestOf = (list: readonly Saving[]): Saving | undefined =>
    list.reduce<Saving | undefined>(
      (best, s) => (best === undefined || s.annualSaving < best.annualSaving ? s : best),
      undefined,
    );

  const certain = savings.filter((s) => s.confidence === 'certain');
  const free = cheapestOf(certain.length > 0 ? certain : savings);

  return savings.map((saving) => ({ saving, locked: saving.id !== free?.id }));
}

/** Money the user can see the shape of but not yet act on. */
export function lockedValue(reveals: readonly Reveal[]): number {
  return reveals.reduce((sum, r) => sum + (r.locked ? r.saving.annualSaving : 0), 0);
}

export function lockedCount(reveals: readonly Reveal[]): number {
  return reveals.filter((r) => r.locked).length;
}

/**
 * What a locked card says instead of the real headline.
 *
 * The amount stays visible and the identity does not. Knowing "₹1,389 a year is
 * sitting in a subscription your phone plan already pays for" and not knowing
 * which one is a specific, checkable itch. "Unlock 4 more insights" is not — it
 * could mean anything, including nothing, and users have learned it usually
 * means nothing.
 */
export const LOCKED_LABEL: Record<SavingKind, string> = {
  'annual-switch': 'One of these has a cheaper annual plan',
  bundled: 'Something you already pay for twice',
  overlap: 'Two services doing the same job',
  'trial-converting': 'A free trial about to start charging',
  'price-rise': 'One of these quietly put its price up',
  dormant: 'You have stopped using one of these',
};
