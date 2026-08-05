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

import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from '../supabase';
import {
  addMailbox, forUser, mailboxId, needsRefresh, readMailboxes, removeMailbox,
  updateTokens, writeMailboxes, type Mailbox,
} from './mailboxes';

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

/**
 * One grant per inbox, kept in a list.
 *
 * Work receipts land in the work address and personal ones in the personal
 * address, so reading a single mailbox reports a total that is confidently
 * wrong — and wrong by omitting exactly the subscriptions the user had already
 * forgotten. See mailboxes.ts for the store itself.
 */
export type { Mailbox } from './mailboxes';

/** Thrown when the grant is gone or rejected; the UI should offer to reconnect. */
export class GmailAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailAuthError';
  }
}

// ------------------------------------------------------------------ config --

/**
 * True in the development variant, which app.config.js gives its own package
 * name so it can sit alongside the Play install.
 *
 * Google keys an Android OAuth client to a package name, so the dev variant
 * cannot reuse the production client — it needs its own, and therefore its own
 * client id.
 */
const isDevVariant = (Constants.expoConfig?.android?.package ?? '').endsWith('.dev');

function clientId(): string {
  const id =
    Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
      : isDevVariant
        ? process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID_DEV
        : process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

  if (!id) {
    // Said plainly, because the alternative is Google returning an opaque
    // redirect_uri_mismatch that gives no hint about the package name.
    if (isDevVariant) {
      throw new GmailAuthError(
        'Gmail scanning needs its own OAuth client in the dev build, because it ' +
          'runs under com.suborganizer.app.dev. Create an Android client for that ' +
          'package and set EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID_DEV — see ' +
          'docs/gmail-setup.md. It works in preview and production builds already.',
      );
    }
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
 * package name it was registered with.
 */
function redirectUri(id: string): string {
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

// ------------------------------------------------------------------- store --

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new GmailAuthError('Not signed in');
  return data.user.id;
}

/**
 * Every inbox the signed-in user has connected, oldest first. No network.
 *
 * Empty when nobody is signed in, and empty rather than throwing when the
 * device still holds a previous account's grants — `forUser` is the single
 * place that decision is made.
 */
export async function listMailboxes(): Promise<Mailbox[]> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return [];
  return forUser(await readMailboxes(), data.user.id);
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

/**
 * Runs Google consent and stores the resulting grant.
 *
 * Called once per inbox. Connecting a second address is the same flow — what
 * makes it possible is `select_account` in the prompt: without it Google
 * silently reuses whichever account the browser is already signed into, and a
 * user trying to add their work address would connect their personal one again
 * and be told it is already connected.
 */
export async function connectMailbox(): Promise<Mailbox> {
  const id = clientId();
  const redirect = redirectUri(id);

  const request = new AuthSession.AuthRequest({
    clientId: id,
    scopes: GMAIL_SCOPES,
    redirectUri: redirect,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: {
      // `offline` and `consent` together are what produce a refresh token —
      // without them Google returns an access token only, and the user
      // re-consents every hour. `select_account` is what allows a second inbox.
      access_type: 'offline',
      prompt: 'consent select_account',
    },
  });

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

  // Android and iOS clients are public clients: PKCE alone is enough, and no
  // client secret is involved at any point.
  const token = await AuthSession.exchangeCodeAsync(
    {
      clientId: id,
      code: result.params.code,
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

  const email = await fetchMailboxAddress(token.accessToken);
  const now = Date.now();

  const mailbox: Mailbox = {
    // Identified by address, so reconnecting the same inbox updates the grant
    // rather than adding a second copy of it.
    id: mailboxId(email, `mailbox-${now}`),
    email,
    userId: await currentUserId(),
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: now + (token.expiresIn ?? 3600) * 1000,
    connectedAt: now,
  };

  await writeMailboxes(addMailbox(await readMailboxes(), mailbox));
  return mailbox;
}

/**
 * A usable access token, refreshing silently if needed.
 *
 * Returns null rather than throwing when there is simply no grant yet, so the
 * caller can distinguish "never connected" from "connection broke".
 */
export async function accessTokenFor(mailbox: Mailbox): Promise<string> {
  if (!needsRefresh(mailbox)) return mailbox.accessToken;

  if (!mailbox.refreshToken) {
    // Google withholds the refresh token when consent was already granted and
    // the request did not force it. Reconnecting (prompt=consent) fixes it.
    await disconnectMailbox(mailbox.id);
    throw new GmailAuthError(
      `Access to ${mailbox.email ?? 'that inbox'} expired. Connect it again to scan.`,
    );
  }

  try {
    const refreshed = await AuthSession.refreshAsync(
      { clientId: clientId(), refreshToken: mailbox.refreshToken, scopes: GMAIL_SCOPES },
      DISCOVERY,
    );

    const expiresAt = Date.now() + (refreshed.expiresIn ?? 3600) * 1000;
    await writeMailboxes(
      updateTokens(await readMailboxes(), mailbox.id, {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt,
      }),
    );
    return refreshed.accessToken;
  } catch {
    // Revoked in the Google account, or the refresh token aged out. Drop this
    // inbox only — the others are unaffected and their scans should still run.
    await disconnectMailbox(mailbox.id);
    throw new GmailAuthError(
      `Access to ${mailbox.email ?? 'that inbox'} was revoked. Connect it again to scan.`,
    );
  }
}

/** Best-effort revoke with Google. Failure is not worth telling anyone about. */
async function revoke(mailbox: Mailbox): Promise<void> {
  try {
    await fetch(
      `https://oauth2.googleapis.com/revoke?token=${mailbox.refreshToken ?? mailbox.accessToken}`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
  } catch {
    // Offline: the local copy is gone, which is what matters for this device.
  }
}

/** Forgets one inbox and revokes its grant. The others are untouched. */
export async function disconnectMailbox(id: string): Promise<void> {
  const all = await readMailboxes();
  const gone = all.find((m) => m.id === id);
  await writeMailboxes(removeMailbox(all, id));
  if (gone) await revoke(gone);
}

/**
 * Forgets every inbox on this device.
 *
 * Called on sign-out. Leaving grants that can read somebody's mail on a
 * signed-out device is not a trade worth making for convenience — including
 * grants belonging to a different account, which is why this clears the lot
 * rather than only the current user's.
 */
export async function disconnectGmail(): Promise<void> {
  const all = await readMailboxes();
  await writeMailboxes([]);
  for (const m of all) await revoke(m);
}
