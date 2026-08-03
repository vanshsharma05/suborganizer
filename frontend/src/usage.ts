/**
 * Whether the user actually uses the things they pay for.
 *
 * Every other check in the audit is arithmetic: a yearly plan is cheaper than
 * twelve monthly ones, a price went up, two services overlap. All of it derived
 * from numbers already on the row. None of it can answer the question people
 * actually open a subscription tracker to answer — *which of these am I not
 * using?* — because nothing in the app has ever known.
 *
 * So it asks. Once a month, one tap per subscription. The answer is the user's
 * own, which makes the finding it produces the only one in the app that cannot
 * be argued with.
 *
 * Stored on the device rather than the server. It is an opinion about a habit,
 * not account data, and keeping it local means the feature works today without
 * anybody running a migration first.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { daysUntilISO, toISODate } from './dates';

const KEY = 'usage.answers.v1';

/** How long an answer stands before we ask again. */
export const REVIEW_EVERY_DAYS = 30;

/**
 * How long something must go unused before it is worth raising.
 *
 * Two consecutive "no"s, near enough. One is a quiet month; two months without
 * opening something you pay for every month is a decision waiting to be made.
 */
export const UNUSED_AFTER_DAYS = 55;

/** One answer: the day it was given, and what it was. */
export type Answer = { on: string; used: boolean };

/** Subscription id → their most recent answer. */
export type UsageLog = Record<string, Answer>;

export function record(
  log: UsageLog,
  id: string,
  used: boolean,
  today: Date = new Date(),
): UsageLog {
  return { ...log, [id]: { on: toISODate(today), used } };
}

export function forget(log: UsageLog, id: string): UsageLog {
  const { [id]: _gone, ...rest } = log;
  return rest;
}

/** Days since an answer was given, or null if there is none we can read. */
export function ageOf(log: UsageLog, id: string, today: Date = new Date()): number | null {
  const answer = log[id];
  if (!answer) return null;
  const days = daysUntilISO(answer.on, today);
  // daysUntilISO counts forwards, so a past date is negative. An unreadable
  // date is treated as no answer at all rather than as a fresh one — the
  // failure that matters is silently believing something we cannot read.
  if (days === null) return null;
  // Negating zero gives -0, which is not the same value as 0 to Object.is, to a
  // Map key, or to anything comparing with Object.is under the hood. Answered
  // today is 0 days ago.
  return days === 0 ? 0 : -days;
}

/**
 * Whether this subscription is due to be asked about.
 *
 * Never answered counts as due. So does an answer older than the review period,
 * whichever way it went — "yes I use it" goes stale exactly as fast as "no".
 */
export function isDue(log: UsageLog, id: string, today: Date = new Date()): boolean {
  const age = ageOf(log, id, today);
  return age === null || age >= REVIEW_EVERY_DAYS;
}

/**
 * Ids to ask about, in the order they should be asked.
 *
 * Longest-unanswered first, so a review that gets abandoned halfway has still
 * covered the subscriptions we know least about.
 */
export function dueForReview(
  ids: readonly string[],
  log: UsageLog,
  today: Date = new Date(),
): string[] {
  return ids
    .filter((id) => isDue(log, id, today))
    .sort((a, b) => (ageOf(log, b, today) ?? Infinity) - (ageOf(log, a, today) ?? Infinity));
}

/**
 * How long this has been going unused, in days, or null if it is being used or
 * has never been answered.
 *
 * Only a "no" counts. Silence is not evidence — someone who has never been
 * asked is not someone who said they were not using it.
 */
export function unusedFor(log: UsageLog, id: string, today: Date = new Date()): number | null {
  const answer = log[id];
  if (!answer || answer.used) return null;
  return ageOf(log, id, today);
}

/** Whether the last answer was old enough, and negative enough, to act on. */
export function isDormant(log: UsageLog, id: string, today: Date = new Date()): boolean {
  const since = unusedFor(log, id, today);
  return since !== null && since >= UNUSED_AFTER_DAYS;
}

/** Drops answers for subscriptions that no longer exist. */
export function prune(log: UsageLog, liveIds: readonly string[]): UsageLog {
  const live = new Set(liveIds);
  const out: UsageLog = {};
  for (const [id, answer] of Object.entries(log)) {
    if (live.has(id)) out[id] = answer;
  }
  return out;
}

// ----------------------------------------------------------------- storage --

export async function readUsage(): Promise<UsageLog> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

    const out: UsageLog = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue;
      const { on, used } = value as Partial<Answer>;
      if (typeof on === 'string' && typeof used === 'boolean') out[id] = { on, used };
    }
    return out;
  } catch {
    return {};
  }
}

export async function writeUsage(log: UsageLog): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(log)).catch(() => {
    // Storage full or unavailable. The answer still holds for this session, and
    // the worst case is being asked again sooner than expected.
  });
}
