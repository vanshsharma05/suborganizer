# App Store listing — copy and paste

Everything App Store Connect asks for, written out. Apple's fields are not the
same as Play's — shorter, and two of them do not exist on Play at all — so this
is a rewrite rather than a copy of `play-store-listing.md`.

Nothing here needs the API key. All of it can be pasted the moment the app
record exists.

---

## App Name (30 characters max)

```
SubOrganizer
```

## Subtitle (30 characters max)

```
Every subscription, one view
```

*28 characters.* Deliberately the same line as the app's own opening screen, so
the store page and the first thing they see agree.

## Promotional Text (170 characters max)

Changeable at any time **without a review**, which makes it the right place for
anything seasonal. Everything else needs a new version.

```
New: a monthly check-in that asks which subscriptions you actually use, then shows what the unused ones are costing you a year.
```

*125 characters.*

## Keywords (100 characters max)

Comma-separated, **no spaces after the commas** — a space costs a character and
Apple counts every one. Do not repeat words already in the name or subtitle;
Apple indexes those anyway, so repeating them wastes the budget.

```
subscription,tracker,budget,expenses,recurring,bills,renewal,reminder,spending,money,savings,upi
```

*95 characters.* No brand names — Apple rejects keywords using other companies'
trademarks, which rules out the obvious "netflix", "spotify" and so on.

## Description (4000 characters max)

```
Subscriptions are easy to start and easy to forget. SubOrganizer puts every recurring payment in one place, so you always know what you pay for - and what you can stop paying for.

SEE YOUR REAL MONTHLY COST

Add any subscription with its amount and billing cycle. Weekly and yearly plans are converted into a true monthly figure, so the total on your dashboard is the number that actually leaves your account.

Dollar-priced subscriptions are converted at the live exchange rate and shown alongside rupee ones, so a $20 tool and a Rs 499 one still add up to a single honest total.

NEVER GET CHARGED BY SURPRISE

Set a reminder for each subscription and get a notification days before the money goes out - while there is still time to decide.

Free trials are tracked separately, so the one that quietly converts next week is the one you hear about.

FIND THE ONES YOU FORGOT

Most people underestimate their subscriptions, because the forgotten ones never come to mind.

SubOrganizer can scan your Gmail receipts to find them. The scan runs entirely on your phone: your email is read on the device, the receipts are recognised there, and only the subscription itself is saved. The contents of your email are never uploaded, never stored, and never seen by anyone.

The scan is completely optional. The app works fully without it.

THE MONTHLY CHECK-IN

Once a month, SubOrganizer asks a question nothing else can answer: which of these are you actually using?

One card at a time, two buttons, under a minute. Anything you say you are not using turns into a finding with a number attached - what cancelling it would save you over a year.

KNOW WHERE THE MONEY GOES

A breakdown by category shows which part of your life is quietly costing the most. A calendar lays out what is due over the next 7 and 30 days, so a heavy month never catches you out.

Every subscription shows what it has already cost you since you added it - not a projection, but money that has already gone.

WHEN YOU DECIDE TO STOP

SubOrganizer includes step-by-step cancellation instructions for dozens of services, including the ones most apps ignore: Hotstar, Swiggy, Zomato, cult.fit, Blinkit and more.

Pause instead of deleting, and keep the history for when you resubscribe.

PRIVACY

Your data is yours. Sign in with Apple, Google, or an email address. Delete your account and everything in it from inside the app, at any time, with no email to send and nobody to ask.

FREE TO USE

SubOrganizer is free. The Gmail scan and the savings audit are one-time unlocks - never a subscription. It would be a strange app to charge you every month for.
```

## What's New (4000 characters max, first version)

```
First release.

- Every subscription in one place, with a true monthly total
- Reminders before each charge, and separate tracking for free trials
- Optional Gmail scan that runs entirely on your phone
- A monthly check-in that finds what you are paying for but not using
- Cancellation instructions for dozens of services
- Sign in with Apple
```

---

## Fields that are not text

