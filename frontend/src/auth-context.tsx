import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { describeError, supabase } from './supabase';
import { disconnectGmail } from './gmail/auth';
import { invalidateReminderCache } from './notifications';
import { monthlyEquivalent as monthlyForCycle } from './cycles';
import {
  deriveReminders,
  fetchProfile,
  listPriceChanges,
  listSubscriptions,
  PriceChange,
  ReminderItem,
  Subscription,
  User,
} from './api';

/**
 * The URL scheme this build actually owns.
 *
 * Read from the config rather than hardcoded: the development variant uses
 * `suborganizer-dev` so it can sit on the phone alongside the Play install, and
 * a hardcoded `suborganizer` would send the OAuth redirect to an app this build
 * cannot open.
 */
function appScheme(): string {
  const scheme = Constants.expoConfig?.scheme;
  if (Array.isArray(scheme)) return scheme[0];
  return scheme ?? 'suborganizer';
}

/**
 * Longest the app may sit on its loading spinner before showing the app anyway.
 *
 * A last resort, not the normal path: `loading` is cleared from the auth event
 * itself, which needs no network. This only covers supabase-js stalling inside
 * its own session recovery, where no callback ever arrives and there is nothing
 * to catch. Treating that as "not signed in" at least lands the user on a screen
 * they can act on instead of an indefinite spinner.
 */
const BOOT_TIMEOUT_MS = 12_000;

type AuthCtx = {
  user: User | null;
  loading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (
    name: string,
    email: string,
    password: string,
  ) => Promise<{ needsConfirmation: boolean }>;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  subs: Subscription[];
  refreshSubs: () => Promise<void>;
  /** Why the subscription list could not be loaded, or null. */
  subsError: string | null;
  /** True until the first fetch settles. Distinct from an empty list. */
  subsLoading: boolean;
  reminders: ReminderItem[];
  refreshReminders: () => Promise<void>;
  priceChanges: PriceChange[];
  refreshPriceChanges: () => Promise<void>;
  setPro: (v: boolean) => void;
};

const Ctx = createContext<AuthCtx | null>(null);

/**
 * A usable `User` built from the session alone — no request required.
 *
 * The access token already carries the id, the email and the name we set at
 * signup, which is everything the dashboard needs to render its greeting and
 * everything the router needs to decide where to send someone. Deriving it here
 * is what lets first paint happen without waiting on the network; `fetchProfile`
 * then fills in the stored preferences when it comes back.
 */
