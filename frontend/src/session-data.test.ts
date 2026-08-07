/**
 * The sign-out purge.
 *
 * The interesting test is not that multiRemove is called — it is that the two
 * lists between them account for every key the app persists. A key belonging to
 * neither is one somebody added without thinking about sign-out, which is
 * exactly how a device ends up holding the last user's data.
 */

import { describe, expect, it, vi } from 'vitest';

// vi.hoisted, because vi.mock is lifted above every const in this file and the
// import below is static — the factory would otherwise run before `multiRemove`
// exists. story-storage.test.ts sidesteps this by importing dynamically.
const { multiRemove } = vi.hoisted(() => ({ multiRemove: vi.fn(async () => {}) }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { multiRemove },
}));

/* eslint-disable import/first -- vi.mock is hoisted above every import in
   the file, so the module under test has to be imported after the mock is
   declared or it binds to the real dependency. Reordering breaks the test. */
import { KEPT_ON_SIGN_OUT, PURGED_ON_SIGN_OUT, purgeSessionData } from './session-data';

/**
 * Every key the app writes, as of this test.
 *
 * Hard-coded on purpose. Deriving it by scanning source would make the test
 * agree with the code by construction and assert nothing — the point is that a
 * human wrote this down and has to come back when it changes.
 */
const EVERY_PERSISTED_KEY = [
  'billing.devOwned.v1',
  'billing.owned.v1',
  'fx.usdinr.v1',
  'gmail.connection.v1',
  'gmail.mailboxes.v1',
  'savings.dismissed.v1',
  'splash.played.v1',
  'story.lastShown.v1',
  'usage.answers.v1',
];

/** Cleared by disconnectGmail(), which also revokes the grant with Google. */
const HANDLED_BY_GMAIL_DISCONNECT = ['gmail.mailboxes.v1', 'gmail.connection.v1'];

describe('purgeSessionData', () => {
  it('removes exactly the keys on the purge list', async () => {
    multiRemove.mockClear();
    await purgeSessionData();
    expect(multiRemove).toHaveBeenCalledWith([...PURGED_ON_SIGN_OUT]);
  });

  it('accounts for every key the app persists', () => {
    const accounted = new Set<string>([
      ...PURGED_ON_SIGN_OUT,
      ...KEPT_ON_SIGN_OUT,
      ...HANDLED_BY_GMAIL_DISCONNECT,
    ]);
    const orphans = EVERY_PERSISTED_KEY.filter((k) => !accounted.has(k));

    // If this fails, a key was added without deciding what sign-out does with
    // it. Put it in PURGED_ON_SIGN_OUT or in KEPT_ON_SIGN_OUT with a reason.
    expect(orphans).toEqual([]);
  });

  it('never lists the same key as both purged and kept', () => {
    const kept = new Set<string>(KEPT_ON_SIGN_OUT);
    expect(PURGED_ON_SIGN_OUT.filter((k) => kept.has(k))).toEqual([]);
  });

  it('purges the credentials-adjacent keys, not just preferences', () => {
    // The entitlement cache is the one that hands the next person a paid app.
    expect(PURGED_ON_SIGN_OUT).toContain('billing.owned.v1');
    // Their own answers about their own spending.
    expect(PURGED_ON_SIGN_OUT).toContain('usage.answers.v1');
  });

  it('resolves rather than throwing when storage fails', async () => {
    multiRemove.mockRejectedValueOnce(new Error('storage unavailable'));
    // Sign-out must complete regardless; being left signed in because a disk
    // write failed is the worse outcome.
    await expect(purgeSessionData()).resolves.toBeUndefined();
  });
});
