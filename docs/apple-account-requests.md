# Everything needed from the Apple Account Holder

Written 4 August 2026, because the Account Holder is away for three days and a
missed item costs all three.

**Account Holder:** Ankur Gupta, `ankurshori@gmail.com`
**Team:** `Ankur Gupta|1627036688|1` — an **Individual** enrolment, which is why
developer.apple.com cannot be shared however the permissions are set.

Ten minutes of his time, in this order. The order matters: step 6 cannot be done
before step 5, and step 8 cannot be done before step 6.

---

## The two things most likely to go wrong

**There are two different `.p8` files here**, made in two different places, and
they are not interchangeable. Saving both as `AuthKey.p8` in the same folder is
the classic way to lose a day.

| File | Made in | What it is for |
|---|---|---|
| `EAS-Build-ASC.p8` | App Store Connect → Integrations | Building and uploading |
| `SignInWithApple.p8` | developer.apple.com → Keys | Apple sign-in, if the web flow is needed |

**Each one downloads exactly once.** Apple will not offer it again. A lost key
must be revoked and remade — which means waiting for him to come back.

---

## Part 1 — App Store Connect · 3 minutes

Sign in at **appstoreconnect.apple.com** as `ankurshori@gmail.com`.

**1. Turn on API access.** Users and Access → **Integrations** → App Store
Connect API → **Request Access** → confirm.

Only the Account Holder sees this button. It is the single biggest blocker: with
it off, nobody on the team can generate any key at all, and no iOS build can
happen.

**2. Generate the key.** Same page, **Team Keys** → **+**

- Name: `EAS Build`
- Access: **Admin** ← not App Manager, not Developer

**3. Download it.** Save as `EAS-Build-ASC.p8`. Send it over.

**4. Copy two more values from that page.**

- **Key ID** — 10 characters, in the table row next to the key
- **Issuer ID** — a long UUID at the **top** of the page, above the table

The Issuer ID is the one people miss, because it is not in the table with
everything else.

---

## Part 2 — developer.apple.com · 5 minutes

Sign in at **developer.apple.com/account**.

**5. Send the Team ID.** Membership details → the **Team ID** is 10 characters,
letters and numbers, like `A1B2C3D4E5`.

Not `1627036688`. That is Apple's internal numeric id, and using it produces a
signing failure that names nothing in particular.

While there: **note the membership expiry date.** If it lapses mid-launch
everything stops, and that is worth knowing in advance rather than discovering.

**6. Register the app identifier.** Certificates, Identifiers & Profiles →
**Identifiers** → **+**

- **App IDs** → Continue → **App** → Continue
- Description: `SubOrganizer`
- Bundle ID: **Explicit** → `com.suborganizer.app`
- Capabilities: tick **Sign in with Apple**
- Continue → Register

The API key from step 2 could do this on its own, but it takes ninety seconds by
hand and removes any chance of being stuck for three days on a step that turned
out not to work.

**7. Register the development identifier too.** Same again, one value different:

- Description: `SubOrganizer Dev`
- Bundle ID: **Explicit** → `com.suborganizer.app.dev`
- Capabilities: tick **Sign in with Apple**

This is the variant that installs alongside the store build. Cheap now,
another three-day wait later.

**8. Create the Sign in with Apple key.** Certificates, Identifiers & Profiles →
**Keys** → **+**

- Name: `SubOrganizer Sign in with Apple`
- Tick **Sign in with Apple** → **Configure**
- Primary App ID: **SubOrganizer (com.suborganizer.app)** ← needs step 6 done
- Save → Continue → Register
- **Download** — save as `SignInWithApple.p8`, send it over
- Copy its **Key ID** as well

**Probably not needed, requested anyway.** Native Apple sign-in on iOS wants only
the bundle identifier in Supabase's *Authorized Client IDs*; this key is for the
web OAuth flow. It costs him a minute now and removes the risk of finding out
otherwise while he is unreachable.

---

## Part 3 — Agreements · 1 minute

**9.** App Store Connect → **Business** → check the agreement status.

It must read **Active**. If anything is pending acceptance, accept it.

Only the Account Holder can. An unaccepted agreement blocks submission
completely, and it fails at the very end — after the build, after the upload,
with a message about your account rather than your app.

---

## Part 4 — Not Apple

**10. A domain.** Google rejected the OAuth branding verification because
`vanshsharma05.github.io` is not registrable by us — `github.io` belongs to
GitHub, and no amount of resubmitting changes that.

Needed: a domain the company actually owns. Roughly ₹800–1,500 a year.

Either confirm one already exists that can be used, or approve buying one. It
only gates the Gmail scan's restricted scope — not sign-in, not the launch — so
it can wait, but the decision cannot be made without him.

---

## Before he leaves the building

Do not accept the files and let him go. **Check the key works.**

```bash
cd frontend
node scripts/verify-asc-key.js <path-to-EAS-Build-ASC.p8> <KEY_ID> <ISSUER_ID>
```

It signs a real token and calls Apple twice: once to prove the key
authenticates, once to prove it has enough access to register a bundle
identifier — which is the first thing an iOS build does, and the thing a
key with too little access fails at silently.

| What it says | What to do |
|---|---|
| `The key is good` | Done. He can go. |
| `Apple rejected the key (401)` | One of the three values is wrong — most often the Issuer ID |
| `cannot see bundle identifiers (403)` | Generated with less than Admin. **It must be regenerated** — access level cannot be changed afterwards |
| `not an Apple .p8 private key` | The download is truncated or the wrong file |

The 403 is the one worth being stubborn about. It authenticates perfectly and
fails at the first build, days later.

---

## What is still blocked afterwards

Not his to give, and worth saying plainly:

**A physical iPhone.** Windows cannot run an iOS simulator, so every App Store
screenshot and every "does this actually work" check waits for a real device.
The API key unblocks *building*. It does not unblock *seeing*.
