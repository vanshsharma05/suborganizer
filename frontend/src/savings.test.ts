import { beforeEach, describe, expect, it } from 'vitest';
import type { PriceChange, Subscription } from './api';
import { certainSavings, runAudit } from './savings';
import { BUNDLES, PLAN_PRICES, planPriceFor, bundlesIncluding, STALE_AFTER_DAYS } from './savings-data';

const TODAY = new Date(2026, 6, 30);

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

function change(over: Partial<PriceChange> = {}): PriceChange {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    subscription_id: 'x',
    old_amount: 499,
    new_amount: 649,
    currency: 'INR',
    changed_at: '2026-07-01T00:00:00Z',
    ...over,
  };
}

/** The tables ship empty; seed them per-test so tests never depend on real data. */
function seedPlan(p: Partial<Parameters<typeof PLAN_PRICES.push>[0]> = {}) {
  PLAN_PRICES.push({
    domain: 'spotify.com',
    name: 'Spotify',
    monthly: 119,
    yearly: 1189,
    currency: 'INR',
    tier: 'Individual',
    verifiedOn: '2026-07-25',
    source: 'test',
    ...p,
  });
}

function seedBundle(b: Partial<Parameters<typeof BUNDLES.push>[0]> = {}) {
  BUNDLES.push({
    id: 'airtel-999',
    provider: 'Airtel',
    kind: 'telecom',
    plan: '₹999 postpaid',
    includes: ['hotstar.com'],
    note: 'Included on the ₹999 and above postpaid plans.',
    verifiedOn: '2026-07-25',
    source: 'test',
    ...b,
  });
}

beforeEach(() => {
  PLAN_PRICES.length = 0;
  BUNDLES.length = 0;
});

