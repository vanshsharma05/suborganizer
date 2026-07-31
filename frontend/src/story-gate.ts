/**
 * When the story is worth playing.
 *
 * The tension: the reveal is what makes the app feel like something, and it is
 * also a wall between the user and their data. Played every launch it stops
 * being an event and becomes the thing standing in the way — which is how a
 * strength turns into a one-star review by week two.
 *
 * So: the first time always, then once a week. Frequent enough to stay a habit,
 * rare enough that seeing it still means something. It is always skippable, and
 * always replayable on demand, so neither decision is ever forced on anyone.
 *
 * Pure, with the clock passed in.
 */

import { daysUntilISO, toISODate } from './dates';

/** Days between automatic replays after the first. */
export const REPLAY_AFTER_DAYS = 7;

export type StoryState = {
  /** `YYYY-MM-DD` the story last played, or null if it never has. */
  lastShown: string | null;
};

/**
 * Whether to play the story automatically on this launch.
 *
 * `hasContent` guards the empty case: a brand-new account with nothing tracked
 * has no story, and opening on a reveal that reveals nothing is worse than
 * opening on the dashboard.
 */
export function shouldPlayStory(
  state: StoryState,
  hasContent: boolean,
  today: Date = new Date(),
): boolean {
  if (!hasContent) return false;
  if (!state.lastShown) return true;

  // daysUntilISO counts forward, so a date in the past is negative.
  const until = daysUntilISO(state.lastShown, today);

  // Unreadable stored value. Falling back to 0 here would read as "shown today"
  // and switch the story off permanently, with nothing to indicate why — so a
  // value we cannot parse is treated the same as never having played.
  if (until === null) return true;

  const daysSince = -until;

  // A lastShown in the future means a clock change or corrupt storage. Treat it
  // as "recently seen" rather than replaying immediately on every launch.
  if (daysSince < 0) return false;

  return daysSince >= REPLAY_AFTER_DAYS;
}

/** The value to persist once the story has played. */
export function markPlayed(today: Date = new Date()): StoryState {
  return { lastShown: toISODate(today) };
}
