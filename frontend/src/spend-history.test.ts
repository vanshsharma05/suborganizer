import { describe, expect, it } from 'vitest';
import { amountOn, chargeDates, spentSince, trackedDays } from './spend-history';

const TODAY = '2026-08-04';

describe('chargeDates', () => {
  it('lists the monthly charges since tracking began, newest first', () => {
    expect(chargeDates({
      nextRenewalISO: '2026-09-15',
      cycle: 'monthly',
      fromISO: '2026-05-01',
      todayISO: TODAY,
    })).toEqual(['2026-07-15', '2026-06-15', '2026-05-15']);
  });

  it('counts a renewal falling exactly today', () => {
    expect(chargeDates({
      nextRenewalISO: '2026-08-04',
      cycle: 'monthly',
      fromISO: '2026-07-01',
      todayISO: TODAY,
    })).toEqual(['2026-08-04', '2026-07-04']);
  });

  /**
   * The window start is exclusive. A subscription added on the day it renews
   * has not been charged through this app, and counting it would attribute a
   * payment to a window that did not contain it.
   */
  it('excludes a charge on the day tracking started', () => {
    expect(chargeDates({
      nextRenewalISO: '2026-09-01',
      cycle: 'monthly',
      fromISO: '2026-07-01',
      todayISO: TODAY,
    })).toEqual(['2026-08-01']);
  });

  it('is empty when nothing has renewed yet', () => {
    expect(chargeDates({
      nextRenewalISO: '2026-12-01',
      cycle: 'yearly',
      fromISO: '2026-07-20',
      todayISO: TODAY,
    })).toEqual([]);
  });

  /**
   * A stored date goes stale for anyone who does not open the app. Walking back
   * from it rather than from the real position would hide every charge since.
   */
  it('finds charges hidden behind a stale renewal date', () => {
    expect(chargeDates({
      nextRenewalISO: '2026-03-10',
      cycle: 'monthly',
      fromISO: '2026-01-01',
      todayISO: TODAY,
    })).toEqual([
      // Not 10 August: that one has not happened yet on the 4th.
      '2026-07-10', '2026-06-10', '2026-05-10',
      '2026-04-10', '2026-03-10', '2026-02-10',
      '2026-01-10',
    ]);
  });

  it('holds the anchor day walking backwards through February', () => {
    expect(chargeDates({
      nextRenewalISO: '2026-04-30',
      cycle: 'monthly',
      anchorDay: 31,
      fromISO: '2025-12-15',
      todayISO: '2026-04-01',
    })).toEqual(['2026-03-31', '2026-02-28', '2026-01-31', '2025-12-31']);
  });

  it('keeps the weekday on a weekly cycle', () => {
    const dates = chargeDates({
      nextRenewalISO: '2026-08-11',
      cycle: 'weekly',
      fromISO: '2026-07-10',
      todayISO: TODAY,
    });
    expect(dates).toEqual(['2026-08-04', '2026-07-28', '2026-07-21', '2026-07-14']);
    for (const d of dates) {
      expect(new Date(`${d}T00:00:00Z`).getUTCDay()).toBe(2); // Tuesday
    }
  });

  it('handles yearly cycles', () => {
    expect(chargeDates({
      nextRenewalISO: '2026-11-20',
      cycle: 'yearly',
      fromISO: '2023-01-05',
      todayISO: TODAY,
    })).toEqual(['2025-11-20', '2024-11-20', '2023-11-20']);
  });

  it('gives up on dates it cannot read rather than spinning', () => {
    expect(chargeDates({
      nextRenewalISO: 'not-a-date',
      cycle: 'monthly',
      fromISO: '2026-01-01',
      todayISO: TODAY,
    })).toEqual([]);
    expect(chargeDates({
      nextRenewalISO: '2026-09-15',
      cycle: 'monthly',
      fromISO: '',
      todayISO: TODAY,
    })).toEqual([]);
  });

  it('is empty when tracking started in the future', () => {
    expect(chargeDates({
      nextRenewalISO: '2026-09-15',
      cycle: 'monthly',
      fromISO: '2026-12-01',
      todayISO: TODAY,
    })).toEqual([]);
  });
});

