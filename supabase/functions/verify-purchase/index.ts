/**
 * verify-purchase — the only thing allowed to grant an entitlement.
 *
 * The app cannot be trusted to say what it owns, because the app runs on the
 * buyer's phone. Before this existed, `profiles.is_pro` was writable by the
 * client: one PATCH with the anon key and the paywall opened. Column privileges
 * in schema.sql closed that, and this is the other half — the part that decides
 * who *should* get in.
 *
 * The flow is deliberately narrow:
 *
 *   1. Who is calling? Taken from the Authorization header, verified by
 *      Supabase, never from the request body. A caller cannot grant to somebody
 *      else's account because they cannot forge somebody else's JWT.
 *   2. Is the receipt real? Asked of Google or Apple directly. The token in the
 *      body is only ever a lookup key — nothing in it is believed.
 *   3. Write it as service_role, into a table no client may write.
 *
 * Idempotent by construction. `entitlements` is keyed on (user_id, product_id)
 * and carries a unique index on (platform, transaction_id), so a retry after a
 * dropped connection conflicts rather than double-granting, and a receipt
 * already redeemed by one account cannot be redeemed by another.
 *
 * Deploy:  supabase functions deploy verify-purchase
 * Secrets: see README.md in this folder — it will not run without them.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

// ------------------------------------------------------------------ config --

/** Both must match what the stores were configured with. */
const ANDROID_PACKAGE = 'com.suborganizer.app';
const APPLE_BUNDLE_ID = 'com.suborganizer.app';

/** The only things that can be bought. Anything else is rejected unread. */
const PRODUCTS = ['scan_unlock', 'pro_lifetime'] as const;
type ProductId = (typeof PRODUCTS)[number];

type Platform = 'play' | 'apple';

type Body = {
  platform?: unknown;
  productId?: unknown;
  /** Play: purchaseToken. Apple: the transaction id from StoreKit. */
  token?: unknown;
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * Every rejection says the same thing to the caller.
 *
 * "No such transaction", "already redeemed by another account" and "that is not
 * your receipt" are all useful to somebody probing the endpoint with tokens they
 * found, and useless to a genuine buyer, whose app will simply retry. The detail
 * goes to the log instead.
 */
function refuse(reason: string): Response {
  console.error(`[verify-purchase] refused: ${reason}`);
  return json(400, { ok: false, error: 'That purchase could not be verified.' });
}

// -------------------------------------------------------------- Google Play --

/**
 * A Google access token from the service-account key, minted per request.
 *
 * Not cached deliberately. Edge function instances are short-lived and
 * concurrent, so a cache buys one saved round trip in exchange for a class of
 * bug — a stale token shared across invocations — that surfaces as intermittent
 * 401s under load and is miserable to reproduce.
 */
async function googleAccessToken(): Promise<string> {
  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');

  const sa = JSON.parse(raw) as { client_email: string; private_key: string };

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const signingInput = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claim)}`;

  // The PEM arrives with literal \n from the environment, which has to be turned
  // back into real newlines or the base64 body will not decode.
  const pem = sa.private_key
    .replace(/\\n/g, '\n')
    .replace(/-----[A-Z ]+-----/g, '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);

  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}

/**
 * Asks Play whether this token really bought this product.
 *
 * Returns the order id, which becomes `transaction_id` and therefore the thing
 * that makes a replay conflict.
 */
async function verifyPlay(productId: ProductId, token: string): Promise<string> {
  const access = await googleAccessToken();

  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${ANDROID_PACKAGE}/purchases/products/${productId}/tokens/${encodeURIComponent(token)}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${access}` } });
  if (!res.ok) throw new Error(`Play lookup returned ${res.status}`);

  const p = (await res.json()) as {
    purchaseState?: number;
    acknowledgementState?: number;
    orderId?: string;
  };

  // 0 = purchased. 1 = cancelled, 2 = pending. Only the first is a sale, and
  // pending matters in India specifically — UPI mandates and cash-on-delivery
  // style flows sit at 2 for minutes before they settle or expire.
  if (p.purchaseState !== 0) throw new Error(`purchaseState=${p.purchaseState}`);
  if (!p.orderId) throw new Error('Play returned no orderId');

  return p.orderId;
}

// --------------------------------------------------------------- App Store --

