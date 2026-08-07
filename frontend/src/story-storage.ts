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

/**
 * The read, kept so the launch path does not have to wait for it twice.
 *
 * Cleared by both writers below, so this is a cache of the value rather than a
 * one-shot: forgetting to clear it would make "watch again" do nothing until the
 * next cold start.
 */
let cached: Promise<StoryState> | null = null;

/** Never throws — a storage failure must not keep anyone out of the app. */
function readStoryState(): Promise<StoryState> {
  cached ??= AsyncStorage.getItem(KEY)
    .then((lastShown) => ({ lastShown }))
    .catch(() => ({ lastShown: null }));
  return cached;
}

/**
 * Started at import, so the value is in hand before anything asks for it.
 *
 * index.tsx calls shouldPlayNow only once the session has restored, and that
 * costs a network round trip; this read is local and finishes long before it.
 * Reading on demand instead left a gap between auth settling and the first route
 * being chosen — a few frames, but the splash had already begun dissolving by
 * then, so what showed through the gap was the loading spinner. The whole point
 * of holding the splash on `ready` is that this never happens.
 *
 * `void` because nothing here needs the result yet; the promise is the point.
 */
void readStoryState();

export async function markStoryPlayed(today: Date = new Date()): Promise<void> {
  try {
    const { lastShown } = markPlayed(today);
    if (lastShown) {
      await AsyncStorage.setItem(KEY, lastShown);
      // Set to the known value rather than cleared, so a read racing this write
      // cannot repopulate the cache from storage that has not been written yet.
      cached = Promise.resolve({ lastShown });
    }
  } catch {
    // Worst case the story plays again next launch. Not worth surfacing.
  }
}

/** Forget it played, so the next launch replays. Used by "watch again". */
export async function resetStory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
    cached = Promise.resolve({ lastShown: null });
  } catch {
    // Nothing to recover from.
  }
}

/** Convenience for the launch path: read storage and apply the gate. */
export async function shouldPlayNow(hasContent: boolean, today: Date = new Date()): Promise<boolean> {
  return shouldPlayStory(await readStoryState(), hasContent, today);
}