describe('shipped data tables', () => {
  // These run against the real tables, not the seeded ones, so they enforce the
  // rules in savings-data.ts on every entry anyone adds later.
  const realPlans = [...PLAN_PRICES];
  const realBundles = [...BUNDLES];

  it('every entry cites a source and a verification date', () => {
    for (const e of [...realPlans, ...realBundles]) {
      expect(e.source, `${JSON.stringify(e).slice(0, 60)} has no source`).toMatch(/^https?:\/\//);
      expect(e.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('never claims a yearly plan that costs more than paying monthly', () => {
    // A negative saving would surface as "switch to annual and pay more".
    for (const p of realPlans) {
      expect(p.yearly, `${p.name} ${p.tier}`).toBeLessThan(p.monthly * 12);
    }
  });

  it('has no two tiers of one service at the same monthly price', () => {
    // planPriceFor() picks a tier by closest monthly price; a tie makes that
    // choice arbitrary, and it would quote the wrong tier's yearly figure.
    const seen = new Set<string>();
    for (const p of realPlans) {
      const key = `${p.domain}:${p.monthly}`;
      expect(seen.has(key), `${p.name} has two tiers at ${p.monthly}`).toBe(false);
      seen.add(key);
    }
  });
});

describe('staleness', () => {
  it('ignores a plan price older than the freshness window', () => {
    const stale = new Date(TODAY);
    stale.setDate(stale.getDate() - (STALE_AFTER_DAYS + 1));
    seedPlan({ verifiedOn: stale.toISOString().slice(0, 10) });

    expect(planPriceFor('spotify.com', 119, TODAY)).toBeUndefined();
  });

  it('uses a plan price inside the window', () => {
    seedPlan();
    expect(planPriceFor('spotify.com', 119, TODAY)?.yearly).toBe(1189);
  });

  it('ignores a stale bundle', () => {
    seedBundle({ verifiedOn: '2020-01-01' });
    expect(bundlesIncluding('hotstar.com', TODAY)).toHaveLength(0);
  });

  it('matches a subdomain against the registrable domain', () => {
    seedBundle();
    expect(bundlesIncluding('www.hotstar.com', TODAY)).toHaveLength(1);
  });
});

describe('services with several tiers on one domain', () => {
  beforeEach(() => {
    seedPlan({ domain: 'hotstar.com', tier: 'Mobile', monthly: 79, yearly: 499 });
    seedPlan({ domain: 'hotstar.com', tier: 'Super', monthly: 149, yearly: 1099 });
    seedPlan({ domain: 'hotstar.com', tier: 'Premium', monthly: 299, yearly: 2199 });
  });

  it('picks the tier matching what the user actually pays', () => {
    expect(planPriceFor('hotstar.com', 299, TODAY)?.tier).toBe('Premium');
    expect(planPriceFor('hotstar.com', 79, TODAY)?.tier).toBe('Mobile');
    expect(planPriceFor('hotstar.com', 149, TODAY)?.tier).toBe('Super');
  });

  it('says nothing when it cannot tell which tier', () => {
    expect(planPriceFor('hotstar.com', undefined, TODAY)).toBeUndefined();
  });

  /**
   * The expensive mistake. Someone on Premium at ₹299 must not be quoted the
   * Mobile tier's ₹499 yearly figure — that reads as a ₹3,089 saving and would
   * drop them three tiers without telling them.
   */
  it('never quotes a cheaper tier to someone on an expensive one', () => {
    const premium = sub({ domain: 'hotstar.com', amount: 299, name: 'JioHotstar' });
    const [found] = runAudit([premium], [], { today: TODAY }).savings;

    expect(found.kind).toBe('annual-switch');
    expect(found.annualSaving).toBe(299 * 12 - 2199); // 1389, the Premium figure
    expect(found.detail).toContain('2199');
  });
});

describe('annual switch', () => {
  it('finds the saving when yearly beats twelve months of monthly', () => {
    seedPlan();
    const s = sub({ name: 'Spotify', domain: 'spotify.com', amount: 119, category: 'Music' });

    const { savings, totalAnnual } = runAudit([s], [], { today: TODAY });

    expect(savings).toHaveLength(1);
    expect(savings[0].kind).toBe('annual-switch');
    expect(savings[0].annualSaving).toBe(119 * 12 - 1189); // 239
    expect(totalAnnual).toBe(239);
  });

  it('shows its working', () => {
    seedPlan();
    const s = sub({ domain: 'spotify.com', amount: 119, category: 'Music' });
    const [found] = runAudit([s], [], { today: TODAY }).savings;

    expect(found.detail).toContain('1428'); // 119 * 12
    expect(found.detail).toContain('1189');
  });

  it('does not fire on a subscription already billed yearly', () => {
    seedPlan();
    const s = sub({ domain: 'spotify.com', amount: 1189, billing_cycle: 'yearly' });
    expect(runAudit([s], [], { today: TODAY }).savings).toHaveLength(0);
  });

  /**
   * The dangerous case. Someone on Spotify Duo at ₹179 is not on the Individual
   * plan our table prices, so quoting the Individual yearly figure would both
   * overstate the saving and silently downgrade them.
   */
  it('refuses to compare across tiers', () => {
    seedPlan();
    const duo = sub({ domain: 'spotify.com', amount: 179, category: 'Music' });
    expect(runAudit([duo], [], { today: TODAY }).savings).toHaveLength(0);
  });

  it('ignores a saving too small to be worth the interruption', () => {
    seedPlan({ monthly: 100, yearly: 1150 }); // saves only 50
    const s = sub({ domain: 'spotify.com', amount: 100, category: 'Music' });
    expect(runAudit([s], [], { today: TODAY }).savings).toHaveLength(0);
  });

  it('ignores a cancelled subscription', () => {
    seedPlan();
    const s = sub({ domain: 'spotify.com', amount: 119, status: 'cancelled' });
    expect(runAudit([s], [], { today: TODAY }).savings).toHaveLength(0);
  });
});

describe('bundled', () => {
  it('asks rather than asserts, because we cannot see the plan', () => {
    seedBundle();
    const s = sub({ name: 'Hotstar', domain: 'hotstar.com', amount: 1499, billing_cycle: 'yearly' });

    const [found] = runAudit([s], [], { today: TODAY }).savings;

    expect(found.kind).toBe('bundled');
    expect(found.confidence).toBe('check');
    expect(found.annualSaving).toBe(1499);
    expect(found.action).toMatch(/check your plan/i);
  });

  it('names the provider so the user can verify it', () => {
    seedBundle();
    const s = sub({ domain: 'hotstar.com', amount: 1499, billing_cycle: 'yearly' });
    const [found] = runAudit([s], [], { today: TODAY }).savings;

    expect(found.detail).toContain('Airtel');
    expect(found.detail).toContain('₹999 postpaid');
  });
});

describe('trial converting', () => {
  it('counts the whole cost as saveable, because cancelling is free', () => {
    const s = sub({ amount: 649, is_trial: true, trial_ends: '2026-08-02' });
    const [found] = runAudit([s], [], { today: TODAY }).savings;

    expect(found.kind).toBe('trial-converting');
    expect(found.confidence).toBe('certain');
    expect(found.annualSaving).toBe(649 * 12);
  });

  it('says today when it ends today', () => {
    const s = sub({ is_trial: true, trial_ends: '2026-07-30' });
    expect(runAudit([s], [], { today: TODAY }).savings[0].title).toContain('today');
  });

  it('ignores a trial that already converted', () => {
    const s = sub({ is_trial: true, trial_ends: '2026-07-01' });
    expect(runAudit([s], [], { today: TODAY }).savings).toHaveLength(0);
  });

  it('outranks every other finding on the same subscription', () => {
    seedBundle({ includes: ['netflix.com'] });
    const s = sub({
      domain: 'netflix.com',
      amount: 649,
      is_trial: true,
      trial_ends: '2026-08-02',
    });

    const { savings } = runAudit([s], [], { today: TODAY });
    expect(savings).toHaveLength(1);
    expect(savings[0].kind).toBe('trial-converting');
  });
});

describe('overlap', () => {
  it('flags two services in the same category and quotes the cheaper one', () => {
    const netflix = sub({ id: 'a', name: 'Netflix', amount: 649 });
    const prime = sub({ id: 'b', name: 'Prime Video', amount: 179 });

    const [found] = runAudit([netflix, prime], [], { today: TODAY }).savings;

    expect(found.kind).toBe('overlap');
    expect(found.sub.name).toBe('Prime Video'); // the cheaper one is the candidate
    expect(found.related?.name).toBe('Netflix');
    expect(found.annualSaving).toBe(179 * 12);
    expect(found.confidence).toBe('check');
  });

  it('does not flag a single service', () => {
    expect(runAudit([sub()], [], { today: TODAY }).savings).toHaveLength(0);
  });

  it('does not flag categories where two is normal', () => {
    const a = sub({ id: 'a', category: 'Productivity', amount: 500 });
    const b = sub({ id: 'b', category: 'Productivity', amount: 500 });
    expect(runAudit([a, b], [], { today: TODAY }).savings).toHaveLength(0);
  });

  it('compares annual cost, so a yearly plan is not mistaken for the cheap one', () => {
    const monthly = sub({ id: 'a', name: 'Netflix', amount: 649 }); // 7788/yr
    const yearly = sub({ id: 'b', name: 'Hotstar', amount: 1499, billing_cycle: 'yearly' });

    const [found] = runAudit([monthly, yearly], [], { today: TODAY }).savings;
    expect(found.sub.name).toBe('Hotstar');
    expect(found.annualSaving).toBe(1499);
  });
});

describe('price rise', () => {
  it('quotes the increase, not the whole subscription', () => {
    const s = sub({ id: 'n1', amount: 649 });
    const c = change({ subscription_id: 'n1', old_amount: 499, new_amount: 649 });

    const [found] = runAudit([s], [c], { today: TODAY }).savings;

    expect(found.kind).toBe('price-rise');
    expect(found.annualSaving).toBe(150 * 12);
  });

  it('ignores a price that went down', () => {
    const s = sub({ id: 'n1' });
    const c = change({ subscription_id: 'n1', old_amount: 649, new_amount: 499 });
    expect(runAudit([s], [c], { today: TODAY }).savings).toHaveLength(0);
  });
});

describe('paused subscriptions', () => {
  it('warns that pausing here does not stop the charge', () => {
    const s = sub({ status: 'paused', amount: 649 });
    const [found] = runAudit([s], [], { today: TODAY }).savings;

    expect(found.kind).toBe('dormant');
    expect(found.detail).toMatch(/only the merchant/i);
  });
});

describe('the total', () => {
  it('never counts one subscription twice', () => {
    seedPlan({ domain: 'netflix.com', monthly: 649, yearly: 6000 });
    seedBundle({ includes: ['netflix.com'] });

    // Annual-switch, bundled and overlap could all fire on this row.
    const netflix = sub({ id: 'a', name: 'Netflix', domain: 'netflix.com', amount: 649 });
    const prime = sub({ id: 'b', name: 'Prime', amount: 179 });

    const { savings, totalAnnual } = runAudit([netflix, prime], [], { today: TODAY });

    expect(savings.filter((s) => s.sub.id === 'a')).toHaveLength(1);
    // Netflix contributes its bundled figure (7788), Prime its overlap (2148).
    expect(totalAnnual).toBe(649 * 12 + 179 * 12);
  });

  it('is sorted largest first, so the biggest win leads', () => {
    const big = sub({ id: 'a', name: 'Big', amount: 2000, is_trial: true, trial_ends: '2026-08-05' });
    const small = sub({ id: 'b', name: 'Small', amount: 200, is_trial: true, trial_ends: '2026-08-05' });

    const { savings } = runAudit([small, big], [], { today: TODAY });
    expect(savings.map((s) => s.sub.name)).toEqual(['Big', 'Small']);
  });

  it('converts currencies before totalling', () => {
    const inr = sub({ id: 'a', amount: 1000, is_trial: true, trial_ends: '2026-08-05' });
    const usd = sub({
      id: 'b',
      amount: 10,
      currency: 'USD',
      is_trial: true,
      trial_ends: '2026-08-05',
    });

    const { totalAnnual } = runAudit([inr, usd], [], {
      today: TODAY,
      primaryCurrency: 'INR',
      convert: (amount, from) => (from === 'USD' ? amount * 88 : amount),
    });

    // 1000*12 INR + 10*12 USD at 88 = 12000 + 10560
    expect(totalAnnual).toBe(12_000 + 10_560);
  });

  it('reports zero on an empty account rather than throwing', () => {
    const audit = runAudit([], [], { today: TODAY });
    expect(audit.totalAnnual).toBe(0);
    expect(audit.savings).toEqual([]);
    expect(audit.certainCount).toBe(0);
  });

  it('separates findings safe to state as fact', () => {
    const trial = sub({ id: 'a', is_trial: true, trial_ends: '2026-08-05' });
    const netflix = sub({ id: 'b', name: 'Netflix', amount: 649 });
    const prime = sub({ id: 'c', name: 'Prime', amount: 179 });

    const audit = runAudit([trial, netflix, prime], [], { today: TODAY });
    const certain = certainSavings(audit);

    expect(certain.every((s) => s.confidence === 'certain')).toBe(true);
    expect(audit.certainCount).toBe(certain.length);
  });
});
