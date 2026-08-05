# iOS launch checklist

Status of the repo as of 4 August 2026. Ticked items are done in code; the rest
need action in a console somewhere, and most of them need the Apple Developer
account first.

**Nothing here has run on an iPhone.** The code compiles for iOS and the config
resolves, both verified below, but no part of this has been seen working on a
device. Treat every tick as "written and type-checked", not as "tested".

---

## Done in this repo

- [x] **Sign in with Apple** — `expo-apple-authentication`, the native flow, the
      nonce exchange, and Apple's own button component
- [x] `ios.usesAppleSignIn: true`, so the build carries the
      `com.apple.developer.applesignin` entitlement
- [x] `ITSAppUsesNonExemptEncryption: false` via
      `ios.config.usesNonExemptEncryption`, so TestFlight stops asking the export
      compliance question on every single upload
- [x] `ios.supportsTablet` turned **off** — see below
- [x] `simulator: false` on the `development` and `preview` profiles
- [x] In-app account deletion (`delete_me()`), which Apple requires under
      **5.1.1(v)** and rejects apps for lacking
- [x] Status bar forced light on the two full-coral screens (`auth`,
      `reset-password`); the root layout switches to dark when the splash fades
- [x] Purchases correctly report unavailable on iOS, so no dead buy button
- [x] `icon.png` is 1024×1024 with **no alpha channel**, which is what iOS
      requires and what an alpha channel gets an upload rejected for

### Verified

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `expo lint` | clean |
| `vitest run` | 317 passing, 14 files |
| `expo export --platform ios` | 2,099 modules, 5.83 MB Hermes bundle |
| `expo export --platform android` | 2,098 modules, still builds |
| `expo config --type introspect` | entitlement and Info.plist keys present |

### Why tablet support is off

`supportsTablet: true` was the default and it is a promise. Turning it on means
Apple reviews the app on an iPad **and** the listing requires iPad screenshots.
For a first release of an app that has never run on iOS at all, that is two extra
ways to be rejected in exchange for nothing. With it off the app still runs on
iPad, in an iPhone-sized window.

Turn it on later, once somebody has actually held an iPad running it.

### About the nonce

Worth knowing before anyone "simplifies" it. A random value is generated on the
device, its **SHA-256 hash** goes to Apple, and Apple embeds that hash in the
token it signs. Supabase is then handed the **original**, hashes it, and checks
the two match. That is what stops a token captured from one sign-in being
replayed into another.

Sending the same value to both sides verifies happily and proves nothing.

### About the name

Apple returns the user's name **once, ever** — first authorization per Apple ID
per app, not per device or per install. `src/apple.ts` captures it at that one
moment and writes it to the profile.

A later sign-in returns null and must not overwrite what is stored, because by
then the profile holds the only copy in existence and Apple will never send it
again to put it back. `nameToStore` is what enforces that, and it is tested.

"Hide My Email" is the other half of this. It issues an address like
`a4f9c2e1b8@privaterelay.appleid.com`, and every name fallback in the app derived
a display name from the part before the `@`. Without `isMachineAddress` the
dashboard greets people as `a4f9c2e1b8`.

---

## The Apple account — done, 5 August 2026

Verified against Apple's API, not assumed. Re-run `scripts/verify-asc-key.js`
any time.

- [x] App Store Connect API access granted; **Admin** Team Key `EAS Build`
- [x] `com.suborganizer.app` registered, **Sign in with Apple** enabled
- [x] `com.suborganizer.app.dev` registered, **Sign in with Apple** enabled
- [x] Sign in with Apple key created
- [x] Free Apps agreement **Active**

| | |
|---|---|
| Team ID | `87ZSB7PJYF` (Individual enrolment) |
| ASC API Key ID | `CQ82WNPH8A` |
| ASC Issuer ID | `1fcb1b37-3d10-4c4b-b9d1-338575344786` |
| Sign in with Apple Key ID | `75FUG6BCGL` |

