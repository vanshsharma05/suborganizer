import { describe, expect, it } from 'vitest';
import {
  ageOf, dueForReview, forget, isDormant, isDue, prune, record,
  REVIEW_EVERY_DAYS, UNUSED_AFTER_DAYS, unusedFor, type UsageLog,
} from './usage';

const TODAY = new Date(2026, 7, 3); // 3 August 2026

/** `n` days before TODAY, as the ISO day the module stores. */
function daysAgo(n: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('record', () => {
  it('stores the answer and the day it was given', () => {
    expect(record({}, 'a', true, TODAY)).toEqual({ a: { on: '2026-08-03', used: true } });
    expect(record({}, 'a', false, TODAY)).toEqual({ a: { on: '2026-08-03', used: false } });
  });

  it('replaces an earlier answer rather than accumulating', () => {
    const first = record({}, 'a', false, TODAY);
    const second = record(first, 'a', true, TODAY);
    expect(second).toEqual({ a: { on: '2026-08-03', used: true } });
  });

  it('leaves other subscriptions alone', () => {
    const log = record({ b: { on: daysAgo(4), used: true } }, 'a', true, TODAY);
    expect(Object.keys(log).sort()).toEqual(['a', 'b']);
  });
});

describe('forget', () => {
  it('removes one answer and keeps the rest', () => {
    const log: UsageLog = { a: { on: daysAgo(1), used: true }, b: { on: daysAgo(2), used: false } };
    expect(forget(log, 'a')).toEqual({ b: { on: daysAgo(2), used: false } });
  });

  it('forgetting something never answered is a no-op', () => {
    const log: UsageLog = { a: { on: daysAgo(1), used: true } };
    expect(forget(log, 'nope')).toEqual(log);
  });
});

describe('ageOf', () => {
  it('counts days since the answer', () => {
    expect(ageOf({ a: { on: daysAgo(9), used: true } }, 'a', TODAY)).toBe(9);
    expect(ageOf({ a: { on: daysAgo(0), used: true } }, 'a', TODAY)).toBe(0);
  });

  it('is null when there is no answer', () => {
    expect(ageOf({}, 'a', TODAY)).toBeNull();
  });

  /**
   * An unreadable date must not read as a fresh answer. Treating it as fresh
   * would suppress the review forever for that subscription, with nothing in
   * the interface admitting it had been suppressed.
   */
  it('is null when the stored date cannot be read', () => {
    expect(ageOf({ a: { on: 'not-a-date', used: true } }, 'a', TODAY)).toBeNull();
    expect(ageOf({ a: { on: '', used: false } }, 'a', TODAY)).toBeNull();
  });
});

describe('isDue', () => {
  it('is due when never answered', () => {
    expect(isDue({}, 'a', TODAY)).toBe(true);
  });

  it('is not due the day after answering', () => {
    expect(isDue({ a: { on: daysAgo(1), used: true } }, 'a', TODAY)).toBe(false);
  });

  it('is due exactly on the review boundary', () => {
    expect(isDue({ a: { on: daysAgo(REVIEW_EVERY_DAYS), used: true } }, 'a', TODAY)).toBe(true);
  });

  it('is not due one day before the boundary', () => {
    expect(isDue({ a: { on: daysAgo(REVIEW_EVERY_DAYS - 1), used: true } }, 'a', TODAY)).toBe(false);
  });

  it('goes stale the same way whichever the answer was', () => {
    const old = daysAgo(REVIEW_EVERY_DAYS + 5);
    expect(isDue({ a: { on: old, used: true } }, 'a', TODAY)).toBe(true);
    expect(isDue({ a: { on: old, used: false } }, 'a', TODAY)).toBe(true);
  });

  it('is due again when the stored date is unreadable', () => {
    expect(isDue({ a: { on: 'rubbish', used: true } }, 'a', TODAY)).toBe(true);
  });
});

describe('dueForReview', () => {
  it('returns only what is due', () => {
    const log: UsageLog = {
      fresh: { on: daysAgo(2), used: true },
      stale: { on: daysAgo(90), used: true },
    };
    expect(dueForReview(['fresh', 'stale', 'never'], log, TODAY).sort()).toEqual(['never', 'stale']);
  });

  /** Longest-unanswered first, so an abandoned review still did the most good. */
  it('asks about the least-known first', () => {
    const log: UsageLog = {
      recent: { on: daysAgo(31), used: true },
      ancient: { on: daysAgo(400), used: true },
    };
    expect(dueForReview(['recent', 'ancient', 'never'], log, TODAY)).toEqual([
      'never', 'ancient', 'recent',
    ]);
  });

  it('is empty when everything has been answered recently', () => {
    const log: UsageLog = { a: { on: daysAgo(1), used: true }, b: { on: daysAgo(3), used: false } };
    expect(dueForReview(['a', 'b'], log, TODAY)).toEqual([]);
  });

  it('does not invent ids that were not passed in', () => {
    const log: UsageLog = { gone: { on: daysAgo(90), used: false } };
    expect(dueForReview(['a'], log, TODAY)).toEqual(['a']);
  });
});

describe('unusedFor', () => {
  it('counts days since a "no"', () => {
    expect(unusedFor({ a: { on: daysAgo(70), used: false } }, 'a', TODAY)).toBe(70);
  });

  /**
   * Silence is not evidence. Someone who has never been asked has not told us
   * they are not using it, and billing a finding to them would be putting words
   * in their mouth.
   */
  it('is null when they said they use it', () => {
    expect(unusedFor({ a: { on: daysAgo(70), used: true } }, 'a', TODAY)).toBeNull();
  });

  it('is null when they have never been asked', () => {
    expect(unusedFor({}, 'a', TODAY)).toBeNull();
  });
});

describe('isDormant', () => {
  it('needs a "no" that has stood long enough', () => {
    expect(isDormant({ a: { on: daysAgo(UNUSED_AFTER_DAYS), used: false } }, 'a', TODAY)).toBe(true);
  });

  it('one quiet month is not enough', () => {
    expect(isDormant({ a: { on: daysAgo(UNUSED_AFTER_DAYS - 1), used: false } }, 'a', TODAY)).toBe(false);
  });

  it('never fires on a yes, however old', () => {
    expect(isDormant({ a: { on: daysAgo(999), used: true } }, 'a', TODAY)).toBe(false);
  });

  it('never fires on silence', () => {
    expect(isDormant({}, 'a', TODAY)).toBe(false);
  });

  it('never fires on a date it cannot read', () => {
    expect(isDormant({ a: { on: 'nope', used: false } }, 'a', TODAY)).toBe(false);
  });
});

describe('prune', () => {
  it('drops answers for subscriptions that are gone', () => {
    const log: UsageLog = {
      alive: { on: daysAgo(1), used: true },
      deleted: { on: daysAgo(1), used: false },
    };
    expect(prune(log, ['alive'])).toEqual({ alive: { on: daysAgo(1), used: true } });
  });

  it('keeps everything when everything is still there', () => {
    const log: UsageLog = { a: { on: daysAgo(1), used: true } };
    expect(prune(log, ['a', 'b'])).toEqual(log);
  });

  it('empties when nothing is left', () => {
    expect(prune({ a: { on: daysAgo(1), used: true } }, [])).toEqual({});
  });
});
