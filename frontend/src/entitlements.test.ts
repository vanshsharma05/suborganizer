import { describe, expect, it } from 'vitest';
import type { Subscription } from './api';
import {
  canScan, entitlementsFor, isPro, lockedCount, lockedValue, PRODUCTS, revealAudit,
} from './entitlements';
import type { Saving, SavingConfidence } from './savings';

function sub(over: Partial<Subscription> = {}): Subscription {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    name: 'Netflix',
    amount: 649,
    currency: 'INR',
    billing_cycle: 'monthly',
    category: 'Entertainment',
    next_renewal: '2026-08-15',
    status: 'active',
    ...over,
  } as Subscription;
}

function saving(id: string, annualSaving: number, confidence: SavingConfidence = 'likely'): Saving {
  return {
    id,
    kind: 'annual-switch',
    sub: sub({ id }),
    annualSaving,
    currency: 'INR',
    title: 'Switch to annual billing',
    detail: `Saves ${annualSaving} a year.`,
    action: 'Change the plan.',
    confidence,
  };
}

describe('entitlementsFor', () => {
  it('grants nothing when nothing is owned', () => {
    expect(entitlementsFor([]).size).toBe(0);
  });

  it('grants the scan on its own', () => {
    expect(canScan([PRODUCTS.scan])).toBe(true);
    expect(isPro([PRODUCTS.scan])).toBe(false);
  });

  /**
   * The ₹199 buyer must never be asked for the ₹1. Getting this wrong is not a
   * missing feature, it is a refund request.
   */
  it('includes the scan in Pro', () => {
    expect(isPro([PRODUCTS.pro])).toBe(true);
    expect(canScan([PRODUCTS.pro])).toBe(true);
  });

  it('ignores duplicates and order', () => {
    const both = entitlementsFor([PRODUCTS.pro, PRODUCTS.scan, PRODUCTS.pro]);
    expect(both.has('pro')).toBe(true);
    expect(both.has('scan')).toBe(true);
    expect(both.size).toBe(2);
  });
});

describe('revealAudit', () => {
  it('unlocks everything for Pro', () => {
    const reveals = revealAudit([saving('a', 500), saving('b', 900)], true);
    expect(reveals.every((r) => !r.locked)).toBe(true);
    expect(lockedValue(reveals)).toBe(0);
  });

  it('returns nothing when there is nothing to show', () => {
    expect(revealAudit([], false)).toEqual([]);
    expect(revealAudit([], true)).toEqual([]);
  });

  it('keeps locked findings in the list rather than dropping them', () => {
    const reveals = revealAudit([saving('a', 500), saving('b', 900), saving('c', 300)], false);
    expect(reveals).toHaveLength(3);
    expect(lockedCount(reveals)).toBe(2);
  });

  /**
   * The free sample is the cheapest one. If it were the most valuable, a user
   * could read the best finding, act on it, and never have a reason to pay —
   * we would have given away the product to keep the paywall tidy.
   */
  it('gives away the cheapest finding', () => {
    const reveals = revealAudit([saving('a', 500), saving('b', 900), saving('c', 300)], false);
    const free = reveals.find((r) => !r.locked);
    expect(free?.saving.id).toBe('c');
  });

  /**
   * The sample exists to be checked. Handing over a 'check' finding — one we
   * openly say depends on something only the user knows — teaches them the rest
   * is guesswork too.
   */
  it('prefers a certain finding as the sample even when a vaguer one is cheaper', () => {
    const reveals = revealAudit(
      [saving('cheap-but-shaky', 120, 'check'), saving('solid', 800, 'certain'), saving('other', 400)],
      false,
    );
    expect(reveals.find((r) => !r.locked)?.saving.id).toBe('solid');
  });

  it('falls back to the cheapest overall when nothing is certain', () => {
    const reveals = revealAudit(
      [saving('a', 700, 'likely'), saving('b', 250, 'check')],
      false,
    );
    expect(reveals.find((r) => !r.locked)?.saving.id).toBe('b');
  });

  it('picks the cheapest certain one when several are certain', () => {
    const reveals = revealAudit(
      [saving('a', 900, 'certain'), saving('b', 400, 'certain'), saving('c', 100, 'likely')],
      false,
    );
    expect(reveals.find((r) => !r.locked)?.saving.id).toBe('b');
  });

  it('unlocks the only finding when there is just one', () => {
    const reveals = revealAudit([saving('solo', 640)], false);
    expect(reveals[0].locked).toBe(false);
    expect(lockedValue(reveals)).toBe(0);
  });

  /** What the paywall headline claims. It must be the locked money, not the total. */
  it('counts only locked money as what is behind the wall', () => {
    const reveals = revealAudit([saving('a', 500, 'certain'), saving('b', 900), saving('c', 300)], false);
    expect(lockedValue(reveals)).toBe(1200); // 900 + 300; the 500 was given away
  });
});