The two `.p8` files live in `C:\Users\vnshh\AppleKeys\`, outside this repo and
outside OneDrive. `.gitignore` blocks `*.p8` at both root and frontend as a
second line of defence. **Neither can be downloaded again**; losing one means
the Account Holder has to revoke and regenerate.

## Still to do

- [ ] Create the **App Store Connect app record** — the bundle ID exists now, so
      this is unblocked. Its Apple ID becomes `ascAppId` in `eas.json`.
- [ ] In Supabase → Authentication → Providers → **Apple**: enable it, and add
      `com.suborganizer.app,com.suborganizer.app.dev` to **Authorized Client
      IDs**. Leave the secret fields empty — the native flow sends a token whose
      audience is the *bundle ID*, and Supabase rejects it without this. It is
      the single most common way native Apple sign-in fails from a
      correct-looking setup.
### The Gmail scan on iOS — done, 5 August 2026

Two things, and the second is the one that is easy to miss.

`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` is in `eas.json`. `src/gmail/auth.ts` picks a
different OAuth client per platform, and without this it refuses on iOS rather
than starting a flow that cannot finish.

**The reversed client id is registered as a URL scheme** in `app.json`:

```
com.googleusercontent.apps.935820170470-evvedc5smq09brul8afcf8f0cl4rdthq
```

Google sends the iOS consent result back to `<reversed-id>:/gmail-callback`, and
iOS only delivers a URL to an app that declares its scheme. Without this the
consent sheet opens, the user approves, and nothing comes back — a hang with no
error anywhere, which is the worst shape a bug can take.

Appended rather than prepended: `appScheme()` in `auth-context.tsx` reads
`scheme[0]`, and that has to stay `suborganizer` or Supabase sign-in breaks.

The development variant replaces the scheme list wholesale in `app.config.js`,
so an iOS dev build would need its own OAuth client and its own reversed scheme.
Nothing needs that yet.
- [ ] Paid Apps agreement is **Pending User Info**: two US tax forms are
      unsubmitted and only the Account Holder can sign them. Nothing is for sale
      on iOS, so this blocks nothing today — it blocks in-app purchases whenever
      they come to iOS.

## Needs a physical iPhone

There is no way around this one. iOS builds happen in the cloud, so Windows is
fine for building — but a simulator cannot be run on Windows, so the only way to
see the app is TestFlight on a real device.

- [ ] Sign in with Apple, end to end, including "Hide My Email"
- [ ] The name is captured on the first authorization and survives a sign-out
- [ ] Keyboard avoidance on a notched device — `behavior="padding"` is set on the
      three form screens but has never been seen
- [ ] The tab bar against the home indicator
- [ ] `includeFontPadding` / `textAlignVertical` are Android-only and are ignored
      on iOS. Anything relying on them for vertical centring may sit a point or
      two off. Check the segmented control, the amount field, and the tab labels.

## Needs both

- [ ] Privacy nutrition labels in App Store Connect
- [ ] Screenshots at the required sizes (6.7" and 6.5", iPhone only now that
      tablet support is off)
- [ ] Review notes with the test account — reviewers will not sign up
- [ ] StoreKit products, if the paid unlocks should exist on iOS at all. Play
      Billing is Android-only in `billing-play.ts` and nothing on iOS is for
      sale, which is a valid state and needs no reviewer explanation.

---

## Getting access

Ask which enrollment the account is: **developer.apple.com → Account →
Membership details**. A company under "Entity Name" means Organization; a
person's own name means Individual.

**Organization** — the account holder invites you: App Store Connect → Users and
Access → **+** → your email → role **Admin** → tick **Access to Certificates,
Identifiers & Profiles**. You then use your own Apple ID and `eas build` works
unchanged.

**Individual** — Apple does not support team members for developer resources.
App Store Connect can still be shared, but developer.apple.com cannot be.

Either way, ask for an **App Store Connect API key**: Users and Access →
Integrations → App Store Connect API → generate with **Admin** access. That is
the `.p8` file, the Key ID and the Issuer ID, and it lets EAS submit builds
without anybody sharing a password or reading 2FA codes down the phone.

**Ownership.** An app published under someone else's account belongs to that
account. Transferring it later is a real process with conditions attached. Worth
settling before the first upload, not after.
