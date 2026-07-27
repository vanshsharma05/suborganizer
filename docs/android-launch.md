# Android launch checklist

Status of the repo as of 27 July 2026. Ticked items are done in code; the rest
need action in a console somewhere.

---

## Done in this repo

- [x] `eas.json` with `development` / `preview` / `production` profiles
- [x] Production profile builds an **app bundle** (`.aab`) — Play requires it
- [x] `EXPO_PUBLIC_*` values moved into `eas.json`, because `.env` is gitignored
      and a cloud build would otherwise have none. `src/supabase.ts` throws on a
      missing URL/key, so the app would have crashed on first launch.
- [x] Unused permissions removed and **verified against the merged release
      manifest**, not just the source file
- [x] Package `com.suborganizer.app`, versionCode 1, version 1.0.0

### About the permission removal

Deleting the `<uses-permission>` lines from our own manifest did nothing —
rebuilding showed storage permissions still in the APK, because they arrive from
**library** manifests during merging. They need explicit `tools:node="remove"`
markers, which is what the manifest now carries. `SYSTEM_ALERT_WINDOW` needed no
marker: it comes only from `src/debug/AndroidManifest.xml` and never reaches a
release build.

Verified via `gradlew app:processReleaseManifest`, the release build now
requests exactly:

| Permission | Why |
|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE` | Supabase and Gmail API calls |
| `POST_NOTIFICATIONS`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`, `VIBRATE` | local renewal reminders |
| `USE_BIOMETRIC`, `USE_FINGERPRINT` | `expo-secure-store` |
| `READ_APP_BADGE` | notification badge counts |

Re-verify with this after any dependency change:

```bash
cd android && ./gradlew app:processReleaseManifest
grep -oE 'android:name="android\.permission\.[A-Z_]+"' \
  app/build/intermediates/merged_manifest/release/*/AndroidManifest.xml | sort -u
```

### About the values in eas.json

They are public by design and already inlined into the JS bundle, so anyone can
read them out of the APK regardless:

- the Supabase **anon** key — protected by row-level security, not secrecy
- Google OAuth **client IDs** — public halves of a PKCE flow, no secret involved

The `service_role` key must never appear here. Nothing else needs to be secret.

---

## Before you build

- [x] **Hero background bundled instead of hotlinked.** `IMAGES.heroMesh` sits
      behind both the login screen and the dashboard, and was being fetched from
      Unsplash — so the app's first impression depended on someone else's uptime
      and showed a blank panel offline. Now `assets/images/hero-mesh.jpg` (19 KB).
      The unused `IMAGES.premiumBg` was dropped.
- [x] **Six unused dependencies removed** — `react-native-webview`,
      `@gorhom/bottom-sheet`, `expo-haptics`, `expo-symbols`, `dayjs`,
      `react-native-dotenv`. Nothing imported them. Verified with a full native
      rebuild: **debug APK went from 181.6 MB to 106.0 MB.**
      (`expo-secure-store` *is* used — it backs `src/utils/storage/` — so it stays.)
- [ ] **Decide whether v1 ships with Gmail scanning.** See "the long pole" below.
      If not, nothing needs removing — the scan screen shows a setup notice and
      the rest of the app is unaffected.
- [ ] Check the app runs from a clean install with no account.

## Build and signing

The release block in `android/app/build.gradle` still says
`signingConfig signingConfigs.debug` — a leftover from the React Native
template. **A debug-signed bundle cannot be published.** EAS Build overrides
this with managed credentials, so building through EAS is the fix; only a local
`./gradlew assembleRelease` would produce the broken artifact.

```bash
npm install -g eas-cli
eas login
eas build:configure          # links the project, generates a keystore
eas build --platform android --profile production
```

Let EAS generate and hold the keystore. **Losing it means never being able to
update the app again** — back it up with `eas credentials`.

- [ ] Test the `preview` profile APK on a real device before the production build

## Play Console

- [ ] Create the app (name, default language, app/game, free/paid)
- [ ] **Play App Signing** — enabled by default; keep it
- [ ] Store listing: short description, full description, 512×512 icon,
      1024×500 feature graphic, at least 2 phone screenshots
- [ ] **Privacy policy URL** — publish `docs/privacy-policy.md` somewhere public
      and fill in the bracketed fields first
- [ ] Content rating questionnaire
- [ ] Target audience and content
- [ ] **Data safety form.** Declare: email address and name (account
      management), app activity (your subscription entries). Data is encrypted
      in transit, and users can request deletion. If Gmail scanning ships, you
      must also declare email access and explain the read-only, on-device,
      never-stored handling.
- [ ] Upload to **internal testing** first, not production

## Gmail OAuth in production — do not skip

The SHA-1 currently registered on the Android OAuth client
(`5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`) is the **debug**
key. Play re-signs your bundle with a different key, so Gmail sign-in will fail
in production with the same `invalid_request` you saw in development.

- [ ] Play Console → **Setup → App integrity** → copy the **App signing key
      certificate SHA-1**
- [ ] Add it as a *second* Android OAuth client in Google Cloud (same package
      `com.suborganizer.app`), keeping the debug one so development still works
- [ ] Confirm **Enable Custom URI Scheme** is ticked on every Android client —
      Google ships it off by default, which is what caused the original
      `invalid_request`

## The long pole: restricted scope verification

`gmail.readonly` is a **restricted** scope. Until Google verifies the app it
works only for the ≤100 test users listed on the consent screen — everyone else
is blocked outright.

Verification needs:

- [ ] A published privacy policy on a domain you own
- [ ] A homepage explaining the app on the same domain
- [ ] A demo video showing the OAuth consent flow and exactly how Gmail data is
      used
- [ ] The Limited Use disclosure (already in the draft privacy policy)
- [ ] A **CASA security assessment** by a Google-approved third party — this
      costs money and must be renewed annually

It takes weeks. Start it now if launch is near, or ship v1 without Gmail
scanning and enable it when verification lands. **No code changes either way**
— it is purely a state in Google Cloud.

## After launch

- JS-only changes (scanner rules, UI, copy) ship instantly with **EAS Update**,
  no Play review
- Native changes (new modules, permissions, plugins) need a new build and review
- `versionCode` only ever increases; `production` has `autoIncrement` on
- The package name and signing key are permanent
