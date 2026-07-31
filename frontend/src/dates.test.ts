import { describe, expect, it } from 'vitest';
import {
  addDaysISO,
  daysUntilISO,
  parseISODate,
  shiftISODate,
  startOfLocalDay,
  todayISO,
  toISODate,
} from './dates';

describe('toISODate', () => {
  it('formats the local calendar day', () => {
    expect(toISODate(new Date(2026, 6, 30, 14, 5))).toBe('2026-07-30');
  });

  it('zero-pads single-digit months and days', () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  /**
   * The regression this module exists for.
   *
   * The old code did `d.toISOString().split('T')[0]`, which converts to UTC
   * first. At UTC+5:30 every hour before 05:30 landed on the previous day, so a
   * trial started at 01:00 ended a day early. This fails on the old
   * implementation in any timezone that is not UTC, and passes in UTC too.
   */
  it('is the same day at every hour of that day', () => {
    const seen = new Set<string>();
    for (let hour = 0; hour < 24; hour++) {
      seen.add(toISODate(new Date(2026, 6, 30, hour, 30)));
    }
    expect([...seen]).toEqual(['2026-07-30']);
  });
});

describe('parseISODate', () => {
  it('reads a date-only string as local midnight, not UTC midnight', () => {
    const d = parseISODate('2026-07-30')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(30);
    expect(d.getHours()).toBe(0);
  });

  it('ignores a trailing time component', () => {
    expect(toISODate(parseISODate('2026-07-30T23:59:59Z')!)).toBe('2026-07-30');
  });

  it('returns null for anything unparseable', () => {
    for (const bad of [null, undefined, '', 'tomorrow', '30-07-2026', '2026-7-3']) {
      expect(parseISODate(bad)).toBeNull();
    }
  });

  it('round-trips with toISODate', () => {
    for (const iso of ['2026-01-01', '2026-02-28', '2026-12-31', '2028-02-29']) {
      expect(toISODate(parseISODate(iso)!)).toBe(iso);
    }
  });
});

describe('addDaysISO', () => {
  it('adds days', () => {
    expect(addDaysISO(new Date(2026, 6, 30), 7)).toBe('2026-08-06');
  });

  it('crosses a month boundary', () => {
    expect(addDaysISO(new Date(2026, 6, 30), 2)).toBe('2026-08-01');
  });

  it('crosses a year boundary', () => {
    expect(addDaysISO(new Date(2026, 11, 30), 3)).toBe('2027-01-02');
  });

  it('handles a leap day', () => {
    expect(addDaysISO(new Date(2028, 1, 28), 1)).toBe('2028-02-29');
    expect(addDaysISO(new Date(2027, 1, 28), 1)).toBe('2027-03-01');
  });

  it('goes backwards for a negative count', () => {
    expect(addDaysISO(new Date(2026, 7, 1), -1)).toBe('2026-07-31');
  });

  it('is unaffected by the time of day it is called at', () => {
    const early = addDaysISO(new Date(2026, 6, 30, 0, 1), 14);
    const late = addDaysISO(new Date(2026, 6, 30, 23, 59), 14);
    expect(early).toBe(late);
    expect(early).toBe('2026-08-13');
  });
});

describe('shiftISODate', () => {
  it('shifts a date string', () => {
    expect(shiftISODate('2026-07-30', 7)).toBe('2026-08-06');
    expect(shiftISODate('2026-07-30', -1)).toBe('2026-07-29');
  });

  it('is reversible, so bumping a renewal and undoing it returns the original', () => {
    expect(shiftISODate(shiftISODate('2026-02-28', 30), -30)).toBe('2026-02-28');
  });

  it('passes an unparseable value through rather than inventing a date', () => {
    expect(shiftISODate('not-a-date', 7)).toBe('not-a-date');
  });
});

describe('daysUntilISO', () => {
  const today = new Date(2026, 6, 30, 15, 0);

  it('counts calendar days ahead', () => {
    expect(daysUntilISO('2026-07-30', today)).toBe(0);
    expect(daysUntilISO('2026-07-31', today)).toBe(1);
    expect(daysUntilISO('2026-08-06', today)).toBe(7);
  });

  it('goes negative for a past date', () => {
    expect(daysUntilISO('2026-07-29', today)).toBe(-1);
  });

  it('counts calendar days, not 24-hour blocks', () => {
    // Late at night, "tomorrow" is still 1 day away — not 0, which is what
    // subtracting raw timestamps would give.
    expect(daysUntilISO('2026-07-31', new Date(2026, 6, 30, 23, 59))).toBe(1);
    expect(daysUntilISO('2026-07-31', new Date(2026, 6, 30, 0, 1))).toBe(1);
  });

  it('survives a DST-style month with the same answer all day', () => {
    const answers = new Set<number | null>();
    for (let hour = 0; hour < 24; hour++) {
      answers.add(daysUntilISO('2026-11-15', new Date(2026, 10, 1, hour, 30)));
    }
    expect(answers.size).toBe(1);
  });

  it('returns null when the date is missing or malformed', () => {
    expect(daysUntilISO(null, today)).toBeNull();
    expect(daysUntilISO('soon', today)).toBeNull();
  });
});

describe('startOfLocalDay', () => {
  it('strips the time without moving the day', () => {
    const d = startOfLocalDay(new Date(2026, 6, 30, 23, 59, 59, 999));
    expect(d.getDate()).toBe(30);
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([0, 0, 0, 0]);
  });

  it('does not mutate its argument', () => {
    const original = new Date(2026, 6, 30, 12, 0);
    startOfLocalDay(original);
    expect(original.getHours()).toBe(12);
  });
});

describe('todayISO', () => {
  it('agrees with toISODate of now', () => {
    expect(todayISO()).toBe(toISODate(new Date()));
  });
});
