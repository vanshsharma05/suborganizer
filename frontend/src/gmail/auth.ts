/**
 * Google OAuth for the Gmail read-only scope.
 *
 * Deliberately separate from the Supabase Google sign-in in auth-context.tsx.
 * Supabase hands back a `provider_token` that expires in an hour and can only
 * be renewed with the client secret stored in the Supabase dashboard — a secret
 * an app bundle must never contain. A dedicated installed-app OAuth client
 * refreshes with the client id alone, so a scan still works days after the user
 * connected instead of bouncing them through consent every time.
 *
 * It also decouples the two grants: someone who signed up with email/password
 * can still connect Gmail, and disconnecting Gmail does not log them out.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { supabase } from '../supabase';

// gmail.readonly is a *restricted* scope: Google requires app verification (and
// a CASA security assessment) before it works for users outside the test list
// on the OAuth consent screen. See docs/gmail-setup.md.
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

const DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

const STORE_KEY = 'gmail.connection.v1';

/** Refresh a little early so a scan never starts on a token about to expire. */
const EXPIRY_SKEW_MS = 120_000;

export type GmailConnection = {
  /** Supabase user this grant belongs to — guards against a shared device. */
  userId: string;
  email?: string;
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt: number;
};

/** Thrown when the grant is gone or rejected; the UI should offer to reconnect. */
export class GmailAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailAuthError';
  }
}

// ------------------------------------------------------------------ config --

/**
 * Expo Go cannot own `com.suborganizer.app://`, and no Google client type will
 * redirect to an `exp://` URL — Android clients take only the package scheme,
 * web clients only http(s). So Expo Go goes the long way round: Google returns
 * to an https page we control, which forwards to the `exp://` deep link Expo Go
 * does handle. See docs/gmail-callback.html.
 *
 * Because that redirect is https, Expo Go must also use the *web* client id,
 * and therefore the Edge Function for the exchange. Real builds own their
 * scheme and skip all of this.
 */
const inExpoGo = Constants.executionEnvironment === 'storeClient';

/** The bounce page, published from docs/ via GitHub Pages. */
const BOUNCE_URL =
  process.env.EXPO_PUBLIC_GMAIL_BOUNCE_URL ??
  'https://vanshsharma05.github.io/suborganizer/gmail-callback.html';

function clientId(): string {
  const id =
    inExpoGo || Platform.OS === 'web'
      ? process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
      : Platform.OS === 'ios'
        ? process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
        : process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

  if (!id) {
    throw new GmailAuthError(
      `Gmail scanning is not configured for ${Platform.OS}. Add the matching ` +
        'EXPO_PUBLIC_GOOGLE_*_CLIENT_ID to frontend/.env — see docs/gmail-setup.md.',
    );
  }
  return id;
}

/**
 * Why Gmail scanning cannot run here, or null when it can. The UI shows this
 * instead of the Connect button so the user never reaches a flow that is
 * guaranteed to fail.
 */
export function gmailUnavailableReason(): string | null {
  try {
    clientId();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Gmail scanning is unavailable.';
  }
}

/** True when this platform can actually complete the flow. */
export function isGmailConfigured(): boolean {
  return gmailUnavailableReason() === null;
}

/**
 * Google validates the redirect against the OAuth client *type*, and each type
 * accepts a different shape: iOS only the reversed client id, Android only the
 * package name it was registered with, web only an https origin.
 */
function redirectUri(id: string): string {
  if (inExpoGo) return BOUNCE_URL;

  if (Platform.OS === 'web') return AuthSession.makeRedirectUri({ path: 'gmail-callback' });

  if (Platform.OS === 'ios') {
    const reversed = id.replace(/\.apps\.googleusercontent\.com$/, '');
    return `com.googleusercontent.apps.${reversed}:/gmail-callback`;
  }

  // Path matches app/gmail-callback.tsx on purpose. Expo Router also receives
  // this deep link and navigates to it, so it has to resolve to a real screen
  // or the user lands on "Unmatched Route" while the exchange finishes.
  const pkg = Constants.expoConfig?.android?.package ?? 'com.suborganizer.app';
  return `${pkg}:/gmail-callback`;
}

// --------------------------------------------------------------- web proxy --

/**
 * The web build cannot redeem its own authorization code. Google's "Web
 * application" client is a *confidential* client: the token endpoint demands
 * `client_secret` even alongside PKCE, and a secret must never ship in a bundle
 * anyone can download. `supabase/functions/gmail-oauth` holds the secret and
 * redeems on the app's behalf.
 *
 * Native clients are public clients — they exchange and refresh on the client
 * id alone — so they talk to Google directly and skip this entirely.
 */
const usesProxy = Platform.OS === 'web' || inExpoGo;

type ProxyTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

async function callProxy(body: Record<string, unknown>): Promise<ProxyTokens> {
  // invoke() attaches the signed-in user's JWT, which the function requires.
  const { data, error } = await supabase.functions.invoke<ProxyTokens>('gmail-oauth', { body });

  if (error) {
    // supabase-js wraps a non-2xx as FunctionsHttpError and leaves the response
    // on .context — which is where the function's error_description lives.
    let detail = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const payload = await ctx.json().catch(() => null);
      if (payload?.error_description) detail = payload.error_description as string;
    }
    throw new GmailAuthError(detail);
  }

  if (!data?.access_token) {
    throw new GmailAuthError('The Gmail token service returned no access token.');
  }
  return data;
}

// ------------------------------------------------------------------- store --

async function readStore(): Promise<GmailConnection | null> {
  const raw = await AsyncStorage.getItem(STORE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GmailConnection;
  } catch {
    await AsyncStorage.removeItem(STORE_KEY);
    return null;
  }
}

