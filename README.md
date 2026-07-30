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

## Running it

```bash
cd frontend
npm install
cp .env.example .env      # then fill in the Supabase and Google client values
npx expo start
```

Gmail scanning needs a real build, because it depends on a native URL scheme
Expo Go cannot claim:

```bash
npx expo run:android
```

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
    api.ts        Supabase queries
    auth-context.tsx
    currency.ts   INR/USD, live rate, monthly equivalents
    gmail/        OAuth, Gmail REST, classifier, scan, apply
    notifications.ts
    theme.ts      design tokens
supabase/
  schema.sql      tables and row-level security policies
docs/             setup notes, privacy policy, store listing copy
store-assets/     Play Store icon, feature graphic, screenshots
```

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
