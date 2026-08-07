/**
 * The worker pool, driven through fetchHeaders because `pool` is private.
 *
 * Written while chasing a bug that turned out not to exist. Moving cancellation
 * into the progress callback makes all eight concurrent runners throw at their
 * next tick, and that looks like it should leave seven unhandled rejections
 * behind Promise.all. It does not: Promise.all subscribes to every promise as it
 * iterates, so the later rejections are handled and discarded. These tests pin
 * that, so the next person to have the same worry can read the answer instead of
 * rewriting the pool for it.
 *
 * What they do assert is the behaviour cancellation depends on: the throw
 * surfaces, it surfaces as the first failure, and an uninterrupted run still
 * returns everything.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// client.ts takes GmailAuthError from ./auth, and ./auth reaches expo-auth-session
// and React Native, which vitest cannot parse. The class is the only thing needed
// here, and it is declared inline because vi.mock factories are hoisted above
// every binding in the file.
vi.mock('./auth', () => ({
  GmailAuthError: class GmailAuthError extends Error {},
}));

/* eslint-disable import/first -- must come after the mock above, or it binds to
   the real module and pulls React Native in with it. */
import { fetchHeaders } from './client';

const ids = Array.from({ length: 40 }, (_, i) => `m${i}`);

/** A well-formed Gmail metadata response, so only the pool is under test. */
function ok(id: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id,
      threadId: 't',
      snippet: 'Your receipt',
      internalDate: '1750000000000',
      payload: { headers: [{ name: 'Subject', value: 'Receipt' }] },
    }),
  };
}

let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ok(String(url).split('/').pop() ?? 'm')));
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  vi.unstubAllGlobals();
});

/** Rejections surface on the microtask queue, so give them a turn to appear. */
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('pool, via fetchHeaders', () => {
  it('surfaces a throwing progress callback as a rejection', async () => {
    await expect(
      fetchHeaders('token', ids, () => {
        throw new Error('cancelled');
      }),
    ).rejects.toThrow('cancelled');
  });

  it('leaves no unhandled rejections when every runner throws at once', async () => {
    // Cancellation makes the callback throw for all eight concurrent runners,
    // not just the first to reach it. Promise.all has a handler on each, so
    // none of the later ones escapes.
    await fetchHeaders('token', ids, () => {
      throw new Error('cancelled');
    }).catch(() => {});

    await settle();

    expect(unhandled).toEqual([]);
  });

  it('still returns every result when nothing throws', async () => {
    const seen: number[] = [];
    const out = await fetchHeaders('token', ids, (n) => seen.push(n));

    expect(out).toHaveLength(ids.length);
    // Progress is reported once per message, ending on the total.
    expect(seen.at(-1)).toBe(ids.length);
  });

  it('reports the first failure rather than a later one', async () => {
    let calls = 0;
    await expect(
      fetchHeaders('token', ids, () => {
        calls += 1;
        throw new Error(`failure ${calls}`);
      }),
    ).rejects.toThrow('failure 1');
  });
});
