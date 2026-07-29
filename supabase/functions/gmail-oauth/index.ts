/**
 * Server-side half of the Gmail OAuth flow, for the web build only.
 *
 * Google's "Web application" client is a *confidential* client: the token
 * endpoint demands `client_secret` even when the request carries PKCE. A secret
 * cannot live in a JS bundle — anyone can download it — so the browser cannot
 * redeem its own authorization code. This function holds the secret and does
 * the redemption on the app's behalf.
 *
 * Native builds do not use this. Android and iOS OAuth clients are public
 * clients that exchange on the client id alone, so `src/gmail/auth.ts` talks to
 * Google directly there and never touches this endpoint.
 *
 * What this deliberately does NOT do:
 *   - return the client secret, in any form, ever
 *   - accept an arbitrary redirect_uri (allowlisted below)
 *   - serve anonymous callers (a signed-in Supabase user is required)
 *
 * Deploy with --no-verify-jwt. That sounds alarming but is correct here: the
 * gateway's JWT check also rejects the browser's unauthenticated CORS preflight,
 * so the call fails before reaching this file. Auth is enforced below instead,
 * which is stricter — the gateway only proves a token is valid, while this
 * function additionally resolves it to a real user.
 *
 *   supabase functions deploy gmail-oauth --no-verify-jwt
 *   supabase secrets set GOOGLE_WEB_CLIENT_ID=...  GOOGLE_WEB_CLIENT_SECRET=...
 *   supabase secrets set GMAIL_ALLOWED_REDIRECTS=http://localhost:8081/gmail-callback
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

const CLIENT_ID = Deno.env.get('GOOGLE_WEB_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GOOGLE_WEB_CLIENT_SECRET') ?? '';

/**
 * Google binds a code to the redirect_uri it was issued for, so a stolen code
 * cannot be redeemed against a different origin. This list is the second lock:
 * it keeps the function from being aimed at a redirect we do not operate.
 */
const ALLOWED_REDIRECTS = (Deno.env.get('GMAIL_ALLOWED_REDIRECTS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * supabase-js sends `apikey` and `x-client-info` alongside the bearer token.
 * Every header the client sends has to be listed here or the browser's
 * preflight fails and the request never reaches this function.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

type Body = {
  action?: 'exchange' | 'refresh';
  code?: string;
  codeVerifier?: string;
  redirectUri?: string;
  refreshToken?: string;
};

/**
 * Posts to Google and passes the result straight back. Google's own error
 * shape is preserved so the client can show something specific rather than a
 * generic failure.
 */
async function callGoogle(form: Record<string, string>): Promise<Response> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...form,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  const payload = await res.json().catch(() => ({}));

  if (!res.ok) {
    return json(res.status, {
      error: payload.error ?? 'token_request_failed',
      error_description: payload.error_description ?? 'Google rejected the token request.',
    });
  }

  // Only the fields the app needs. Anything else Google adds stays here.
  return json(200, {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_in: payload.expires_in,
    scope: payload.scope,
    token_type: payload.token_type,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Use POST' });

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return json(500, {
      error: 'not_configured',
      error_description:
        'GOOGLE_WEB_CLIENT_ID / GOOGLE_WEB_CLIENT_SECRET are not set on this function.',
    });
  }

  // A signed-in user only. Without this the endpoint is a free code-redemption
  // oracle for anyone who knows the URL.
  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return json(401, { error: 'unauthorized', error_description: 'Missing bearer token.' });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authorization } } },
  );

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return json(401, { error: 'unauthorized', error_description: 'Not signed in.' });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request', error_description: 'Body must be JSON.' });
  }

  if (body.action === 'refresh') {
    if (!body.refreshToken) {
      return json(400, { error: 'bad_request', error_description: 'refreshToken is required.' });
    }
    return await callGoogle({
      grant_type: 'refresh_token',
      refresh_token: body.refreshToken,
    });
  }

  if (body.action === 'exchange') {
    const { code, codeVerifier, redirectUri } = body;
    if (!code || !codeVerifier || !redirectUri) {
      return json(400, {
        error: 'bad_request',
        error_description: 'code, codeVerifier and redirectUri are required.',
      });
    }
    if (!ALLOWED_REDIRECTS.includes(redirectUri)) {
      return json(400, {
        error: 'redirect_not_allowed',
        error_description:
          'That redirect_uri is not in GMAIL_ALLOWED_REDIRECTS for this function.',
      });
    }
    return await callGoogle({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    });
  }

  return json(400, { error: 'bad_request', error_description: 'Unknown action.' });
});
