import { describe, expect, it } from 'vitest';
import type { PriceChange, Subscription } from './api';
import { findPriceRises, totalAnnualIncrease } from './price-watch';

function sub(over: Partial<Subscription> = {}): Subscription {
  return {
    id: over.id ?? 'sub-1',
    name: 'Netflix',
    amount: 799,
    currency: 'INR',
    billing_cycle: 'monthly',
    category: 'Entertainment',
    next_renewal: '2026-08-30',
    status: 'active',
    ...over,
  };
}

function change(over: Partial<PriceChange> = {}): PriceChange {
  return {
    id: over.id ?? 'chg-1',
    subscription_id: over.subscription_id ?? 'sub-1',
    old_amount: 649,
    new_amount: 799,
    currency: 'INR',
    changed_at: '2026-07-29T00:00:00Z',
    ...over,
  };
}

describe('findPriceRises', () => {
  it('reports an increase with percent and annual impact', () => {
    const [rise] = findPriceRises([change()], [sub()]);

    expect(rise.delta).toBe(150);
    expect(rise.percent).toBe(23);
    // Monthly, so twelve of them.
    expect(rise.annualDelta).toBe(1800);
  });

  it('ignores a price decrease — there is nothing to decide', () => {
    const cheaper = change({ old_amount: 799, new_amount: 649 });
    expect(findPriceRises([cheaper], [sub({ amount: 649 })])).toEqual([]);
  });

  it('ignores an unchanged amount', () => {
    expect(findPriceRises([change({ old_amount: 500, new_amount: 500 })], [sub()])).toEqual([]);
  });

  it('ignores sub-1% noise', () => {
    // 1000 -> 1005 is 0.5%, a corrected typo rather than a price rise.
    const noise = change({ old_amount: 1000, new_amount: 1005 });
    expect(findPriceRises([noise], [sub({ amount: 1005 })])).toEqual([]);
  });

  it('keeps a change at exactly the 1% threshold', () => {
    const edge = change({ old_amount: 1000, new_amount: 1010 });
    expect(findPriceRises([edge], [sub({ amount: 1010 })])).toHaveLength(1);
  });

  it('drops a change whose subscription is gone', () => {
    expect(findPriceRises([change({ subscription_id: 'missing' })], [sub()])).toEqual([]);
  });

  it('drops a change on a cancelled subscription', () => {
    expect(findPriceRises([change()], [sub({ status: 'cancelled' })])).toEqual([]);
  });

  it('does not divide by zero when the old amount was zero', () => {
    const fromFree = change({ old_amount: 0, new_amount: 299 });
    expect(findPriceRises([fromFree], [sub({ amount: 299 })])).toEqual([]);
  });

  it('annualises a yearly cycle without multiplying it', () => {
    const yearly = change({ old_amount: 1200, new_amount: 1500 });
    const [rise] = findPriceRises([yearly], [sub({ billing_cycle: 'yearly', amount: 1500 })]);
    expect(rise.annualDelta).toBe(300);
  });

  it('annualises a weekly cycle across 52 weeks', () => {
    const weekly = change({ old_amount: 100, new_amount: 110 });
    const [rise] = findPriceRises([weekly], [sub({ billing_cycle: 'weekly', amount: 110 })]);
    // 10 * 4.33 * 12 — the same maths the dashboard total uses.
    expect(rise.annualDelta).toBeCloseTo(519.6, 1);
  });

  it('sorts by annual impact, worst first', () => {
    const subs = [
      sub({ id: 'small', billing_cycle: 'monthly' }),
      sub({ id: 'big', billing_cycle: 'monthly' }),
    ];
    const changes = [
      change({ id: 'c-small', subscription_id: 'small', old_amount: 100, new_amount: 110 }),
      change({ id: 'c-big', subscription_id: 'big', old_amount: 100, new_amount: 300 }),
    ];

    expect(findPriceRises(changes, subs).map((r) => r.sub.id)).toEqual(['big', 'small']);
  });
});

describe('totalAnnualIncrease', () => {
  it('sums the annual impact', () => {
    const subs = [sub({ id: 'a' }), sub({ id: 'b' })];
    const changes = [
      change({ id: 'c1', subscription_id: 'a', old_amount: 100, new_amount: 110 }),
      change({ id: 'c2', subscription_id: 'b', old_amount: 200, new_amount: 230 }),
    ];

    // (10 + 30) * 12
    expect(totalAnnualIncrease(findPriceRises(changes, subs))).toBe(480);
  });

  it('is zero for no rises', () => {
    expect(totalAnnualIncrease([])).toBe(0);
  });
});