async function writeStore(conn: GmailConnection): Promise<void> {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(conn));
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new GmailAuthError('Not signed in');
  return data.user.id;
}

/** The stored grant for the signed-in user, or null. Does not hit the network. */
export async function getGmailConnection(): Promise<GmailConnection | null> {
  const conn = await readStore();
  if (!conn) return null;

  const { data } = await supabase.auth.getUser();
  // A grant left behind by a previous account must never be reused.
  if (!data.user || data.user.id !== conn.userId) return null;

  return conn;
}

// ------------------------------------------------------------------- flows --

async function fetchMailboxAddress(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { email?: string };
    return json.email;
  } catch {
    // Cosmetic only — the scan works fine without knowing the address.
    return undefined;
  }
}

/** Runs Google consent and stores the resulting grant. */
export async function connectGmail(): Promise<GmailConnection> {
  const id = clientId();
  const redirect = redirectUri(id);

  // Where the bounce page should send the user once Google is done. Carried in
  // `state`, which Google echoes back to the page unchanged.
  const expReturn = inExpoGo ? `exp://${Constants.expoConfig?.hostUri ?? ''}/--/gmail-callback` : '';

  const request = new AuthSession.AuthRequest({
    clientId: id,
    scopes: GMAIL_SCOPES,
    redirectUri: redirect,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    ...(inExpoGo ? { state: expReturn } : {}),
    extraParams: {
      // Without both of these Google returns an access token only, and the user
      // would have to re-consent for every scan once the hour is up.
      access_type: 'offline',
      prompt: 'consent',
    },
  });

  let code: string;

  if (inExpoGo) {
    // promptAsync() would sit waiting for a return to BOUNCE_URL, but the
    // browser carries on to the exp:// link instead — so the session is driven
    // by hand, watching for the deep link rather than the https redirect.
    const authUrl = await request.makeAuthUrlAsync(DISCOVERY);
    const browser = await WebBrowser.openAuthSessionAsync(authUrl, expReturn);

    if (browser.type !== 'success') throw new GmailAuthError('Gmail connection cancelled');

    const params = new URL(browser.url).searchParams;
    const failure = params.get('error');
    if (failure) throw new GmailAuthError(params.get('error_description') ?? failure);

    const returned = params.get('code');
    if (!returned) throw new GmailAuthError('Google did not return an authorization code');
    code = returned;
  } else {
    const result = await request.promptAsync(DISCOVERY);
    if (result.type === 'dismiss' || result.type === 'cancel') {
      throw new GmailAuthError('Gmail connection cancelled');
    }
    if (result.type !== 'success') {
      throw new GmailAuthError(
        (result as { params?: Record<string, string> }).params?.error_description ??
          'Google did not return an authorization code',
      );
    }
    code = result.params.code;
  }

  const token = usesProxy
    ? await callProxy({
        action: 'exchange',
        code,
        codeVerifier: request.codeVerifier ?? '',
        redirectUri: redirect,
      }).then((t) => ({
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresIn: t.expires_in,
        scope: t.scope,
      }))
    : await AuthSession.exchangeCodeAsync(
        {
          clientId: id,
          code,
          redirectUri: redirect,
          extraParams: { code_verifier: request.codeVerifier ?? '' },
        },
        DISCOVERY,
      );

  const granted = token.scope ?? '';
  if (granted && !granted.includes('gmail.readonly')) {
    throw new GmailAuthError(
      'Read access to Gmail was not granted. Tick the Gmail permission on the consent screen.',
    );
  }

  const conn: GmailConnection = {
    userId: await currentUserId(),
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: Date.now() + (token.expiresIn ?? 3600) * 1000,
    email: await fetchMailboxAddress(token.accessToken),
  };

  await writeStore(conn);
  return conn;
}

/**
 * A usable access token, refreshing silently if needed.
 *
 * Returns null rather than throwing when there is simply no grant yet, so the
 * caller can distinguish "never connected" from "connection broke".
 */
export async function getGmailAccessToken(): Promise<string | null> {
  const conn = await getGmailConnection();
  if (!conn) return null;

  if (conn.expiresAt - EXPIRY_SKEW_MS > Date.now()) return conn.accessToken;

  if (!conn.refreshToken) {
    // Google withholds the refresh token when consent was already granted and
    // the request did not force it. Reconnecting (prompt=consent) fixes it.
    await disconnectGmail();
    throw new GmailAuthError('Gmail access expired. Connect again to scan.');
  }

  try {
    const refreshed = usesProxy
      ? await callProxy({ action: 'refresh', refreshToken: conn.refreshToken }).then((t) => ({
          accessToken: t.access_token,
          refreshToken: t.refresh_token,
          expiresIn: t.expires_in,
        }))
      : await AuthSession.refreshAsync(
          { clientId: clientId(), refreshToken: conn.refreshToken, scopes: GMAIL_SCOPES },
          DISCOVERY,
        );

    const next: GmailConnection = {
      ...conn,
      accessToken: refreshed.accessToken,
      // Google usually omits refresh_token on refresh; keep the original.
      refreshToken: refreshed.refreshToken ?? conn.refreshToken,
      expiresAt: Date.now() + (refreshed.expiresIn ?? 3600) * 1000,
    };
    await writeStore(next);
    return next.accessToken;
  } catch {
    // Revoked in the Google account, or the refresh token aged out.
    await disconnectGmail();
    throw new GmailAuthError('Gmail access was revoked. Connect again to scan.');
  }
}

/** Revokes the grant with Google (best effort) and forgets it locally. */
export async function disconnectGmail(): Promise<void> {
  const conn = await readStore();
  await AsyncStorage.removeItem(STORE_KEY);
  if (!conn) return;

  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${conn.refreshToken ?? conn.accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch {
    // Offline: the local copy is gone, which is what matters for this device.
  }
}
