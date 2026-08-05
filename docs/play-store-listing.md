# Play Store listing — copy and paste

Everything Play Console asks for, written out. Copy each block straight in.

---

## App name (30 characters max)

```
SubOrganizer
```

Alternative if you want keywords in the name (26 chars):

```
SubOrganizer: Subscriptions
```

## Short description (80 characters max)

```
Track every subscription, see what you really spend, never miss a renewal.
```

*74 characters.* This is the line people see under your icon in search results,
so it does most of the selling.

## Full description (4000 characters max)

```
Subscriptions are easy to start and easy to forget. SubOrganizer puts every recurring payment in one place, so you always know what you pay for — and what you can stop paying for.

WHAT YOU GET

See your real monthly cost
Add any subscription with its amount and billing cycle. SubOrganizer converts weekly and yearly plans into a true monthly figure, so the total on your dashboard is the number that actually leaves your account.

Never get charged by surprise
Set a reminder for each subscription and get a notification a few days before the money goes out. Decide to keep it or cancel while you still have time.

Know where the money goes
A clear breakdown by category — entertainment, music, productivity, storage, fitness and more — shows which part of your life is quietly costing the most.

Plan around renewals
A calendar view lays out what is due in the next 7 and 30 days, so a heavy month never catches you out.

Rupees and dollars, one honest total
Built India-first with full rupee support, and dollar-priced subscriptions are converted at the live exchange rate. Track a $20 tool alongside a ₹499 one and still see a single number that reflects what actually leaves your account.

Pause instead of delete
Put a subscription on hold without losing its history, and bring it back when you resubscribe.

FIND THE ONES YOU FORGOT

Most people underestimate their subscriptions because the forgotten ones never come to mind. SubOrganizer can scan your Gmail receipts to find them for you.

It reads billing emails on your device and works out what you are actually subscribed to — including which ones you already cancelled and which ones started again. You review everything before a single item is added.

Access is read-only. Your emails are never uploaded and never stored. Only the subscription details you approve are saved, and you can disconnect at any time.

Gmail scanning is completely optional. The app works fully without it.

PRIVACY

No ads. No trackers. Nothing sold, ever.

Your data is protected at the database level, so nobody else can read it. Reminders are scheduled on your own device — we cannot see when one fires.

Full privacy policy: https://suborganizer.com/privacy.html
```

*Roughly 2,100 characters — well inside the limit, and short enough that people
actually read it.*

---

## Categorisation

| Field | Answer |
|---|---|
| App or Game | **App** |
| Category | **Finance** |
| Tags | Budgeting, Expense tracker, Personal finance |
| Free or Paid | **Free** |
| Contains ads | **No** |
| In-app purchases | **No** |

## Content rating questionnaire

Answer **No** to everything — violence, sexuality, language, controlled
substances, gambling, user interaction, sharing location, personal info sharing.

Category: **Utility, Productivity, Communication or Other**.

Expected result: **Rated for 3+ / Everyone**.

## Target audience

- Age group: **18 and over** (it is a money app)
- Appeals to children: **No**

## Data safety form

| Question | Answer |
|---|---|
| Does your app collect or share user data? | **Yes** |
| Is data encrypted in transit? | **Yes** |
| Can users request data deletion? | **Yes** |

Data types to declare:

| Type | Purpose | Required? | Shared? |
|---|---|---|---|
| Email address | Account management | Required | No |
| Name | Account management | Required | No |
| App activity (your subscription entries) | App functionality | Required | No |

**Only if you ship Gmail scanning in this version**, add:

| Type | Purpose | Required? | Shared? |
|---|---|---|---|
| Emails | App functionality | **Optional** | No |

and note that email content is processed on-device and never stored.

Do **not** tick: location, contacts, photos, financial account details, health,
messages other than the Gmail case above, or anything under advertising.

## Privacy policy URL

```
https://suborganizer.com/privacy.html
```

## Graphics checklist

| Asset | Size | Status |
|---|---|---|
| App icon | 512 × 512 PNG | Export from `frontend/assets/images/icon.png` |
| Feature graphic | 1024 × 500 PNG | Needed — banner across the top of your listing |
| Phone screenshots | 2–8, min 320px | Generated into `store-assets/` |

---

## A note on the release track

Upload to **Internal testing** first and install it on a real phone from the
Play link. A production release cannot be replaced — only superseded by a new
version — so it is worth catching a crash in a track nobody else can see.
