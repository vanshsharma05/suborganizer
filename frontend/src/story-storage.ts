/**
 * Persistence for the story gate.
 *
 * Kept apart from story-gate.ts so the decision logic there stays pure and
 * testable — this is the only part that touches the device, and it has nothing
 * to decide.
 *
 * Deliberately local rather than a column on `profiles`: this is a per-device
 * display preference, not user data. Putting it in Postgres would mean a network
 * round trip on the launch path, which is exactly the kind of dependency that
 * left the app sitting on a spinner in the first place.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { markPlayed, shouldPlayStory, type StoryState } from './story-gate';

const KEY = 'story.lastShown.v1';

/** Never throws — a storage failure must not keep anyone out of the app. */
async function readStoryState(): Promise<StoryState> {
  try {
    return { lastShown: await AsyncStorage.getItem(KEY) };
  } catch {
    return { lastShown: null };
  }
}

export async function markStoryPlayed(today: Date = new Date()): Promise<void> {
  try {
    const { lastShown } = markPlayed(today);
    if (lastShown) await AsyncStorage.setItem(KEY, lastShown);
  } catch {
    // Worst case the story plays again next launch. Not worth surfacing.
  }
}

/** Forget it played, so the next launch replays. Used by "watch again". */
export async function resetStory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Nothing to recover from.
  }
}

/** Convenience for the launch path: read storage and apply the gate. */
export async function shouldPlayNow(hasContent: boolean, today: Date = new Date()): Promise<boolean> {
  return shouldPlayStory(await readStoryState(), hasContent, today);
}
