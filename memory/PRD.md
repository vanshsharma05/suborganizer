# SubOrganizer — Product Requirements Document

## Overview
SubOrganizer is a premium mobile subscription manager that helps users track, organize, and optimize their recurring paid subscriptions. Users can manually add subscriptions, "scan" their inbox for discovered subscriptions (mocked), and receive AI-powered spending insights.

## Tech Stack
- **Frontend**: Expo (React Native) SDK 54, Expo Router, Reanimated 4, react-native-svg, expo-blur, expo-linear-gradient
- **Backend**: FastAPI + Motor (MongoDB)
- **AI**: Emergent LLM key using Anthropic Claude Sonnet 4.6 (via `emergentintegrations`)
- **Auth**: Email/password JWT (30-day expiry), bcrypt password hashing
- **Local storage**: `expo-secure-store` (native) / `AsyncStorage` (web) for JWT

## Design
- **Palette**: Warm coral / peach / teal / ink (NO purple — user explicitly requested to avoid AI-slop)
- **Personality**: Premium light theme, gradient-rich, editorial fintech feel
- **Fonts**: System font with tuned weights + letter-spacing for architectural look
- **Icons**: Ionicons (via @expo/vector-icons)
- **Design tokens** in `/app/frontend/src/theme.ts`

## Screens implemented
1. **Auth** (`/auth`) — Segmented Sign-in / Create-account, hero mesh background, gradient CTA, demo-account shortcut
2. **Dashboard** (`/(tabs)/dashboard`) — Hero card with animated counter, category donut chart (react-native-svg), Gmail "scan" CTA, discovered-subs list, upcoming renewals carousel
3. **Subscriptions** (`/(tabs)/subscriptions`) — Filterable/sortable list, brand-color avatars via Clearbit, animated row entrance, monthly-equivalent display
4. **Calendar** (`/(tabs)/calendar`) — Vertical timeline, "next 7 days" / "next 30 days" summary
5. **Insights** (`/(tabs)/insights`) — Basic AI summary (free), category bars, Pro-gated savings tip + unused-alert with blur overlay and upgrade CTA
6. **Profile** (`/(tabs)/profile`) — User card, stats, settings rows, logout
7. **Subscription form** (`/subscription/[id]`) — Add/edit with amount, cycle segmented control, category chips, quick-bump date, pause & delete actions on edit

## API Endpoints (all prefixed with `/api`)
- `POST /auth/signup` — Creates user + seeds 11 mock subs
- `POST /auth/login` — Returns JWT
- `GET /auth/me` — Returns current user
- `POST /auth/upgrade` — Marks user as Pro
- `GET /subscriptions` — List user's subscriptions
- `POST /subscriptions` — Create
- `PUT /subscriptions/{id}` — Update
- `DELETE /subscriptions/{id}` — Delete
- `POST /subscriptions/{id}/toggle` — Toggle active/paused
- `POST /subscriptions/scan-mail` — Mock Gmail scan (returns 3 random candidates)
- `GET /insights` — Aggregates + LLM savings tip / unused alert (Claude Sonnet 4.6)

## Freemium Model
- **Free**: full tracking, dashboard, calendar, basic AI summary, category breakdown
- **Pro**: personalized AI savings tips + unused-subscription alerts (currently free upgrade for demo)

## Next Enhancements (potential)
- Real Gmail OAuth integration (already scaffolded via `scan-mail` endpoint)
- Notifications for upcoming renewals
- Stripe billing for real Pro upgrade
- Export CSV / share monthly report