describe('amountOn', () => {
  const changes = [
    { changed_at: '2026-03-01T10:00:00Z', old_amount: 499, new_amount: 649 },
    { changed_at: '2026-06-15T10:00:00Z', old_amount: 649, new_amount: 799 },
  ];

  it('uses the current amount when nothing ever changed', () => {
    expect(amountOn('2026-01-01', 649, [])).toBe(649);
  });

  /**
   * Charging today's price for last year's renewals always overstates — every
   * subscription that has ever risen would report more than was paid.
   */
  it('uses the old amount before the first change', () => {
    expect(amountOn('2026-01-15', 799, changes)).toBe(499);
    expect(amountOn('2026-02-28', 799, changes)).toBe(499);
  });

  it('uses the new amount from the day of the change', () => {
    expect(amountOn('2026-03-01', 799, changes)).toBe(649);
    expect(amountOn('2026-04-10', 799, changes)).toBe(649);
  });

  it('uses the latest amount after the last change', () => {
    expect(amountOn('2026-06-15', 799, changes)).toBe(799);
    expect(amountOn('2026-08-01', 799, changes)).toBe(799);
  });

  it('does not care what order the changes arrive in', () => {
    expect(amountOn('2026-04-10', 799, [...changes].reverse())).toBe(649);
  });
});

describe('spentSince', () => {
  const base = {
    nextRenewalISO: '2026-09-15',
    cycle: 'monthly',
    amount: 649,
    status: 'active',
    createdAtISO: '2026-05-01T08:30:00Z',
    todayISO: TODAY,
  };

  it('multiplies the charges by the price in effect at each', () => {
    // 15 May, 15 Jun, 15 Jul.
    expect(spentSince(base)).toBe(649 * 3);
  });

  it('prices each charge with the amount that applied then', () => {
    expect(spentSince({
      ...base,
      changes: [{ changed_at: '2026-07-01', old_amount: 499, new_amount: 649 }],
    })).toBe(499 + 499 + 649);
  });

  it('is zero when nothing has renewed yet', () => {
    expect(spentSince({ ...base, createdAtISO: '2026-08-01' })).toBe(0);
  });

  /**
   * Null, not zero. Zero is a claim — "you have paid nothing" — and a
   * subscription cancelled on a day nothing recorded cannot be counted at all
   * without inventing payments.
   */
  it('refuses to answer for anything not active', () => {
    expect(spentSince({ ...base, status: 'paused' })).toBeNull();
    expect(spentSince({ ...base, status: 'cancelled' })).toBeNull();
  });

  it('refuses to answer without a start date', () => {
    expect(spentSince({ ...base, createdAtISO: null })).toBeNull();
    expect(spentSince({ ...base, createdAtISO: undefined })).toBeNull();
  });

  it('reads a bare date as well as a timestamp', () => {
    expect(spentSince({ ...base, createdAtISO: '2026-05-01' })).toBe(649 * 3);
  });

  it('holds the anchor day, so a February does not go missing', () => {
    expect(spentSince({
      ...base,
      nextRenewalISO: '2026-04-30',
      anchorDay: 31,
      createdAtISO: '2025-12-15',
      todayISO: '2026-04-01',
      amount: 100,
    })).toBe(400);
  });
});

describe('trackedDays', () => {
  it('counts days since tracking began', () => {
    expect(trackedDays('2026-07-04', TODAY)).toBe(31);
    expect(trackedDays('2026-08-04T09:00:00Z', TODAY)).toBe(0);
  });

  it('never goes negative', () => {
    expect(trackedDays('2026-12-01', TODAY)).toBe(0);
  });

  it('is zero for anything it cannot read', () => {
    expect(trackedDays(null, TODAY)).toBe(0);
    expect(trackedDays(undefined, TODAY)).toBe(0);
    expect(trackedDays('rubbish', TODAY)).toBe(0);
  });
});
