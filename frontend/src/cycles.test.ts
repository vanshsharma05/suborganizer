import { describe, expect, it } from 'vitest';
import {
  advanceRenewal, anchorDayOf, currentRenewal, CYCLE_DAYS, monthlyEquivalent,
} from './cycles';

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

describe('currentRenewal', () => {
  it('leaves a future date alone', () => {
    expect(currentRenewal('2026-09-15', 'monthly', '2026-08-03')).toBe('2026-09-15');
  });

  it('leaves today alone — it renews today, not next month', () => {
    expect(currentRenewal('2026-08-03', 'monthly', '2026-08-03')).toBe('2026-08-03');
  });

  it('rolls a one-cycle-stale monthly date forward', () => {
    expect(currentRenewal('2026-07-15', 'monthly', '2026-08-03')).toBe('2026-08-15');
  });

  /**
   * The case that made "Keep it" look broken. A single advance left this two
   * months behind, so the reminder returned the moment the list refreshed.
   */
  it('rolls a three-month-stale date all the way to the future', () => {
    expect(currentRenewal('2026-05-10', 'monthly', '2026-08-03')).toBe('2026-08-10');
  });

  it('rolls weekly dates', () => {
    expect(currentRenewal('2026-07-01', 'weekly', '2026-08-03')).toBe('2026-08-05');
  });

  it('rolls yearly dates', () => {
    expect(currentRenewal('2023-11-20', 'yearly', '2026-08-03')).toBe('2026-11-20');
  });

  /**
   * The reason this counts from the anchor rather than stepping. Repeatedly
   * applying advanceRenewal gives 31 Jan -> 28 Feb -> 28 Mar -> 28 Apr, and the
   * 31st is lost for good the first time a February is crossed.
   */
  it('does not lose the day of the month when it crosses a short one', () => {
    expect(currentRenewal('2026-01-31', 'monthly', '2026-04-01')).toBe('2026-04-30');
    expect(currentRenewal('2026-01-31', 'monthly', '2026-03-01')).toBe('2026-03-31');
    expect(currentRenewal('2026-01-31', 'monthly', '2026-05-31')).toBe('2026-05-31');
  });

  it('still clamps into the month it actually lands on', () => {
    // February is the target month, so the 31st has nowhere else to go.
    expect(currentRenewal('2026-01-31', 'monthly', '2026-02-10')).toBe('2026-02-28');
  });

  it('holds the anchor across a leap year', () => {
    expect(currentRenewal('2024-01-31', 'monthly', '2024-02-05')).toBe('2024-02-29');
    expect(currentRenewal('2024-01-31', 'monthly', '2024-03-05')).toBe('2024-03-31');
  });

  it('holds a 29 February anchor on a yearly cycle', () => {
    expect(currentRenewal('2024-02-29', 'yearly', '2025-01-01')).toBe('2025-02-28');
    expect(currentRenewal('2024-02-29', 'yearly', '2028-01-01')).toBe('2028-02-29');
  });

  it('survives years of neglect without giving up', () => {
    // 8 March 2016 was a Tuesday, so every step lands on a Tuesday.
    expect(currentRenewal('2016-03-08', 'weekly', '2026-08-03')).toBe('2026-08-04');
  });

  /**
   * A corrupt date must terminate rather than spin. advanceRenewal returns its
   * input unchanged when it cannot parse it, which without a guard is an
   * infinite loop on the launch path.
   */
  it('gives up on an unparseable date instead of looping forever', () => {
    expect(currentRenewal('not-a-date', 'monthly', '2026-08-03')).toBe('not-a-date');
    expect(currentRenewal('', 'monthly', '2026-08-03')).toBe('');
  });

  it('treats an unknown cycle as monthly, as advanceRenewal does', () => {
    expect(currentRenewal('2026-06-10', 'fortnightly', '2026-08-03')).toBe('2026-08-10');
  });

  it('never returns a date before today for a valid input', () => {
    const cases: [string, string][] = [
      ['2020-01-01', 'weekly'],
      ['2021-06-30', 'monthly'],
      ['2019-12-31', 'yearly'],
      ['2026-01-31', 'monthly'],
    ];
    for (const [start, cycle] of cases) {
      expect(currentRenewal(start, cycle, '2026-08-03') >= '2026-08-03').toBe(true);
    }
  });
});

