# verify-purchase

Server-side receipt validation. The only thing permitted to grant an entitlement.

**Status: written, never run.** There is no way to test it without the store
credentials below and a deployed project, so treat every step here as unverified
until you have seen it return `{"ok":true}` once.

---

## Why it exists

`profiles.is_pro` used to be writable by the client. One request with the anon
key — which ships inside the app by design — granted Pro:

```
PATCH /rest/v1/profiles?id=eq.<own uid>   {"is_pro": true}
```

`schema.sql` now revokes that column from `authenticated`, which stops the
forgery. This function is the other half: the part that decides who *should* get
in, by asking Google and Apple rather than the phone.

---

## Credentials — fill these in

### 1. Google Play

Needs a service account with **Android Publisher** access. It is a two-console
job and the second half is the one people miss.

1. **Google Cloud Console** → IAM & Admin → Service Accounts → **Create**
   - Name it something like `play-receipt-verifier`
   - Keys → Add Key → **JSON** → download it. Downloads once.
2. **Google Play Console** → Users and permissions → **Invite new user**
   - The service account's `client_email` from that JSON
   - App permissions: SubOrganizer → **View financial data** and
     **Manage orders and subscriptions**
   - *Without this step the API returns 401 forever and the JSON key looks
     broken. It is not — Play simply does not know the account.*
3. Wait. Play takes up to 24 hours to propagate a new service account. A 401 in
   the first hour means nothing.

```bash
supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON="$(cat play-verifier.json)"
```

### 2. Apple

Needs an **In-App Purchase** key, which is *not* the App Store Connect API key
already at `C:\Users\vnshh\AppleKeys\AuthKey_CQ82WNPH8A.p8`. Different key type,
different issuer id.

1. **App Store Connect** → Users and Access → Integrations → **In-App Purchase**
   → generate. Downloads once.
2. Take the **Key ID** from that row and the **Issuer ID** from the same page.

```bash
supabase secrets set APPLE_IAP_KEY_ID=XXXXXXXXXX
supabase secrets set APPLE_IAP_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
supabase secrets set APPLE_IAP_PRIVATE_KEY="$(cat AuthKey_XXXXXXXXXX.p8)"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
by the platform. Do not set them, and do not put the service_role key anywhere
else — it bypasses RLS entirely.

---

## Deploy

```bash
supabase functions deploy verify-purchase
```

Run `schema.sql` first, or the `entitlements` table it writes to will not exist.

---

## Wiring the app to it

Not done yet — deliberately. The function can be deployed and proven before the
client depends on it, which means a broken deploy cannot break purchasing.

When you are ready, in `src/purchases.tsx`, replace the `setProFlag(true)` mirror
with a call to this function, passing the purchase token from `expo-iap`:

- **Play** — `purchase.purchaseToken`
- **Apple** — `purchase.transactionId`

Keep reading entitlements from the store as the fast path. This is the
authority, not the latency budget: a network failure here should leave a paying
user with access, because the store already told the device it owns the product.

---

## Testing it

```bash
supabase functions serve verify-purchase
curl -i localhost:54321/functions/v1/verify-purchase \
  -H "Authorization: Bearer <a real user JWT>" \
  -H "Content-Type: application/json" \
  -d '{"platform":"play","productId":"pro_lifetime","token":"<purchaseToken>"}'
```

What to check, in order:

1. **No Authorization header → 401.** If this grants anything, stop.
2. **A token from a different app or a made-up string → 400.** The refusal text
   is deliberately identical for every failure; the reason is in the logs.
3. **The same valid token twice → `{"ok":true}` both times**, one row in
   `entitlements`. That is idempotency, and it is what makes a retry after a
   dropped connection safe.
4. **The same token from a second account → 400.** The unique index on
   `(platform, transaction_id)` is what stops one receipt unlocking many
   accounts.
5. **A refunded Apple transaction → 400.** `revocationDate` is the only thing
   between a refund and permanent free access.

Sandbox note: TestFlight and reviewer purchases are sandbox purchases. The Apple
path tries production, then sandbox on a 404 — an app rejected for "restore does
not work" is usually a verifier that only ever asked production.

---

## Known gaps

- **No refund webhook.** Apple's App Store Server Notifications V2 and Play's
  Real-time Developer Notifications can tell you about a refund the moment it
  happens. Without them, a refunded `pro_lifetime` keeps working until something
  re-verifies it. Acceptable for a one-time purchase at ₹199; not acceptable if
  a recurring plan is ever added.
- **`profiles.is_pro` is still the client's source of truth.** The mirror at the
  end of the handler keeps the current app working. Migrating `purchases.tsx` to
  read `entitlements` directly is what finally retires that column.
- **`scan_unlock` is still device-local** in `billing.owned.v1`. Once this is
  wired up, an unlock bought on one phone should follow the account.
