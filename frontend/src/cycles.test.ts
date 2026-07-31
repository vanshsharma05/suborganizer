import { describe, expect, it } from 'vitest';
import { advanceRenewal, CYCLE_DAYS, monthlyEquivalent } from './cycles';

describe('monthlyEquivalent', () => {
  it('leaves a monthly amount alone', () => {
    expect(monthlyEquivalent(649, 'monthly')).toBe(649);
  });

  it('divides a yearly amount by twelve', () => {
    expect(monthlyEquivalent(1499, 'yearly')).toBeCloseTo(124.92, 2);
  });

  it('uses 4.33 weeks per month, not 4', () => {
    // 4 would understate a weekly subscription by roughly 8% — the sort of
    // quiet error the app exists to catch, so it must not be in the app itself.
    expect(monthlyEquivalent(100, 'weekly')).toBeCloseTo(433, 0);
    expect(monthlyEquivalent(100, 'weekly') * 12).toBeCloseTo(5196, 0);
  });

  it('treats an unknown cycle as monthly rather than throwing', () => {
    // Rows written before the cycle set was fixed, or anything unexpected from
    // the Gmail scan, must not blow up a dashboard total.
    expect(monthlyEquivalent(500, 'quarterly')).toBe(500);
    expect(monthlyEquivalent(500, '')).toBe(500);
  });

  it('handles zero and keeps sign', () => {
    expect(monthlyEquivalent(0, 'yearly')).toBe(0);
    expect(monthlyEquivalent(-120, 'yearly')).toBe(-10);
  });
});

describe('CYCLE_DAYS', () => {
  it('covers every cycle the schema allows', () => {
    expect(Object.keys(CYCLE_DAYS).sort()).toEqual(['monthly', 'weekly', 'yearly']);
  });
});

describe('advanceRenewal', () => {
  it('adds a week', () => {
    expect(advanceRenewal('2026-07-30', 'weekly')).toBe('2026-08-06');
  });

  it('adds a month', () => {
    expect(advanceRenewal('2026-07-15', 'monthly')).toBe('2026-08-15');
  });

  it('adds a year', () => {
    expect(advanceRenewal('2026-07-15', 'yearly')).toBe('2027-07-15');
  });

  it('rolls a monthly cycle over the year end', () => {
    expect(advanceRenewal('2026-12-15', 'monthly')).toBe('2027-01-15');
  });

  /**
   * The clamp is the whole reason this is not `+1 month`. Overflowing 31 January
   * into 3 March puts every later renewal a month adrift, and the user would be
   * reminded on the wrong day forever after.
   */
  it('clamps a month-end day to the shorter month', () => {
    expect(advanceRenewal('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(advanceRenewal('2028-01-31', 'monthly')).toBe('2028-02-29'); // leap year
    expect(advanceRenewal('2026-03-31', 'monthly')).toBe('2026-04-30');
    expect(advanceRenewal('2026-05-31', 'monthly')).toBe('2026-06-30');
  });

  it('clamps 29 February on a yearly cycle to 28 February', () => {
    expect(advanceRenewal('2028-02-29', 'yearly')).toBe('2029-02-28');
  });

  it('treats an unknown cycle as monthly', () => {
    expect(advanceRenewal('2026-07-15', 'quarterly')).toBe('2026-08-15');
  });

  it('passes a malformed date through instead of inventing one', () => {
    expect(advanceRenewal('not-a-date', 'monthly')).toBe('not-a-date');
    expect(advanceRenewal('', 'monthly')).toBe('');
  });

  it('always moves forward, never sideways', () => {
    // Steps a whole year one month at a time, which walks every month-length
    // combination including the February clamp.
    let iso = '2026-01-31';
    for (let i = 0; i < 24; i++) {
      const next = advanceRenewal(iso, 'monthly');
      expect(next > iso).toBe(true);
      iso = next;
    }
    expect(iso).toBe('2028-01-28');
  });
});
