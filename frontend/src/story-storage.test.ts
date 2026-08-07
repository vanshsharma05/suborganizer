/**
 * The read cache in story-storage.
 *
 * Caching the launch-path read is what keeps the splash from uncovering a
 * spinner, but a cache that outlives its writers is worse than no cache: "watch
 * again" would clear storage and the next launch would still be told the story
 * had played. These tests exist for that failure, not for the speed-up.
 *
 * Each case re-imports the module, because the cache is module state and the
 * read starts at import.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const getItem = vi.fn(async (k: string) => store.get(k) ?? null);
const setItem = vi.fn(async (k: string, v: string) => void store.set(k, v));
const removeItem = vi.fn(async (k: string) => void store.delete(k));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem, setItem, removeItem },
}));

const KEY = 'story.lastShown.v1';

async function load() {
  vi.resetModules();
  return import('./story-storage');
}

beforeEach(() => {
  store.clear();
  getItem.mockClear();
  setItem.mockClear();
  removeItem.mockClear();
});

describe('the read cache', () => {
  it('reads storage once however many times it is asked', async () => {
    const s = await load();

    await s.shouldPlayNow(true);
    await s.shouldPlayNow(true);
    await s.shouldPlayNow(true);

    // One read, started at import — not one per call.
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it('starts the read at import, before anything asks', async () => {
    await load();
    expect(getItem).toHaveBeenCalledWith(KEY);
  });

  it('lets "watch again" actually replay', async () => {
    // Played today, so the gate would normally refuse.
    const today = new Date(2026, 7, 7);
    store.set(KEY, today.toISOString().slice(0, 10));

    const s = await load();
    expect(await s.shouldPlayNow(true, today)).toBe(false);

    await s.resetStory();

    // The whole point: a stale cache here would keep saying false and the
    // button would look broken.
    expect(await s.shouldPlayNow(true, today)).toBe(true);
  });

  it('stops replaying once it has been marked played', async () => {
    const today = new Date(2026, 7, 7);
    const s = await load();

    expect(await s.shouldPlayNow(true, today)).toBe(true);

    await s.markStoryPlayed(today);

    expect(await s.shouldPlayNow(true, today)).toBe(false);
  });

  it('survives storage that throws, rather than blocking the launch', async () => {
    getItem.mockRejectedValueOnce(new Error('storage unavailable'));

    const s = await load();

    // Resolves rather than rejecting; a device failure must not keep anyone out.
    await expect(s.shouldPlayNow(true)).resolves.toBeTypeOf('boolean');
  });
});
