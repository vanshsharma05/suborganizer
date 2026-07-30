import { describe, expect, it } from 'vitest';
import { CYCLE_DAYS, monthlyEquivalent } from './cycles';

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
