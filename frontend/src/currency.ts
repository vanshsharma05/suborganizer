/**
 * Currency utilities — India-first. Two currencies only: INR and USD.
 *
 * The USD rate is fetched live rather than baked in. The table this replaced
 * was stamped "approx Feb 2026" and was months out of date by the time anyone
 * read it — the failure mode a hardcoded rate always has.
 *
 * Conversion stays *synchronous* on purpose: the dashboard, insights and
 * calendar all total subscriptions inside `useMemo` during render. The live
 * rate lives in a module-level cache that screens subscribe to through
 * `useExchangeRate()`, so a rate arriving mid-session re-renders the totals
 * without any caller having to await anything.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export const CURRENCIES = ['INR', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

const CURRENCY_SYMBOL: Record<string, string> = { INR: '₹', USD: '$' };

/**
 * Used until the live rate arrives, and when the device is offline with nothing
 * cached. Not meant to be accurate — it exists so a cold offline start shows a
 * plausible total instead of one wrong by an order of magnitude.
 */
const FALLBACK_USD_INR = 88;

const STORE_KEY = 'fx.usdinr.v1';

/** Hours of drift are immaterial when totalling subscriptions. Months are not. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Free and keyless — no account, no key to leak in the bundle. */
const SOURCE = 'https://open.er-api.com/v6/latest/USD';

/**
 * A rate is a nicety, not a blocker. Give up quickly and keep the cached or
 * fallback value rather than leaving `inflight` pending forever on a stalled
 * connection, which would also block every later refresh attempt.
 */
const FETCH_TIMEOUT_MS = 8_000;

let current = FALLBACK_USD_INR;
let fetchedAt = 0;
let inflight: Promise<number> | null = null;
let hydrated = false;

const listeners = new Set<() => void>();

function announce(): void {
  for (const fn of listeners) fn();
}

/**
 * A malformed, inverted (0.011 rather than 88) or wildly out-of-range response
 * must never reach the dashboard. A wrong rate is worse than a stale one
 * because it looks just as authoritative.
 */
function isSane(rate: unknown): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 20 && rate < 500;
}

/** Milliseconds since the live rate was fetched; Infinity when never. */
function rateAge(): number {
  return fetchedAt ? Date.now() - fetchedAt : Infinity;
}

async function hydrateFromCache(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return;
    const cached = JSON.parse(raw) as { rate?: number; fetchedAt?: number };
    if (isSane(cached.rate)) {
      current = cached.rate;
      fetchedAt = cached.fetchedAt ?? 0;
      announce();
    }
  } catch {
    // A corrupt cache is not worth reporting; the next fetch replaces it.
  }
}

/** Fetches a fresh rate, writes it through to storage and notifies listeners. */
async function refreshRate(): Promise<number> {
  if (inflight) return inflight;

  inflight = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(SOURCE, { signal: controller.signal });
      if (!res.ok) return current;

      const json = (await res.json()) as { rates?: Record<string, number> };
      const rate = json.rates?.INR;
      if (!isSane(rate)) return current;

      current = rate;
      fetchedAt = Date.now();
      try {
        await AsyncStorage.setItem(STORE_KEY, JSON.stringify({ rate, fetchedAt }));
      } catch {
        // Storage full or unavailable: the rate still stands for this session.
      }
      announce();
      return rate;
    } catch {
      // Offline, timed out, or the source is down. Whatever we have stands.
      return current;
    } finally {
      clearTimeout(timer);
      inflight = null;
    }
  })();

  return inflight;
}

/** Loads the cached rate, then refreshes it if it is missing or stale. */
async function ensureRate(): Promise<number> {
  await hydrateFromCache();
  if (rateAge() > MAX_AGE_MS) return refreshRate();
  return current;
}

/**
 * The live USD→INR rate, re-rendering the caller when it changes.
 *
 * Include the returned value in the dependency list of any `useMemo` that
 * totals converted amounts, or the total keeps whatever rate it first rendered
 * with.
 */
export function useExchangeRate(): number {
  const [rate, setRate] = useState(current);

  useEffect(() => {
    const onChange = (): void => setRate(current);
    listeners.add(onChange);
    void ensureRate();
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  return rate;
}

export function symbolFor(cur?: string): string {
  const c = (cur || 'INR').toUpperCase();
  return CURRENCY_SYMBOL[c] || c + ' ';
}

/** Format a money amount in the given currency with locale-appropriate grouping. */
export function fmtMoney(amount: number, cur?: string, opts: { compact?: boolean } = {}): string {
  const c = (cur || 'INR').toUpperCase();
  const sym = symbolFor(c);
  const digits = c === 'INR' ? 0 : 2;
  const rounded = Number(amount.toFixed(digits));
  if (opts.compact && Math.abs(rounded) >= 100000) {
    // 1L, 2.3L, 1.2Cr etc for INR; else fall back to normal
    if (c === 'INR') {
      if (rounded >= 10000000) return `${sym}${(rounded / 10000000).toFixed(1)}Cr`;
      if (rounded >= 100000) return `${sym}${(rounded / 100000).toFixed(1)}L`;
    } else if (rounded >= 1000) {
      return `${sym}${(rounded / 1000).toFixed(1)}k`;
    }
  }
  // grouping
  const locale = c === 'INR' ? 'en-IN' : 'en-US';
  const grouped = rounded.toLocaleString(locale, {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
  return `${sym}${grouped}`;
}

/**
 * Converts between the two supported currencies.
 *
 * Anything that is not USD is treated as INR. Rows written before the currency
 * list was narrowed may still carry EUR or GBP; those amounts are rupee-sized
 * far more often than not, so assuming INR keeps the total in the right order
 * of magnitude rather than applying a rate the app no longer tracks.
 *
 * `rate` is an explicit parameter rather than a module-global read. Screens
 * total subscriptions inside `useMemo`, and a hidden read of mutable module
 * state there is a dependency React cannot see — the totals would keep whatever
 * rate they first rendered with. Passing the value from `useExchangeRate()`
 * makes the dependency real. It defaults to the current rate for callers
 * outside React.
 */
export function convertToPrimary(
  amount: number,
  fromCur: string | undefined,
  primaryCur: string,
  rate: number = current,
): number {
  const from = (fromCur || 'INR').toUpperCase();
  const to = (primaryCur || 'INR').toUpperCase();
  if (from === to) return amount;

  const usdInrRate = isSane(rate) ? rate : current;
  const inr = from === 'USD' ? amount * usdInrRate : amount;
  return to === 'USD' ? inr / usdInrRate : inr;
}

// Lives in cycles.ts, which has no dependencies and so can be unit-tested
// directly. Re-exported here because most callers want money and cycle maths
// from the same place.
export { monthlyEquivalent } from './cycles';
