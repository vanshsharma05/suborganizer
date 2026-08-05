# Everything needed from the Apple Account Holder

Written 4 August 2026, because the Account Holder is away for three days and a
missed item costs all three.

**Account Holder:** Ankur Gupta, `ankurshori@gmail.com`
**Team:** `Ankur Gupta|1627036688|1` — an **Individual** enrolment, which is why
developer.apple.com cannot be shared however the permissions are set.

Ten minutes of his time, in this order. The order matters: step 8 cannot be done
before step 6, and step 2 cannot be done before step 1 is approved.

Every navigation path below was checked against Apple's own help pages on
4 August 2026, not written from memory. The labels are theirs.

**One thing that is less urgent than it looks:** generating the API key needs
**Account Holder *or* Admin**, and Vansh is Admin. So the only genuinely
Account-Holder-exclusive items are **step 1** (requesting API access), **steps
5–8** (everything on developer.apple.com, because an Individual enrolment never
shares the portal) and **steps 9–10** (agreements). If step 1 is approved after
he leaves, the key can still be generated without him.

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

## Part 1 — App Store Connect · 2 minutes

Sign in at **appstoreconnect.apple.com** as `ankurshori@gmail.com`.

**1. Turn on API access.** This is the only part of Part 1 that is his.

- **Users and Access** → **Integrations** — the page opens with App Store
  Connect API already selected
- **Request Access**
- Tick the checkbox to agree to the terms → **Submit**

> **Apple does not necessarily approve this on the spot.** Their own
> documentation says: *"Once submitted, your request is reviewed and approved on
> a case-by-case basis."* It is often quick, but it is not guaranteed to be, and
> planning around it being instant is how three days get lost.

**2. Generate the key — and this one does not need him.**

Generating a Team Key needs **Account Holder *or* Admin**, and Vansh is Admin. So
if approval has not come through by the time he leaves, nothing is lost: the key
can be generated the moment it does.

If it *is* approved while he is still there, do it then and there:

- **Users and Access** → **Integrations** → **Team Keys**
- **Generate API Key** (the **+** appears instead once an active key exists)
- Name: `EAS Build` — for reference only, not part of the key
- Under **Access**: **Admin** ← not App Manager, not Developer
- **Generate**

**3. Download it.** Save as `EAS-Build-ASC.p8`.

**4. Copy two more values from that page.**

- **Key ID** — 10 characters, in the table row next to the key
- **Issuer ID** — a long UUID above the table, not in it

The Issuer ID is the one people miss, precisely because it is not in the table
with everything else.

---

## Part 2 — developer.apple.com · 5 minutes

Sign in at **developer.apple.com/account**.

**5. Send the Team ID.** Membership details → the **Team ID** is 10 characters,
letters and numbers, like `A1B2C3D4E5`.

Not `1627036688`. That is Apple's internal numeric id, and using it produces a
signing failure that names nothing in particular.

While there: **note the membership expiry date.** If it lapses mid-launch
everything stops, and that is worth knowing in advance rather than discovering.

**6. Register the app identifier.** **Certificates, Identifiers & Profiles** →
**Identifiers** in the left sidebar → the **add button (+)** at the **top left**

- Select **App IDs** → **Continue**
- **App ID type**: **App** → **Continue**
- **Description**: `SubOrganizer`
- Select **Explicit App ID**, and in **Bundle ID** enter `com.suborganizer.app`
- Under **Capabilities**, tick **Sign in with Apple**
- **Continue** → review the details → **Register**

The API key from step 2 could do this on its own, but it takes ninety seconds by
hand and removes any chance of being stuck for three days on a step that turned
out not to work.

**7. Register the development identifier too.** Same again, one value different:

- **Description**: `SubOrganizer Dev`
- **Explicit App ID** → **Bundle ID**: `com.suborganizer.app.dev`
- **Capabilities**: tick **Sign in with Apple**

This is the variant that installs alongside the store build. Cheap now,
another three-day wait later.

**8. Create the Sign in with Apple key.** **Certificates, Identifiers & Profiles**
→ **Keys** in the left sidebar → the **add button (+)** at the top left

- **Key Name**: `SubOrganizer Sign in with Apple`
- Tick **Sign in with Apple**, then click **Configure** next to that checkbox
- **Primary App ID**: SubOrganizer (`com.suborganizer.app`) ← needs step 6 done
- **Save** → **Continue** → **Register**
- **Download** — save as `SignInWithApple.p8`
- Copy its **Key ID** as well

Apple's own warning on that screen: *"Save this file in a secure place because
the key is not saved in your developer account and you won't be able to download
it again. If the Download button is disabled, you previously downloaded the
key."*

**Probably not needed, requested anyway.** Native Apple sign-in on iOS wants only
the bundle identifier in Supabase's *Authorized Client IDs*; this key is for the
web OAuth flow. It costs him a minute now and removes the risk of finding out
otherwise while he is unreachable.

---

## Part 3 — Agreements · 2 minutes

App Store Connect → **Business** at the top → the **Agreements** tab.

**Only the Account Holder can sign agreements.** No role can be granted to cover
this, so anything left unsigned waits for him to come back.

**9. Check the Free Apps agreement is active.** Usually nothing to do — it is
granted automatically on joining the Apple Developer Program and covers free
apps. But if a **new version** is pending acceptance, accept it: a stale
agreement blocks submission, and it fails right at the end, after the build and
the upload, with a message about the account rather than the app.

**10. Sign the Paid Apps agreement while he is here.** This one is *not*
automatic and needs banking and tax details that only he has.

Nothing is for sale in the iOS build today — Play Billing is Android-only, so
this changes nothing about the first release. It is on the list because the
moment the ₹10 and ₹199 unlocks come to iOS, this becomes a blocker that needs
the Account Holder, his bank details and his PAN. Doing it now costs him five
minutes. Doing it later costs whatever the wait for him is.

If he would rather not, that is a reasonable call — just know it is a hard stop
on iOS purchases until it is signed.

---

## Part 4 — Not Apple

**11. A domain.** Google rejected the OAuth branding verification because
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