describe('anchorDayOf', () => {
  it('reads the day off an ISO date', () => {
    expect(anchorDayOf('2026-01-31')).toBe(31);
    expect(anchorDayOf('2026-02-01')).toBe(1);
  });

  it('is null for anything it cannot read', () => {
    expect(anchorDayOf('')).toBeNull();
    expect(anchorDayOf('2026-02')).toBeNull();
    expect(anchorDayOf('not-a-date')).toBeNull();
  });
});

/**
 * The bug this exists to stop.
 *
 * Clamping is lossy. 31 January becomes 28 February, and once that has been
 * written back, stepping from the 28th gives 28 March — so a subscription that
 * really bills on the 31st slides three days early and stays there, forever,
 * the first time it crosses a February.
 */
describe('advanceRenewal with an anchor day', () => {
  it('returns to the anchor after a short month', () => {
    // The exact drift: without the anchor this is 28 March.
    expect(advanceRenewal('2026-02-28', 'monthly', 31)).toBe('2026-03-31');
  });

  it('survives a whole year of short months', () => {
    const anchor = 31;
    let at = '2026-01-31';
    const seen: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      at = advanceRenewal(at, 'monthly', anchor);
      seen.push(at);
    }
    expect(seen).toEqual([
      '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31',
      '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30',
      '2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31',
    ]);
  });

  it('clamps to a leap February and comes back', () => {
    expect(advanceRenewal('2028-01-31', 'monthly', 31)).toBe('2028-02-29');
    expect(advanceRenewal('2028-02-29', 'monthly', 31)).toBe('2028-03-31');
  });

  it('holds the 30th through February too', () => {
    expect(advanceRenewal('2026-02-28', 'monthly', 30)).toBe('2026-03-30');
  });

  it('carries December into January', () => {
    expect(advanceRenewal('2026-12-31', 'monthly', 31)).toBe('2027-01-31');
  });

  it('anchors a yearly cycle across a leap year', () => {
    expect(advanceRenewal('2028-02-29', 'yearly', 29)).toBe('2029-02-28');
    expect(advanceRenewal('2029-02-28', 'yearly', 29)).toBe('2030-02-28');
  });

  /** A weekly cycle has no day of the month to hold; it must keep its weekday. */
  it('ignores the anchor on a weekly cycle', () => {
    expect(advanceRenewal('2026-02-28', 'weekly', 31)).toBe('2026-03-07');
  });

  it('behaves exactly as before when no anchor is given', () => {
    expect(advanceRenewal('2026-02-28', 'monthly')).toBe('2026-03-28');
    expect(advanceRenewal('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(advanceRenewal('2026-01-31', 'monthly', null)).toBe('2026-02-28');
  });
});

describe('currentRenewal with an anchor day', () => {
  it('rolls a stale date forward onto the anchor, not the stored day', () => {
    // Stored 28 Feb because February clamped it; the merchant bills on the 31st.
    expect(currentRenewal('2026-02-28', 'monthly', '2026-05-02', 31)).toBe('2026-05-31');
  });

  it('agrees with the stored day when they are the same', () => {
    expect(currentRenewal('2026-01-15', 'monthly', '2026-04-02', 15))
      .toBe(currentRenewal('2026-01-15', 'monthly', '2026-04-02'));
  });

  it('keeps the weekday on a weekly cycle, anchor or not', () => {
    const withAnchor = currentRenewal('2026-01-06', 'weekly', '2026-02-01', 31);
    expect(withAnchor).toBe(currentRenewal('2026-01-06', 'weekly', '2026-02-01'));
    // 6 Jan 2026 is a Tuesday, and so is the answer.
    expect(new Date(`${withAnchor}T00:00:00Z`).getUTCDay()).toBe(2);
  });

  it('still never returns a date in the past', () => {
    expect(currentRenewal('2026-01-31', 'monthly', '2026-08-03', 31) >= '2026-08-03').toBe(true);
  });
});
