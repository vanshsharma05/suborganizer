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
});

// Supabase refreshes tokens on a timer, which the OS suspends in the
// background. Re-sync on foreground so a returning user is not bounced to the
// login screen by an expired token.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
