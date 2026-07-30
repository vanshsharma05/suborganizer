# Gmail scanning — setup

Without a Google OAuth client id the Scan Gmail screen shows a "needs setup"
note. Nothing else in the app is affected.

> The console was reorganised: **OAuth consent screen** now lands on **Google
> Auth Platform → Overview**. That is the right page. Scopes live under **Data
> Access**, test users under **Audience**, and client ids under **Clients**.

---

## 1. Enable the API

<https://console.cloud.google.com/> → pick a project →
**APIs & Services → Library** → search **Gmail API** → **Enable**.

## 2. Google Auth Platform

Left nav → **Google Auth Platform** → **Get started**, then work through the
four steps:

| Step | Enter |
|---|---|
| App information | App name + user support email |
| Audience | **External** |
| Contact information | Your email |
| Finish | Agree, **Create** |

Then, still under Google Auth Platform:

- **Data Access** → *Add or remove scopes* → paste
  `https://www.googleapis.com/auth/gmail.readonly` → **Update** → **Save**
- **Audience** → *Test users* → **Add users** → every Google account you will
  scan with (including your own)

## 3. Create clients

**Google Auth Platform → Clients → Create client.** One per platform you build
for — Google checks the redirect against the client *type*, so one client will
not cover both.

| Platform | Type | Enter |
|---|---|---|
| Android | Android | Package `com.suborganizer.app` + signing SHA-1 |
| iOS | iOS | Bundle ID `com.suborganizer.app` |

Both are *public* clients: they exchange on the client id alone, with PKCE, and
no client secret is involved anywhere in the app.

Debug SHA-1 for Android:

```bash
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
```

For an EAS build take the SHA-1 from `eas credentials` instead.

## 4. Add to .env

```
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=...apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=...apps.googleusercontent.com
```

```bash
npx expo start -c        # -c so Expo re-inlines the new values
```

Client ids are fine in `.env` — they are public by design, and neither client
type has a secret to leak.

Android needs the package-name URL scheme, already in `app.json`. It is a
native change, so a real build is required — `npx expo run:android`, or an EAS
build. Expo Go cannot own the scheme and so cannot complete Gmail consent.

---

## Limits

- **`gmail.readonly` is a restricted scope.** Up to 100 hand-added test users
  work immediately; going public needs Google verification plus a paid CASA
  security assessment. No code changes when that lands.
- **Native only.** Gmail scanning needs an OAuth client whose redirect the app
  itself owns, which means a real Android or iOS build. There is deliberately no
  web path: a Google *Web application* client is confidential and demands
  `client_secret` at the token endpoint even alongside PKCE, and a secret cannot
  ship in a JS bundle. Supporting web would mean a server holding the secret and
  redeeming on the app's behalf — see git history for the version that did, if
  it is ever wanted back.
- **Expo Go cannot do it either**, for the same reason: it cannot claim
  `com.suborganizer.app://`, and Google will not redirect to an `exp://` URL.

---

## How it decides

Regex and lookup tables, not an LLM: offline, free per scan, and every verdict
traces back to the exact email and phrase — which the expandable card shows.

Bank and credit-card mail is dropped before classification. A card bill arrives
monthly, states an amount and says "payment received", so it is otherwise
indistinguishable from a subscription charge. Two filters handle it: a list of
issuer domains, and `isBankingNoise()` for wording no subscription would use —
"total amount due", "credit limit", "payment received towards", "EMI". Senders
in the merchant catalog are exempt, so a real subscription is never dropped on
wording alone.

A merchant's emails are replayed oldest-first:

- a cancellation → cancelled
- a later welcome/signup → active again
- a later charge → active again, but only if more than 7 days after the
  cancellation, so a closing invoice is not read as a restart
- renewal notices, price changes and failed payments never flip the status

Cycle comes from the median gap between real charges, else wording, else
monthly. Amount comes from the most recent charge, ignoring figures next to
discount words. Nothing is saved until you tick it and tap **Apply**.

Code: `auth.ts` (consent, tokens) · `client.ts` (Gmail REST) · `classify.ts`
(email → event) · `scan.ts` (grouping, replay) · `apply.ts` (writes).