function userFromSession(u: {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown> | null;
}): User {
  const meta = u.user_metadata ?? {};
  const named = [meta.full_name, meta.name].find((v): v is string => typeof v === 'string' && v.trim().length > 0);

  return {
    id: u.id,
    email: u.email ?? '',
    name: named?.trim() ?? u.email?.split('@')[0] ?? 'there',
    // Deliberately conservative defaults. Both are overwritten by fetchProfile;
    // guessing "pro" from a stale token would unlock paid UI on a cold start.
    is_pro: false,
    primary_currency: 'INR',
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [subsError, setSubsError] = useState<string | null>(null);
  /**
   * True until the first list has come back, however it came back.
   *
   * Three states look identical without this — still loading, loaded and empty,
   * and failed — and only one of them should show "you have no subscriptions".
   * `subsError` already separated the third; this separates the first.
   */
  const [subsLoading, setSubsLoading] = useState(true);
  const [priceChanges, setPriceChanges] = useState<PriceChange[]>([]);

  /** Id whose data is already being pulled, so repeat auth events don't refetch. */
  const hydratedFor = useRef<string | null>(null);

  // Reminders are a pure function of the subscription list, so deriving them
  // keeps the two from ever drifting out of sync.
  const reminders = useMemo(() => deriveReminders(subs), [subs]);

  const refreshUser = useCallback(async () => {
    try {
      const profile = await fetchProfile();
      // Null means Supabase says there is no user. A thrown error means the
      // request failed, which is not the same thing and must not sign anyone
      // out — that is how a patchy connection used to look like a logout.
      if (profile) setUser(profile);
    } catch {
      // Keep whatever the session already told us about this user.
    }
  }, []);

  const refreshSubs = useCallback(async () => {
    try {
      setSubs(await listSubscriptions());
      setSubsError(null);
    } catch (e) {
      // Keep whatever is already on screen, but record why it is stale. An
      // empty list and a failed load look identical otherwise, and for this app
      // "you have no subscriptions" is the more alarming of the two to show
      // someone when it is not true.
      setSubsError(describeError(e, 'Could not load your subscriptions.'));
    } finally {
      // In `finally`, so a failed first load stops claiming to be loading. The
      // error banner takes over from there.
      setSubsLoading(false);
    }
  }, []);

  // Kept for API compatibility with the screens; reminders recompute themselves
  // whenever subs change, so this just re-pulls the source data.
  const refreshReminders = useCallback(async () => {
    await refreshSubs();
  }, [refreshSubs]);

  const refreshPriceChanges = useCallback(async () => {
    try {
      setPriceChanges(await listPriceChanges());
    } catch {
      // Same as subs: a failed pull should not blank what is on screen.
    }
  }, []);

  useEffect(() => {
    let active = true;
    let settled = false;

    /**
     * Clear the loading gate. Both app/index.tsx and app/(tabs)/_layout.tsx
     * render a spinner until this happens, so it must not depend on any request
     * completing — see BOOT_TIMEOUT_MS.
     */
    const settle = (): void => {
      if (!active || settled) return;
      settled = true;
      setLoading(false);
    };

    const watchdog = setTimeout(settle, BOOT_TIMEOUT_MS);

    // Not an async callback, on purpose. supabase-js awaits each subscriber in
    // turn, so anything slow in here delays every later auth event — and it
    // used to hold up first paint for two round trips.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;

      const sessionUser = session?.user;

      if (!sessionUser) {
        hydratedFor.current = null;
        setUser(null);
        setSubs([]);
        setSubsLoading(true);
        setSubsError(null);
        setPriceChanges([]);
        settle();
        return;
      }

      // Route on the session, which is already in hand. Keep an existing
      // hydrated profile rather than overwriting it with token defaults.
      setUser((prev) => (prev?.id === sessionUser.id ? prev : userFromSession(sessionUser)));
      settle();

      // A refresh every hour delivers TOKEN_REFRESHED with the same user;
      // re-pulling the whole list each time would be pointless traffic.
      if (event === 'TOKEN_REFRESHED' && hydratedFor.current === sessionUser.id) return;
      hydratedFor.current = sessionUser.id;

      // Unawaited: the app is already usable, and these only fill it in.
      void refreshUser();
      void refreshSubs();
      void refreshPriceChanges();
    });

    return () => {
      active = false;
      clearTimeout(watchdog);
      sub.subscription.unsubscribe();
    };
  }, [refreshUser, refreshSubs, refreshPriceChanges]);

  const signInWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    // supabase-js returns transport failures in `error` rather than throwing, so
    // a timeout arrives here as the string "Aborted". Translate it, or the login
    // screen tells the user something meaningless about their password.
    if (error) throw new Error(describeError(error, 'Could not sign in.'));
  };

  const signUpWithEmail = async (name: string, email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      // Read by the handle_new_user() trigger to seed profiles.name, and by
      // userFromSession() so the greeting is right before any request lands.
      options: { data: { full_name: name.trim() } },
    });
    if (error) throw new Error(describeError(error, 'Could not create that account.'));

    // With "Confirm email" enabled (the Supabase default) no session comes back
    // until the user clicks the link, so the caller must say so rather than
    // silently appearing to do nothing.
    return { needsConfirmation: !data.session };
  };

  const signInWithGoogle = async () => {
    const redirectTo = AuthSession.makeRedirectUri({
      scheme: appScheme(),
      path: 'auth-callback',
    });

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        // We drive the browser ourselves so the redirect can be captured.
        skipBrowserRedirect: true,
      },
    });
    if (error) throw new Error(describeError(error, 'Google sign-in failed.'));
    if (!data?.url) throw new Error('Google sign-in did not return a URL');

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') return; // user dismissed the sheet

    // PKCE: the redirect carries a one-time code, which we trade for a session.
    const code = new URL(result.url).searchParams.get('code');
    if (!code) throw new Error('No auth code returned from Google');

    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) throw new Error(describeError(exchangeError, 'Google sign-in failed.'));
  };

  const logout = async () => {
    // Drop the Gmail grant too — leaving a token that can read someone's inbox
    // on a signed-out device is not a trade worth making for convenience.
    await disconnectGmail().catch(() => {});
    await supabase.auth.signOut().catch(() => {
      // Already invalid server-side, or offline. The local state below is what
      // decides what the user sees, so a failure here must not strand them
      // signed in on a screen they asked to leave.
    });
    hydratedFor.current = null;
    // The reminder scheduler skips work when the subscription list looks
    // unchanged. That cache is module-level and would otherwise outlive the
    // session, so the next person to sign in on this device could be handed the
    // previous one's reminders.
    invalidateReminderCache();
    setUser(null);
    setSubs([]);
    setSubsError(null);
    setSubsLoading(true);
    setPriceChanges([]);
  };

  const setPro = (v: boolean) => setUser((u) => (u ? { ...u, is_pro: v } : u));

  return (
    <Ctx.Provider
      value={{
        user,
        loading,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        logout,
        refreshUser,
        subs,
        refreshSubs,
        subsError,
        subsLoading,
        reminders,
        refreshReminders,
        priceChanges,
        refreshPriceChanges,
        setPro,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used within AuthProvider');
  return v;
}

/**
 * What one subscription costs per month. A thin wrapper over the cycle maths in
 * cycles.ts so the screens can pass a whole Subscription.
 */
export function monthlyEquivalent(sub: Subscription): number {
  return monthlyForCycle(sub.amount, sub.billing_cycle);
}