/** An ES256 JWT for the App Store Server API. */
async function appleToken(): Promise<string> {
  const keyId = Deno.env.get('APPLE_IAP_KEY_ID');
  const issuerId = Deno.env.get('APPLE_IAP_ISSUER_ID');
  const pemRaw = Deno.env.get('APPLE_IAP_PRIVATE_KEY');
  if (!keyId || !issuerId || !pemRaw) throw new Error('Apple IAP secrets are not set');

  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const signingInput =
    `${b64({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.` +
    `${b64({
      iss: issuerId,
      iat: now,
      exp: now + 900,
      aud: 'appstoreconnect-v1',
      bid: APPLE_BUNDLE_ID,
    })}`;

  const pem = pemRaw
    .replace(/\\n/g, '\n')
    .replace(/-----[A-Z ]+-----/g, '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  // WebCrypto emits the raw r||s pair ES256 wants. Node's default is DER, which
  // is well-formed and verifies nowhere — the same trap scripts/verify-asc-key.js
  // documents. Deno gets this right without asking.
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')}`;
}

/** Decodes a JWS payload without verifying it — Apple already did that. */
function jwsPayload<T>(jws: string): T {
  const part = jws.split('.')[1];
  const pad = part.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(pad + '='.repeat((4 - (pad.length % 4)) % 4))) as T;
}

/**
 * Asks Apple about a transaction id and returns its original transaction id.
 *
 * The original is what identifies the *purchase* rather than this particular
 * receipt of it, which is what makes restores idempotent: restoring on a third
 * device yields the same original id and conflicts, instead of granting again.
 */
async function verifyApple(productId: ProductId, transactionId: string): Promise<string> {
  const jwt = await appleToken();

  // Production first, then sandbox. TestFlight builds transact against sandbox
  // and return 404 here, and a reviewer's purchase is a sandbox purchase — an
  // app rejected because "restore does not work" is usually this.
  const hosts = [
    'https://api.storekit.itunes.apple.com',
    'https://api.storekit-sandbox.itunes.apple.com',
  ];

  for (const host of hosts) {
    const res = await fetch(`${host}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`Apple lookup returned ${res.status}`);

    const { signedTransactionInfo } = (await res.json()) as { signedTransactionInfo: string };
    const t = jwsPayload<{
      productId?: string;
      bundleId?: string;
      originalTransactionId?: string;
      revocationDate?: number;
    }>(signedTransactionInfo);

    if (t.bundleId !== APPLE_BUNDLE_ID) throw new Error(`bundleId=${t.bundleId}`);
    if (t.productId !== productId) throw new Error(`productId=${t.productId}`);
    // Refunded. Apple keeps the transaction and stamps it, so this is the only
    // thing standing between a refund and permanent free access.
    if (t.revocationDate) throw new Error('transaction was revoked');
    if (!t.originalTransactionId) throw new Error('no originalTransactionId');

    return t.originalTransactionId;
  }

  throw new Error('transaction not found in production or sandbox');
}

// ------------------------------------------------------------------ handler --

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only' });

  // Who is asking. Verified by Supabase from the bearer token, never read from
  // the body — that is the whole reason this cannot grant to another account.
  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization) return json(401, { ok: false, error: 'Not signed in.' });

  const caller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authorization } } },
  );

  const { data: auth, error: authError } = await caller.auth.getUser();
  if (authError || !auth.user) return json(401, { ok: false, error: 'Not signed in.' });
  const userId = auth.user.id;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json(400, { ok: false, error: 'Expected a JSON body.' });
  }

  const { platform, productId, token } = body;
  if (platform !== 'play' && platform !== 'apple') return refuse('bad platform');
  if (typeof productId !== 'string' || !PRODUCTS.includes(productId as ProductId)) {
    return refuse(`unknown product ${String(productId)}`);
  }
  if (typeof token !== 'string' || token.length === 0) return refuse('missing token');

  let transactionId: string;
  try {
    transactionId =
      platform === 'play'
        ? await verifyPlay(productId as ProductId, token)
        : await verifyApple(productId as ProductId, token);
  } catch (e) {
    return refuse(`${platform} verification failed: ${e instanceof Error ? e.message : e}`);
  }

  // Only now, and only as service_role, which no client ever holds.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { error: writeError } = await admin.from('entitlements').upsert(
    { user_id: userId, product_id: productId, platform, transaction_id: transactionId },
    { onConflict: 'user_id,product_id' },
  );

  if (writeError) {
    // 23505 on entitlements_transaction_idx means this receipt already belongs
    // to a different account. That is not an error the buyer caused and not one
    // they can fix, but it is exactly what receipt-sharing looks like, so it is
    // refused and logged rather than granted.
    if (writeError.code === '23505') return refuse(`receipt already redeemed: ${transactionId}`);
    console.error('[verify-purchase] write failed', writeError);
    return json(500, { ok: false, error: 'Could not record that purchase.' });
  }

  // Mirror onto the profile so the existing client keeps working unchanged —
  // purchases.tsx still reads user.is_pro. New code should read `entitlements`;
  // this line is what buys the time to migrate it.
  if (productId === 'pro_lifetime') {
    await admin.from('profiles').update({ is_pro: true }).eq('id', userId);
  }

  const { data: owned } = await admin
    .from('entitlements')
    .select('product_id')
    .eq('user_id', userId);

  return json(200, { ok: true, entitlements: (owned ?? []).map((r) => r.product_id) });
});
