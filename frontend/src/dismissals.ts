/**
 * Findings the user has looked at and rejected.
 *
 * The audit guesses. Some of its findings depend on things only the user knows —
 * whether they are on a particular telecom plan, whether two music services are
 * deliberate — and it says so, but it cannot verify them. Without a way to say
 * "checked, not applicable", every one of those questions is asked again on
 * every visit, and a list that keeps raising resolved items is one people stop
 * reading. That costs more than the finding was worth.
 *
 * Dismissals expire. Prices rise, plans change, and a bundle that did not cover
 * someone in March may cover them in September — so "not applicable" is recorded
 * as "not applicable *now*" and quietly lapses. Permanent is the wrong default
 * for a judgement about a moving target.
 *
 * The pure half is here and tested; the storage half is a thin wrapper that
 * never throws. Losing a dismissal costs the user one tap, so nothing in this
 * file is worth failing an app launch over.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { daysUntilISO, toISODate } from './dates';

const KEY = 'savings.dismissed.v1';

/** How long a "not applicable" stands before the finding is raised again. */
export const DISMISSAL_TTL_DAYS = 180;

/** Finding id → the day it was dismissed, as `YYYY-MM-DD`. */
export type Dismissals = Record<string, string>;

/**
 * Drops entries that have lapsed.
 *
 * An unparseable date counts as expired rather than as fresh. The alternative —
 * treating a corrupt entry as a live dismissal — hides a finding forever with no
 * way for the user to discover it is being hidden.
 */
export function prune(map: Dismissals, today: Date = new Date()): Dismissals {
  const out: Dismissals = {};

  for (const [id, on] of Object.entries(map)) {
    const age = daysUntilISO(on, today);
    if (age === null) continue;
    // daysUntilISO counts forwards, so a past date is negative.
    if (-age <= DISMISSAL_TTL_DAYS) out[id] = on;
  }

  return out;
}

export function dismiss(map: Dismissals, id: string, today: Date = new Date()): Dismissals {
  return { ...map, [id]: toISODate(today) };
}

export function restore(map: Dismissals, id: string): Dismissals {
  const { [id]: _removed, ...rest } = map;
  return rest;
}

/** The ids currently suppressed, ready to hand to runAudit. */
export function activeIds(map: Dismissals, today: Date = new Date()): Set<string> {
  return new Set(Object.keys(prune(map, today)));
}

// ----------------------------------------------------------------- storage --

export async function readDismissals(): Promise<Dismissals> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

    const out: Dismissals = {};
    for (const [id, on] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof on === 'string') out[id] = on;
    }
    return prune(out);
  } catch {
    return {};
  }
}

export async function writeDismissals(map: Dismissals): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(prune(map))).catch(() => {
    // Storage full or unavailable. The dismissal still holds for this session.
  });
}