| Field | Value |
|---|---|
| **Primary category** | Finance |
| **Secondary category** | Productivity |
| **Age rating** | 4+ |
| **Price** | Free |
| **Support URL** | `https://vanshsharma05.github.io/suborganizer/` |
| **Marketing URL** | leave blank |
| **Privacy Policy URL** | `https://vanshsharma05.github.io/suborganizer/privacy.html` |
| **Copyright** | `2026 SubOrganizer` |
| **Contact email** | `taskteamprosupport@gmail.com` |

---

## App Privacy — the nutrition labels

Apple asks per data type: is it **collected**, is it **linked to the user**, and
is it used for **tracking**. Getting these wrong is a rejection, and getting them
wrong in the generous direction is worse than useless — it makes the app look
like it takes more than it does.

**Tracking: NO, for everything.** There is no advertising SDK, no analytics SDK,
and no data shared with a data broker. Nothing in this app follows anyone
anywhere.

### Declare as collected

| Data | Linked to user | Purpose | Why |
|---|---|---|---|
| **Email Address** | Yes | App Functionality | The account itself |
| **Name** | Yes | App Functionality | The greeting, and nothing else |
| **Purchase History** | Yes | App Functionality | Which one-time unlocks are owned |
| **Other Usage Data** | Yes | App Functionality | The subscriptions the user enters — names, amounts, renewal dates |

### Declare as NOT collected

**Emails or Text Messages.** This is the one worth being precise about, because
the app does ask for Gmail access and a reviewer will notice.

The scan reads messages from Google's API **onto the device**, recognises the
receipts **on the device** (`src/gmail/classify.ts`), and saves only the
resulting subscription. Message bodies are never sent to our server, never
stored, and are discarded as soon as the scan finishes. Under Apple's
definition that is not collection.

**Also not collected:** Contacts, Location, Health, Financial Info (no card or
bank details ever touch the app — purchases go through Apple), Identifiers,
Diagnostics, Photos, Audio, Browsing History, Search History, Sensitive Info.

---

## App Review notes

Paste this into **App Review Information → Notes**. Reviewers do not sign up, and
they will not find the check-in on a fresh account without being told.

```
DEMO ACCOUNT
A test account is provided below. It has sample subscriptions already added, so every screen has data.

GMAIL SCAN — OPTIONAL, AND NOT NEEDED TO REVIEW THE APP
The app offers an optional scan of the user's Gmail to find subscription receipts. It is not required for any other feature and can be skipped entirely.

If you do test it: the scan requests read-only Gmail access, downloads messages to the device, identifies receipts on-device, and saves only the resulting subscription record. No message content is transmitted to our servers or stored anywhere.

ACCOUNT DELETION (Guideline 5.1.1(v))
Account → Delete account. It removes the account and all associated data immediately. No email, no support request, no waiting period.

SIGN IN WITH APPLE (Guideline 4.8)
Offered alongside Google and email, and shown first on the sign-in screen.

THE MONTHLY CHECK-IN
Once a month the app asks which subscriptions the user still uses. On the demo account it appears as a card on the Home screen. If it is not showing, it has already been answered this cycle.

PURCHASES
The app is free. Nothing is for sale in this build.
```

### Demo account

Fill in from the working test account before submitting:

```
Username: taskteamprosupport+store@gmail.com
Password: (the store test password)
```

---

## Screenshots

**Required: 6.7" (1290 x 2796).** Apple scales this down for smaller iPhones, so
one set is enough now that `supportsTablet` is off — no iPad sizes needed.

Up to 10, and the **first three** are what people actually see without swiping.
Suggested order, matching the strongest parts of the app:

1. Home — the monthly total, with real subscriptions
2. The monthly check-in card, mid-question
3. Savings — a finding with a rupee figure attached
4. Calendar — a month with several renewals
5. Subscriptions list
6. A subscription showing what it has already cost

**These need a real iPhone.** There is no simulator on Windows, so this is
blocked until a device is available. See `ios-launch.md`.
