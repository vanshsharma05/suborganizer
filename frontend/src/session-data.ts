/**
 * What leaves the device when somebody signs out.
 *
 * Sign-out already handled the credential properly: `logout` calls
 * `disconnectGmail`, which empties the mailbox store *and* revokes every token
 * with Google, so the grant is dead server-side rather than merely deleted
 * locally. The legacy single-grant key retires itself during migration. None of
 * that needed changing.
 *
 * What it did not touch was everything else the signed-in person left on the
 * device. That is what this file is for.
 *
 * The list is central rather than a purge function per module because the
 * failure here is silent and slow: somebody adds a key, never thinks about
 * sign-out, and nothing tells them. One file to read is one file to notice.
 *
 * `KEPT_ON_SIGN_OUT` exists for the same reason. A key in neither list is an
 * oversight; a key in KEPT is a decision with its reason written beside it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Cleared on sign-out: things the signed-in person told us, or paid for. */
export const PURGED_ON_SIGN_OUT = [
  /** Which subscriptions they said they no longer use. Their answers. */
  'usage.answers.v1',
  /** Findings they dismissed. Their decisions about their own money. */
  'savings.dismissed.v1',
  /**
   * Owned unlocks.
   *
   * The durable record is Apple's and Play's, not ours — this is a cache so a
   * cold start is Pro before the store has been asked. Left behind, it hands
   * the next person to sign in on this device somebody else's paid app until
   * the store gets around to contradicting it.
   */
  'billing.owned.v1',
  'billing.devOwned.v1',
] as const;

/**
 * Deliberately survives. Nothing here identifies anyone or unlocks anything.
 *
 *   fx.usdinr.v1        a public exchange rate, no more private than the weather
 *   story.lastShown.v1  a per-device display preference, documented as such in
 *                       story-storage.ts — clearing it would replay the intro
 *                       at every sign-in on a shared device
 *   splash.played.v1    the same, for the long launch animation
 *
 * Handled elsewhere, and better than by deletion:
 *   gmail.mailboxes.v1  disconnectGmail() empties it and revokes each token
 *   gmail.connection.v1 retired during migration in mailboxes.ts
 */
export const KEPT_ON_SIGN_OUT = [
  'fx.usdinr.v1',
  'story.lastShown.v1',
  'splash.played.v1',
] as const;

/**
 * Removes the keys above.
 *
 * Never throws. Sign-out has to finish whatever storage does — leaving somebody
 * signed in because a disk write failed is a worse outcome than a key that
 * outlives the session, and the caller has already decided the session is over.
 *
 * `multiRemove` rather than a loop, so one bad key cannot strand the rest.
 */
export async function purgeSessionData(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([...PURGED_ON_SIGN_OUT]);
  } catch {
    // Storage unavailable. Nothing useful to say and nothing to retry into.
  }
}
