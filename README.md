# SubOrganizer

An Android app for tracking recurring subscriptions: what you pay, when it
renews, and how much it actually costs you per month.

Built India-first — rupees and dollars, with the USD rate fetched live rather
than pinned.

## What it does

- **One honest monthly total.** Weekly and yearly plans are converted to a true
  monthly figure, so the number on the dashboard is what leaves your account.
- **Reminders before the charge.** Local notifications a configurable number of
  days before each renewal.
- **Spending by category**, and a calendar of what falls due in the next 7 and
  30 days.
- **Gmail scanning (optional).** Reads billing mail *on the device* to find
  subscriptions you forgot, including ones you already cancelled. Nothing is
  uploaded; only the entries you approve are saved.
- **Pause instead of delete**, so a lapsed subscription keeps its history.

## Stack

| | |
|---|---|
| App | Expo SDK 54, React Native, Expo Router, TypeScript |
| Backend | Supabase — Postgres with row-level security, and Supabase Auth |
| Auth | Email/password, plus Google via Supabase OAuth (PKCE) |
| Notifications | `expo-notifications`, scheduled locally on the device |
| Builds | EAS |

Android is the shipping target. iOS is supported in code but not built. There is
deliberately no web build — see [docs/gmail-setup.md](docs/gmail-setup.md) for
why Gmail auth cannot work in a browser or in Expo Go.

## Day-to-day development

The loop is: install a **development build** on your phone once, then run the dev
server and every save hot-reloads on the device in about a second. No Play
upload, no rebuild, no reinstall.

```bash
cd frontend
npm install
cp .env.example .env      # then fill in the Supabase and Google client values

# One time — builds a dev client APK and installs it on your phone
eas build --platform android --profile development

# Every session after that
npm run dev
```

Unlike Expo Go, a development build owns the app's native URL scheme, so Google
sign-in and Gmail scanning work in it.

**It installs alongside the Play version.** The development variant uses a
separate package name (`com.suborganizer.app.dev`), app name and URL scheme —
see [app.config.js](frontend/app.config.js) — so you get two icons on the home
screen and never have to uninstall the real app to work on it.

Use `npm run dev`, not `npx expo start`: the wrapper sets `APP_VARIANT`, which the
served manifest needs so the app resolves the right URL scheme. Without it,
Google sign-in redirects to a scheme the dev build does not own.

**Rebuild the dev client only when native config changes** — a new native
dependency, or an edit to plugins/permissions/package name in `app.json`. Pure
JS, TypeScript and UI changes never need one.

Two one-time setup steps for the dev variant, both because the scheme and
package name differ:

- Supabase → Authentication → URL Configuration → add `suborganizer-dev://**`
  to Redirect URLs, or Google sign-in fails in the dev build
- Google Cloud → a second **Android** OAuth client for package
  `com.suborganizer.app.dev` with the dev build's SHA-1 (`eas credentials`), or
  Gmail scanning fails in the dev build

Email/password sign-in works in the dev build with neither.

## Tests

```bash
npm test          # once
npm run test:watch
```

Covers the money and classifier logic — cycle maths, currency conversion, date
handling, trial dates, price-rise detection, and the credit-card filter.

Everything under test is a pure module with no React or storage imports, which
is why those modules are split out (`cycles.ts` from `currency.ts`, `dates.ts`
from the screens) rather than left where they were first written.

## Building for release

```bash
cd frontend
eas build --platform android --profile production   # app bundle, for Play
eas build --platform android --profile preview      # installable APK
```

`versionCode` auto-increments on production builds.

## Layout

```
frontend/
  app/            screens (Expo Router)
  src/
    api.ts        Supabase queries, reminder derivation
    auth-context.tsx  session, and the loading gate the whole app waits on
    supabase.ts   client setup, including the per-request timeout
    currency.ts   INR/USD, live rate, formatting
    cycles.ts     billing-cycle maths (pure, so it is unit-tested)
    dates.ts      YYYY-MM-DD handling in local time (pure)
    trials.ts     free-trial windows
    price-watch.ts  price rises worth surfacing
    cancel-guide.ts / cancel-sheet.tsx  how to actually cancel each merchant
    gmail/        OAuth, Gmail REST, classifier, scan, apply
    notifications.ts
    theme.ts      design tokens
    ui.tsx        shared primitives
supabase/
  schema.sql      tables and row-level security policies
docs/             setup notes, privacy policy, store listing copy
store-assets/     Play Store icon, feature graphic, screenshots
```

## Two things worth knowing before you change them

**Dates are calendar days, not instants.** `next_renewal`, `trial_ends` and
`snoozed_until` are Postgres `date` columns. Always go through
[src/dates.ts](frontend/src/dates.ts) — `new Date(iso)` parses as UTC midnight
and `toISOString()` formats as UTC, and at UTC+5:30 either one silently shifts
the day. That is not hypothetical: it made trials end a day early.

**Nothing may block first paint on a request.** `loading` in
[auth-context.tsx](frontend/src/auth-context.tsx) is cleared from the auth event
itself, using only the session already in hand, because both `app/index.tsx` and
`app/(tabs)/_layout.tsx` render a spinner until it clears. Awaiting a fetch there
means one stalled socket leaves the app on that spinner forever.

## How Gmail scanning decides

Regex and lookup tables, not an LLM — it runs offline, costs nothing per scan,
and every verdict traces back to the exact email and phrase, which the review
screen shows you before anything is saved.

A merchant's mail is replayed oldest-first, so a cancellation followed by a new
signup reads as active again. Bank and credit-card mail is filtered out before
classification: a card bill arrives monthly, states an amount and says "payment
received", which is otherwise indistinguishable from a subscription charge.

Details in [docs/gmail-setup.md](docs/gmail-setup.md).

## Docs

- [docs/gmail-setup.md](docs/gmail-setup.md) — Google OAuth clients, scopes, test users
- [docs/android-launch.md](docs/android-launch.md) — build and release notes
- [docs/play-store-listing.md](docs/play-store-listing.md) — store copy, ready to paste
- [docs/privacy-policy.md](docs/privacy-policy.md) — source for the published policy
