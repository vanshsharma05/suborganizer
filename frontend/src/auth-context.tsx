import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';
import { disconnectGmail } from './gmail/auth';
import {
  deriveReminders,
  fetchProfile,
  listSubscriptions,
  ReminderItem,
  Subscription,
  User,
} from './api';

// Required on web so the popup/redirect can hand the session back.
WebBrowser.maybeCompleteAuthSession();

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
  reminders: ReminderItem[];
  refreshReminders: () => Promise<void>;
  setPro: (v: boolean) => void;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [subs, setSubs] = useState<Subscription[]>([]);

  // Reminders are a pure function of the subscription list, so deriving them
  // keeps the two from ever drifting out of sync.
  const reminders = useMemo(() => deriveReminders(subs), [subs]);

  const refreshUser = useCallback(async () => {
    try {
      setUser(await fetchProfile());
    } catch {
      setUser(null);
    }
  }, []);

  const refreshSubs = useCallback(async () => {
    try {
      setSubs(await listSubscriptions());
    } catch {
      // Offline or transient — keep whatever is already on screen.
    }
  }, []);

  // Kept for API compatibility with the screens; reminders recompute themselves
  // whenever subs change, so this just re-pulls the source data.
  const refreshReminders = useCallback(async () => {
    await refreshSubs();
  }, [refreshSubs]);

  useEffect(() => {
    let active = true;

    // onAuthStateChange fires immediately with the restored session, so it
    // doubles as the initial load and avoids a separate getSession() race.
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!active) return;

      if (session?.user) {
        await refreshUser();
        await refreshSubs();
      } else {
        setUser(null);
        setSubs([]);
      }
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [refreshUser, refreshSubs]);

  const signInWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw new Error(error.message);
  };

  const signUpWithEmail = async (name: string, email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      // Read by the handle_new_user() trigger to seed profiles.name.
      options: { data: { full_name: name.trim() } },
    });
    if (error) throw new Error(error.message);

    // With "Confirm email" enabled (the Supabase default) no session comes back
    // until the user clicks the link, so the caller must say so rather than
    // silently appearing to do nothing.
    return { needsConfirmation: !data.session };
  };

  const signInWithGoogle = async () => {
    const redirectTo = AuthSession.makeRedirectUri({
      scheme: 'suborganizer',
      path: 'auth-callback',
    });

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        // On native we drive the browser ourselves so we can capture the
        // redirect; on web we let supabase-js navigate the page.
        skipBrowserRedirect: Platform.OS !== 'web',
      },
    });
    if (error) throw new Error(error.message);
    if (Platform.OS === 'web') return;
    if (!data?.url) throw new Error('Google sign-in did not return a URL');

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') return; // user dismissed the sheet

    // PKCE: the redirect carries a one-time code, which we trade for a session.
    const code = new URL(result.url).searchParams.get('code');
    if (!code) throw new Error('No auth code returned from Google');

    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) throw new Error(exchangeError.message);
  };

  const logout = async () => {
    // Drop the Gmail grant too — leaving a token that can read someone's inbox
    // on a signed-out device is not a trade worth making for convenience.
    await disconnectGmail().catch(() => {});
    await supabase.auth.signOut();
    setUser(null);
    setSubs([]);
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
        reminders,
        refreshReminders,
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

export function monthlyEquivalent(sub: Subscription): number {
  if (sub.billing_cycle === 'yearly') return sub.amount / 12;
  if (sub.billing_cycle === 'weekly') return sub.amount * 4.33;
  return sub.amount;
}
