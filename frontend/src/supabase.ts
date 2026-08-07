// URL/Blob polyfills — supabase-js expects browser globals that React Native
// does not ship. Must be imported before createClient runs.
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import type { Database } from './database.types';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase config. Copy frontend/.env.example to frontend/.env and ' +
      'fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
  );
}

/**
 * Ceiling on every Supabase request.
 *
 * `fetch` has no timeout of its own, and a mobile connection fails by stalling
 * far more often than by refusing — a half-open socket on patchy mobile data
 * leaves the promise pending forever, with no error to catch. That is how the
 * app came to sit on its loading spinner after a working morning: the token
 * refresh on a cold start never resolved, so nothing downstream of it ever ran.
 *
 * 20s is past the point where any of these calls is still worth waiting for.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Thrown when a request outlives REQUEST_TIMEOUT_MS. A distinct class so
 * describeError() can recognise it without matching on message text.
 */
class RequestTimeout extends Error {
  constructor(ms: number) {
    super(`Request timed out after ${ms}ms`);
    this.name = 'RequestTimeout';
  }
}

/**
 * `fetch` with a ceiling, implemented as a race rather than with AbortController.
 *
 * The obvious implementation passes `signal` to fetch. React Native's fetch is a
 * polyfill over XMLHttpRequest, and handing it a signal has a long history of
 * misbehaving — the request stalls rather than aborting, which turns the
 * safeguard into the very failure it was meant to prevent.
 *
 * Racing a timer needs no signal support at all. The trade-off is that a
 * timed-out request keeps running in the background until the OS drops it, which
 * costs a socket for a few seconds and is a far better deal than a login that
 * never completes.
 */
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const startedAt = Date.now();

  // Development-only request log. A request that fails is easy to see; one that
  // merely takes nine seconds, or never leaves at all, is invisible — and that
  // is exactly the shape of problem that turns into "the app just sits there".
  const label = String(typeof input === 'string' ? input : ((input as Request).url ?? input))
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0];

  if (__DEV__) console.log(`[supabase] → ${init?.method ?? 'GET'} ${label}`);

  const report = (outcome: string): void => {
    if (__DEV__) console.log(`[supabase] ← ${outcome} ${label} ${Date.now() - startedAt}ms`);
  };

  let timer: ReturnType<typeof setTimeout>;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RequestTimeout(REQUEST_TIMEOUT_MS)), REQUEST_TIMEOUT_MS);
  });

  return Promise.race([fetch(input, init), expiry])
    .then((res) => {
      report(String(res.status));
      return res;
    })
    .catch((e: unknown) => {
      report(`FAILED (${e instanceof Error ? e.message : String(e)})`);
      throw e;
    })
    .finally(() => clearTimeout(timer));
}

/**
 * The message out of anything that might carry one.
 *
 * Errors from PostgREST are plain objects, not Error instances — `String()` on
 * one yields "[object Object]", which is how a caller handing us a Supabase
 * error would have shown the user nothing at all.
 */
function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return '';
}

/**
 * Turns a transport failure into something worth showing someone.
 *
 * A timeout surfaces as `AbortError: Aborted` and React Native's own failure as
 * `Network request failed`. Neither tells the user anything, and "Aborted" in
 * particular reads like the app gave up for its own reasons rather than the
 * connection being the problem.
 *
 * Offline and server-error are deliberately different sentences. "Check your
 * connection" sends someone to look at their wifi; a Postgres constraint
 * violation phrased that way sends them to look at the wrong thing entirely.
 */
export function describeError(e: unknown, fallback: string): string {
  const message = messageOf(e);

  if (/abort|timed out|timeout/i.test(message)) {
    return 'The server took too long to respond. Check your connection and try again.';
  }
  if (/network request failed|failed to fetch|networkerror/i.test(message)) {
    return 'Could not reach the server. Check your internet connection and try again.';
  }
  return message || fallback;
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    // AsyncStorage rather than expo-secure-store: SecureStore caps values at
    // ~2KB on Android and a Supabase session (access + refresh token + user
    // payload) regularly exceeds that, which fails silently as a lost session.
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    // Native completes the OAuth round trip through expo-auth-session, so
    // supabase-js is never handed a URL carrying auth fragments.
    detectSessionInUrl: false,
    // PKCE is what lets the native OAuth flow exchange a code for a session
    // without ever shipping a client secret inside the app.
    flowType: 'pkce',
  },
  global: { fetch: fetchWithTimeout },
});

// Supabase refreshes tokens on a timer, which the OS suspends in the
// background. Re-sync on foreground so a returning user is not bounced to the
// login screen by an expired token.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
