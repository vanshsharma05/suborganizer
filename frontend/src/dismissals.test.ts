import { describe, expect, it } from 'vitest';
import { activeIds, dismiss, DISMISSAL_TTL_DAYS, prune, restore } from './dismissals';

const TODAY = new Date(2026, 6, 31);

/** `n` days before TODAY, as the ISO day the module stores. */
function daysAgo(n: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('dismiss / restore', () => {
  it('records the day it was dismissed', () => {
    expect(dismiss({}, 'bundled:a', TODAY)).toEqual({ 'bundled:a': '2026-07-31' });
  });

  it('does not disturb other entries', () => {
    const map = dismiss({ 'rise:x': daysAgo(3) }, 'bundled:a', TODAY);
    expect(Object.keys(map).sort()).toEqual(['bundled:a', 'rise:x']);
  });

  it('restores one without touching the rest', () => {
    const map = { 'a': daysAgo(1), 'b': daysAgo(2) };
    expect(restore(map, 'a')).toEqual({ b: daysAgo(2) });
  });

  it('restoring something never dismissed is a no-op', () => {
    expect(restore({ a: daysAgo(1) }, 'nope')).toEqual({ a: daysAgo(1) });
  });
});

describe('prune', () => {
  it('keeps a fresh dismissal', () => {
    expect(prune({ a: daysAgo(1) }, TODAY)).toEqual({ a: daysAgo(1) });
  });

  it('keeps one dismissed exactly on the boundary', () => {
    const map = { a: daysAgo(DISMISSAL_TTL_DAYS) };
    expect(prune(map, TODAY)).toEqual(map);
  });

  it('drops one past the boundary', () => {
    expect(prune({ a: daysAgo(DISMISSAL_TTL_DAYS + 1) }, TODAY)).toEqual({});
  });

  /**
   * The failure that matters. Treating an unreadable date as a live dismissal
   * would hide a finding forever with nothing in the interface admitting it is
   * hidden — the user would simply never be told about money they could save.
   */
  it('treats an unparseable date as expired, not as fresh', () => {
    expect(prune({ a: 'not-a-date' }, TODAY)).toEqual({});
    expect(prune({ a: '' }, TODAY)).toEqual({});
  });

  it('keeps the fresh and drops the stale in one pass', () => {
    const map = { fresh: daysAgo(10), stale: daysAgo(400), broken: 'x' };
    expect(prune(map, TODAY)).toEqual({ fresh: daysAgo(10) });
  });
});

describe('activeIds', () => {
  it('returns only unexpired ids', () => {
    const ids = activeIds({ fresh: daysAgo(5), stale: daysAgo(999) }, TODAY);
    expect(ids.has('fresh')).toBe(true);
    expect(ids.has('stale')).toBe(false);
    expect(ids.size).toBe(1);
  });

  it('is empty for an empty map', () => {
    expect(activeIds({}, TODAY).size).toBe(0);
  });
});
