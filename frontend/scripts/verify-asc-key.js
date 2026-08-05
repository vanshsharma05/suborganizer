#!/usr/bin/env node
/**
 * Checks an App Store Connect API key actually works — before the only person
 * who can regenerate it goes away for three days.
 *
 * The failure this exists to catch is a quiet one. A `.p8` file, a Key ID and an
 * Issuer ID all look fine sitting in a folder; there is nothing to inspect and
 * no way to tell a working key from a truncated download, a Key ID copied from
 * the wrong row, or a key generated with too little access. You find out at the
 * first `eas build`, which may be days later and long past the point where
 * asking again is easy.
 *
 * So it signs a real token and makes real calls:
 *   - /v1/apps       — proves the key authenticates at all
 *   - /v1/bundleIds  — proves it has enough access to do signing work
 *
 * The second matters more than it looks. A key generated with Developer or App
 * Manager access authenticates perfectly and then cannot register a bundle
 * identifier, which is the first thing an iOS build needs.
 *
 * Usage:
 *   node scripts/verify-asc-key.js <path-to.p8> <KEY_ID> <ISSUER_ID>
 *
 * No dependencies. Node's own crypto signs ES256, and fetch is built in.
 */

const fs = require('node:fs');
const crypto = require('node:crypto');

const [, , p8Path, keyId, issuerId] = process.argv;

if (!p8Path || !keyId || !issuerId) {
  console.error('Usage: node scripts/verify-asc-key.js <path-to.p8> <KEY_ID> <ISSUER_ID>');
  process.exit(2);
}

function fail(message, hint) {
  console.error(`\n  FAILED — ${message}`);
  if (hint) console.error(`  ${hint}`);
  console.error('');
  process.exit(1);
}

let privateKey;
try {
  privateKey = fs.readFileSync(p8Path, 'utf8');
} catch {
  fail(`Could not read ${p8Path}`, 'Check the path. Wrap it in quotes if it has spaces.');
}

if (!privateKey.includes('BEGIN PRIVATE KEY')) {
  fail(
    'That file is not an Apple .p8 private key.',
    'It should start with -----BEGIN PRIVATE KEY-----. A truncated or ' +
      'renamed download is the usual cause.',
  );
}

const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

const now = Math.floor(Date.now() / 1000);
const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
// Apple rejects anything longer than 20 minutes. Ten is plenty for two calls.
const payload = { iss: issuerId, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' };

const signingInput = `${base64url(header)}.${base64url(payload)}`;

let token;
try {
  // ieee-p1363 is not optional: JWT wants the raw r||s pair, and Node's default
  // is DER. A DER signature is well-formed, verifies nowhere, and comes back as
  // a flat 401 with nothing to indicate the encoding was the problem.
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  token = `${signingInput}.${signature.toString('base64url')}`;
} catch (e) {
  fail(`Could not sign with that key: ${e.message}`, 'The .p8 file is probably damaged.');
}

async function call(path) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // Apple answers some failures with an empty body.
  }
  return { status: res.status, body };
}

(async () => {
  console.log('\n  Checking the key against Apple...\n');

  const apps = await call('/v1/apps?limit=1');

  if (apps.status === 401) {
    fail(
      'Apple rejected the key (401).',
      'One of the three values is wrong. The Issuer ID is the one people get ' +
        'wrong — it is the UUID at the top of the API Keys page, not the Key ID ' +
        'from the table.',
    );
  }
  if (apps.status === 403) {
    fail(
      'The key authenticated but is not allowed to read apps (403).',
      'It was probably generated with less than Admin access. It has to be ' +
        'regenerated — access level cannot be changed afterwards.',
    );
  }
  if (apps.status !== 200) {
    const detail = apps.body?.errors?.[0]?.detail ?? '';
    fail(`Unexpected response ${apps.status}. ${detail}`);
  }

  console.log('  ✓ The key authenticates.');

  const count = apps.body?.data?.length ?? 0;
  console.log(
    count === 0
      ? '  · No apps on the account yet, which is expected.'
      : `  · Can see ${count} app record${count === 1 ? '' : 's'}.`,
  );

  // The one that matters. Registering a bundle identifier is the first thing an
  // iOS build does, and a key without the access to do it fails only then.
  const bundles = await call('/v1/bundleIds?limit=200');

  if (bundles.status === 403) {
    fail(
      'The key cannot see bundle identifiers (403).',
      'It needs Admin access to register one, which is the first thing an iOS ' +
        'build needs. Ask for it to be regenerated with Admin before he leaves.',
    );
  }
  if (bundles.status !== 200) {
    const detail = bundles.body?.errors?.[0]?.detail ?? '';
    fail(`Could not read bundle identifiers: ${bundles.status}. ${detail}`);
  }

  console.log('  ✓ The key can manage bundle identifiers — Admin access confirmed.');

  // ------------------------------------------------------ the identifiers --

  console.log('');

  const missing = [];
  const registered = new Map(
    (bundles.body?.data ?? []).map((b) => [b.attributes?.identifier, b.id]),
  );

  for (const identifier of ['com.suborganizer.app', 'com.suborganizer.app.dev']) {
    const bundleId = registered.get(identifier);

    if (!bundleId) {
      console.log(`  ✗ ${identifier} — not registered`);
      missing.push(`Register ${identifier}`);
      continue;
    }

    /*
     * Registered is not the same as ready.
     *
     * Sign in with Apple is a checkbox on the registration screen, easy to skip,
     * and nothing afterwards mentions it. The identifier looks completely
     * correct in the list either way. What happens instead is that the build
     * fails on a missing entitlement much later, by which point the only person
     * who can tick it may be unreachable — which is the entire reason this
     * script exists.
     *
     * APPLE_ID_AUTH is Apple's name for the capability.
     */
    // No `limit` here. This relationship rejects it outright — 400, "The
    // parameter 'limit' can not be used with this request" — which is easy to
    // mistake for a permissions problem, since it arrives looking like any
    // other failed call.
    const caps = await call(`/v1/bundleIds/${bundleId}/bundleIdCapabilities`);
    if (caps.status !== 200) {
      console.log(`  ? ${identifier} — registered, but its capabilities could not be read`);
      continue;
    }

    const types = (caps.body?.data ?? []).map((c) => c.attributes?.capabilityType);
    if (types.includes('APPLE_ID_AUTH')) {
      console.log(`  ✓ ${identifier} — registered, Sign in with Apple on`);
    } else {
      console.log(`  ✗ ${identifier} — registered, but Sign in with Apple is NOT ticked`);
      missing.push(`Tick "Sign in with Apple" on ${identifier}`);
    }
  }

  if (missing.length > 0) {
    console.error('\n  NOT FINISHED — still needed from the Account Holder:\n');
    for (const item of missing) console.error(`    · ${item}`);
    console.error(
      '\n  Both are done at developer.apple.com/account/resources/identifiers/list\n' +
        '  and neither can be done by anybody else.\n',
    );
    process.exit(1);
  }

  console.log('\n  Everything the API can see is done.');
  console.log('  Still check by hand: the Sign in with Apple key file, the Team ID,');
  console.log('  and the agreements — none of those are exposed by the API.\n');
})().catch((e) => {
  fail(`Could not reach Apple: ${e.message}`, 'Check your connection and try again.');
});
