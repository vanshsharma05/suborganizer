import { describe, expect, it } from 'vitest';
import type { Subscription } from './api';
import {
  activeTrials,
  isInTrial,
  splitByTrial,
  trialDaysLeft,
  trialLabel,
} from './trials';

/** A fixed "today" so nothing here depends on when the suite runs. */
const TODAY = new Date(2026, 6, 30); // 30 July 2026, local

function sub(over: Partial<Subscription> = {}): Subscription {
  return {
    id: over.id ?? 'sub-1',
    name: 'Netflix',
    amount: 649,
    currency: 'INR',
    billing_cycle: 'monthly',
    category: 'Entertainment',
    next_renewal: '2026-08-30',
    status: 'active',
    ...over,
  };
}

describe('trialDaysLeft', () => {
  it('is null when the subscription is not a trial', () => {
    expect(trialDaysLeft(sub({ is_trial: false, trial_ends: '2026-08-05' }), TODAY)).toBeNull();
  });

  it('is null when a trial has no end date', () => {
    expect(trialDaysLeft(sub({ is_trial: true, trial_ends: null }), TODAY)).toBeNull();
  });

  it('counts whole days ahead', () => {
    expect(trialDaysLeft(sub({ is_trial: true, trial_ends: '2026-08-06' }), TODAY)).toBe(7);
  });

  it('is 0 on the day the trial ends', () => {
    expect(trialDaysLeft(sub({ is_trial: true, trial_ends: '2026-07-30' }), TODAY)).toBe(0);
  });

  it('goes negative once the trial has converted', () => {
    expect(trialDaysLeft(sub({ is_trial: true, trial_ends: '2026-07-28' }), TODAY)).toBe(-2);
  });

  it('ignores the time of day on either side', () => {
    const lateEvening = new Date(2026, 6, 30, 23, 59, 30);
    expect(trialDaysLeft(sub({ is_trial: true, trial_ends: '2026-07-31' }), lateEvening)).toBe(1);
  });

  it('survives a malformed date rather than returning NaN', () => {
    expect(trialDaysLeft(sub({ is_trial: true, trial_ends: 'not-a-date' }), TODAY)).toBeNull();
  });

  it('handles a month boundary', () => {
    expect(trialDaysLeft(sub({ is_trial: true, trial_ends: '2026-08-01' }), TODAY)).toBe(2);
  });
});

describe('isInTrial', () => {
  it('is true up to and including the last day', () => {
    expect(isInTrial(sub({ is_trial: true, trial_ends: '2026-07-30' }), TODAY)).toBe(true);
    expect(isInTrial(sub({ is_trial: true, trial_ends: '2026-08-10' }), TODAY)).toBe(true);
  });

  it('converts on its own the day after it ends', () => {
    expect(isInTrial(sub({ is_trial: true, trial_ends: '2026-07-29' }), TODAY)).toBe(false);
  });

  it('is false for a cancelled or paused trial', () => {
    const ends = '2026-08-10';
    expect(isInTrial(sub({ is_trial: true, trial_ends: ends, status: 'cancelled' }), TODAY)).toBe(false);
    expect(isInTrial(sub({ is_trial: true, trial_ends: ends, status: 'paused' }), TODAY)).toBe(false);
  });

  it('is false for an ordinary subscription', () => {
    expect(isInTrial(sub(), TODAY)).toBe(false);
  });
});

describe('splitByTrial', () => {
  it('keeps running trials out of the charging list', () => {
    const paid = sub({ id: 'paid' });
    const trialing = sub({ id: 'trial', is_trial: true, trial_ends: '2026-08-05' });
    const expired = sub({ id: 'expired', is_trial: true, trial_ends: '2026-07-01' });

    const result = splitByTrial([paid, trialing, expired], TODAY);

    expect(result.trialing.map((s) => s.id)).toEqual(['trial']);
    // An expired trial is now a real cost and must be counted.
    expect(result.charging.map((s) => s.id).sort()).toEqual(['expired', 'paid']);
  });

  it('returns empty lists for empty input', () => {
    expect(splitByTrial([], TODAY)).toEqual({ charging: [], trialing: [] });
  });
});

describe('activeTrials', () => {
  it('orders by soonest to expire', () => {
    const far = sub({ id: 'far', is_trial: true, trial_ends: '2026-08-20' });
    const soon = sub({ id: 'soon', is_trial: true, trial_ends: '2026-07-31' });
    const mid = sub({ id: 'mid', is_trial: true, trial_ends: '2026-08-04' });

    expect(activeTrials([far, soon, mid], TODAY).map((s) => s.id)).toEqual(['soon', 'mid', 'far']);
  });

  it('excludes expired and non-active trials', () => {
    const expired = sub({ id: 'expired', is_trial: true, trial_ends: '2026-07-01' });
    const cancelled = sub({
      id: 'cancelled', is_trial: true, trial_ends: '2026-08-05', status: 'cancelled',
    });

    expect(activeTrials([expired, cancelled], TODAY)).toEqual([]);
  });
});

describe('trialLabel', () => {
  it('reads naturally at each boundary', () => {
    expect(trialLabel(0)).toBe('ends today');
    expect(trialLabel(1)).toBe('ends tomorrow');
    expect(trialLabel(5)).toBe('5 days left');
    expect(trialLabel(-1)).toBe('trial ended');
  });
});
