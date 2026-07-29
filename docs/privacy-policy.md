# Privacy Policy — SubOrganizer

**Last updated: 27 July 2026**

> **Draft.** Fill in the bracketed fields and have someone check it against your
> jurisdiction before publishing. It has to be reachable at a public URL — the
> Play Store listing requires one, and Google's OAuth verification for Gmail
> access will not proceed without it.

SubOrganizer ("the app", "we") helps you track recurring subscriptions. This
policy explains what we collect, why, and what we never do.

**Contact:** taskteamprosupport@gmail.com
**Published by:** SubOrganizer

---

## What we collect

**Account information.** When you create an account we store your email address
and display name. If you sign in with Google we receive your email address, name
and profile picture from Google.

**Subscription data.** The subscriptions you add — name, amount, currency,
billing cycle, renewal date, category and any notes. This is data you enter, or
that you explicitly approve after a Gmail scan.

**Gmail data (only if you connect Gmail).** See the section below.

We do **not** collect location, contacts, photos, device identifiers for
advertising, or browsing activity. The app contains no advertising and no
third-party analytics or tracking SDKs.

## How Gmail scanning works

Connecting Gmail is entirely optional. The app works fully without it.

If you connect it, SubOrganizer requests **read-only** access
(`gmail.readonly`) and uses it solely to identify subscriptions you pay for.

- Your emails are read **on your device**. They are not sent to our servers, and
  we operate no server that processes your mail.
- We **never store the contents of your emails.** Subject lines, message bodies
  and attachments are held in memory during a scan and discarded when it ends.
- Only the subscription details you **explicitly select and approve** — such as
  "Netflix, ₹649, monthly" — are saved to your account.
- We never send, delete, modify or organise your email. Access is read-only.
- You can disconnect at any time from the Scan Gmail screen, which revokes the
  token. You can also revoke it at
  <https://myaccount.google.com/permissions>.
- Signing out of SubOrganizer deletes the stored Gmail token from your device.

### Limited Use disclosure

SubOrganizer's use and transfer of information received from Google APIs adheres
to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. Specifically, we do not use Gmail data
for advertising, we do not sell it, we do not transfer it to third parties
except as required by law, and we do not allow humans to read it except with
your explicit consent, for security purposes, or where required by law.

## Where your data is stored

Account and subscription data is stored with **Supabase** (PostgreSQL), our
hosting and authentication provider. Access is enforced at the database level by
row-level security, so one account cannot read another's data.

Your session token and, if you connect it, your Gmail token are stored locally
on your device.

## Who we share it with

Nobody. We do not sell, rent or trade your data. We share it only with the
infrastructure providers needed to run the service — Supabase (database and
authentication) and Google (only if you choose to sign in with Google or connect
Gmail) — and only as required to operate the app, or where the law compels us.

## How long we keep it

Your data is kept while your account exists. Delete your account and the
associated data is removed. To request deletion, email taskteamprosupport@gmail.com.

## Your rights

You can access, correct, export or delete your data. Every subscription can be
edited or deleted in the app. For account deletion or a copy of your data,
contact us at taskteamprosupport@gmail.com.

## Notifications

Renewal reminders are scheduled **locally on your device**. We do not operate a
push server and cannot see when a reminder fires.

## Children

SubOrganizer is not directed at children under 13, and we do not knowingly
collect data from them.

## Changes

If this policy changes materially we will update the date above and notify you
in the app.

## Contact

Questions about this policy or your data: taskteamprosupport@gmail.com
