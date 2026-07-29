/**
 * Reads a mailbox and works out what the user is actually subscribed to.
 *
 * The pipeline is four passes:
 *   1. search   — Gmail query for anything billing-shaped
 *   2. classify — each email becomes one typed event (start / charge / cancel …)
 *   3. group    — events are bucketed by merchant
 *   4. resolve  — the events for a merchant are replayed in date order
 *
 * Step 4 is the whole point. A single email cannot tell you whether someone
 * still pays for Netflix; the *sequence* can. Replaying it means a cancellation
 * followed by a fresh signup reads as active again, which is exactly how people
 * actually use subscriptions — quit in April, come back in September.
 */

import { advanceRenewal, Subscription } from '../api';
import { getGmailAccessToken } from './auth';
import { fetchBodies, fetchHeaders, GmailHeaders, searchMessageIds } from './client';
import {
  classify,
  Cycle,
  cycleFromGaps,
  cycleFromText,
  CYCLE_DAYS,
  EventKind,
  extractMoney,
  guessCategory,
  isAggregator,
  isBankingNoise,
  isIgnoredSender,
  isPaymentProcessor,
  lookupMerchant,
  merchantFromSubject,
  Money,
  parseSender,
  prettyName,
} from './classify';

// --------------------------------------------------------------- tuning --

/**
 * A charge that lands within a week of a cancellation is the final settlement,
 * not a resubscription. Without this every cancelled service would flip back to
 * active on its own closing invoice.
 */
const RESTART_GRACE_DAYS = 7;

/** Beyond two missed cycles the subscription is treated as probably dead. */
const DORMANT_CYCLES = 2;
const DORMANT_GRACE_DAYS = 20;

/** Wording that states outright that a charge repeats. */
const RECURRING_WORDS =
  /\b(?:subscription|membership|auto[\s-]?renew|renews?|renewal|recurring|monthly|yearly|annual|per\s+month|per\s+year|\/\s*(?:mo|yr)\b)/i;

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- types --

export type ScanDepth = 'quick' | 'deep';

export type ScanEvent = {
  messageId: string;
  kind: EventKind;
  /** Which rule fired, so the UI can justify the verdict. */
  label: string;
  date: number;
  subject: string;
  senderEmail: string;
  money?: Money;
  /** The mail said outright that the charge repeats (subject or snippet). */
  recurring: boolean;
};

export type Candidate = {
  key: string;
  name: string;
  domain?: string;
  category: string;
  amount?: number;
  currency: string;
  billing_cycle: Cycle;
  next_renewal: string;

  /** Where the timeline replay landed. */
  status: 'active' | 'cancelled';
  /** True when a start or charge came in after a cancellation. */
  resubscribed: boolean;
  /** No charge for two-plus cycles — still "active" but probably not really. */
  dormant: boolean;
  lastPaymentFailed: boolean;
  priceChanged: boolean;

  cancelledAt?: number;
  restartedAt?: number;
  lastChargeAt?: number;

  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  events: ScanEvent[];

  /** Set when this merchant is already in the user's subscription list. */
  existingId?: string;
  existingStatus?: Subscription['status'];
  /** How the mailbox disagrees with what the app currently stores. */
  drift?: 'cancelled-in-gmail' | 'active-again' | 'amount-changed';
};

export type ScanProgress = {
  stage: 'searching' | 'reading' | 'details' | 'resolving';
  done: number;
  total: number;
};

export type ScanResult = {
  candidates: Candidate[];
  messagesScanned: number;
  eventsFound: number;
  scannedAt: number;
};

export type ScanOptions = {
  depth?: ScanDepth;
  existing?: Subscription[];
  onProgress?: (p: ScanProgress) => void;
  signal?: { cancelled: boolean };
};

const DEPTHS: Record<ScanDepth, { window: string; max: number; bodies: number }> = {
  // 15 months, not 12: a yearly plan billed once a year needs a window longer
  // than the cycle for two charges to fall inside it, which is what lets the
  // gap measurement conclude "yearly" instead of guessing.
  quick: { window: 'newer_than:15m', max: 300, bodies: 30 },
  deep: { window: 'newer_than:3y', max: 800, bodies: 80 },
};

/**
 * Recall matters more than precision here — a subscription missed at this step
 * can never be found later, while noise still has to survive classification.
 *
 * But the message cap is a real budget: terms like "welcome to" and "plan"
 * match every newsletter ever sent and were crowding genuine billing mail out
 * of the results, so they are deliberately absent.
 */
function buildQuery(window: string): string {
  const terms = [
    'subscription', 'subscriptions', 'membership', 'member',
    'receipt', 'invoice', 'billing', 'billed', 'charged',
    'renewal', 'renewed', 'renews', '"auto-renew"', '"auto renewal"',
    '"free trial"', '"trial ends"',
    '"payment received"', '"payment successful"', '"payment failed"',
    '"monthly payment"', '"yearly payment"', '"annual payment"',
    '"payment to"', '"thanks for your payment"',
    'cancelled', 'canceled', '"sorry to see you go"',
  ];
  return `${window} -in:spam -in:trash {${terms.join(' ')}}`;
}

// ----------------------------------------------------------------- scan --

export async function scanGmail(options: ScanOptions = {}): Promise<ScanResult> {
  const { depth = 'quick', existing = [], onProgress, signal } = options;
  const plan = DEPTHS[depth];

  const token = await getGmailAccessToken();
  if (!token) throw new Error('Gmail is not connected');

  const abortIfCancelled = () => {
    if (signal?.cancelled) throw new ScanCancelled();
  };

  // 1. search
  onProgress?.({ stage: 'searching', done: 0, total: plan.max });
  const ids = await searchMessageIds(token, buildQuery(plan.window), plan.max, (found) => {
    onProgress?.({ stage: 'searching', done: found, total: plan.max });
  });
  abortIfCancelled();

  // 2. headers
  onProgress?.({ stage: 'reading', done: 0, total: ids.length });
  const messages = await fetchHeaders(token, ids, (done) => {
    onProgress?.({ stage: 'reading', done, total: ids.length });
  });
  abortIfCancelled();

  // 3. classify
  const groups = new Map<string, GroupDraft>();
  for (const msg of messages) collectEvent(msg, groups);

  // 4. fill in missing amounts from message bodies
  const needBody = pickMessagesNeedingBody(groups, plan.bodies);
  if (needBody.length) {
    onProgress?.({ stage: 'details', done: 0, total: needBody.length });
    const bodies = await fetchBodies(token, needBody, (done) => {
      onProgress?.({ stage: 'details', done, total: needBody.length });
    });
    applyBodyAmounts(groups, bodies);
  }
  abortIfCancelled();

  // 5. resolve
  onProgress?.({ stage: 'resolving', done: 0, total: groups.size });
  const candidates: Candidate[] = [];
  let resolved = 0;
  for (const group of groups.values()) {
    const candidate = resolveGroup(group);
    if (candidate) candidates.push(candidate);
    onProgress?.({ stage: 'resolving', done: ++resolved, total: groups.size });
  }

  matchAgainstExisting(candidates, existing);

  candidates.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 } as const;
    if (rank[a.confidence] !== rank[b.confidence]) return rank[a.confidence] - rank[b.confidence];
    return (b.lastChargeAt ?? 0) - (a.lastChargeAt ?? 0);
  });

  return {
    candidates,
    messagesScanned: messages.length,
    eventsFound: candidates.reduce((n, c) => n + c.events.length, 0),
    scannedAt: Date.now(),
  };
}

export class ScanCancelled extends Error {
  constructor() {
    super('Scan cancelled');
    this.name = 'ScanCancelled';
  }
}

// -------------------------------------------------------------- grouping --

export type GroupDraft = {
  key: string;
  name: string;
  domain?: string;
  category?: string;
  knownMerchant: boolean;
  events: ScanEvent[];
};

function collectEvent(msg: GmailHeaders, groups: Map<string, GroupDraft>): void {
  const sender = parseSender(msg.from);
  if (!sender.domain) return;

  const merchant = lookupMerchant(sender);
  if (isIgnoredSender(sender, Boolean(merchant))) return;

  const haystack = `${msg.subject} ${msg.snippet}`;

  // A credit-card bill recurs monthly, states an amount and says "payment
  // received", so it reads as a subscription charge on wording alone. Known
  // subscription brands are exempt — this only filters unrecognised senders.
  if (!merchant && isBankingNoise(haystack)) return;

  // Noisy senders only count when the mail is about the thing they bill for.
  if (merchant?.requires && !merchant.requires.test(haystack)) return;

  const verdict = classify(msg.subject, msg.snippet);
  if (!verdict) return;

  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  let key: string;
  let name: string;
  let domain: string | undefined;
  // True when the catalog's brand name should win over what we parsed. It must
  // not for aggregators: the catalog says "YouTube", but the subscription is to
  // a particular channel.
  let preferCatalogName = true;

  if (isPaymentProcessor(sender)) {
    // A processor's own domain is meaningless as a merchant, so use the name it
    // printed in the subject; if there is none, the event is unattributable.
    const billed = merchantFromSubject(msg.subject);
    if (!billed) return;
    key = `name:${slug(billed)}`;
    name = billed;
    preferCatalogName = false;
  } else if (isAggregator(sender) && merchantFromSubject(msg.subject)) {
    // One candidate per channel or creator rather than everything collapsed
    // into a single "YouTube" row.
    const product = merchantFromSubject(msg.subject)!;
    key = `${sender.domain}:${slug(product)}`;
    name = product;
    domain = sender.domain;
    preferCatalogName = false;
  } else {
    key = `domain:${sender.domain}`;
    name = merchant?.name ?? prettyName(sender);
    domain = sender.domain;
  }

  const group = groups.get(key) ?? {
    key,
    name,
    domain,
    category: merchant?.category,
    knownMerchant: Boolean(merchant),
    events: [],
  };

  // A catalog name beats one scraped from a display name.
  if (merchant) {
    if (preferCatalogName) group.name = merchant.name;
    group.category ??= merchant.category;
    group.knownMerchant = true;
  }
  group.domain ??= domain;

  group.events.push({
    messageId: msg.id,
    kind: verdict.kind,
    label: verdict.label,
    date: msg.internalDate || Date.now(),
    subject: msg.subject,
    senderEmail: sender.email,
    money: extractMoney(msg.subject) ?? extractMoney(msg.snippet),
    // Judged on the snippet too, not just the subject: "Your receipt" says
    // nothing, while the body under it says "monthly plan".
    recurring: RECURRING_WORDS.test(haystack),
  });

  groups.set(key, group);
}

/**
 * Bodies are fetched only where they can change the outcome: a merchant with a
 * charge but no price yet. Everything else would be bandwidth spent to learn
 * nothing.
 */
function pickMessagesNeedingBody(groups: Map<string, GroupDraft>, limit: number): string[] {
  const wanted: { id: string; date: number }[] = [];

  for (const group of groups.values()) {
    if (group.events.some((e) => e.money)) continue;

    const payments = group.events
      .filter((e) => e.kind === 'charge' || e.kind === 'start')
      .sort((a, b) => b.date - a.date);

    // The two most recent are enough to price the plan.
    for (const e of payments.slice(0, 2)) wanted.push({ id: e.messageId, date: e.date });
  }

  return wanted
    .sort((a, b) => b.date - a.date)
    .slice(0, limit)
    .map((w) => w.id);
}

function applyBodyAmounts(groups: Map<string, GroupDraft>, bodies: Map<string, string>): void {
  for (const group of groups.values()) {
    for (const event of group.events) {
      if (event.money) continue;
      const body = bodies.get(event.messageId);
      if (body) event.money = extractMoney(body);
    }
  }
}

// -------------------------------------------------------------- resolving --

/**
 * Replay one merchant's events oldest-first and let the last decisive one win.
 *
 * cancel            -> cancelled
 * start after that  -> active again (they came back)
 * charge after that -> active again, unless it is the closing invoice
 *
 * Exported because this is the one function whose behaviour a user will argue
 * with, so it needs to be callable on its own with a handful of fake events.
 */
export function resolveGroup(group: GroupDraft): Candidate | null {
  const events = [...group.events].sort((a, b) => a.date - b.date);

  // A lone renewal notice or price-change email is chatter, not proof of a
  // subscription — something must have started or been paid for.
  const chargeEvents = events.filter((e) => e.kind === 'charge');
  const startEvents = events.filter((e) => e.kind === 'start');
  if (!chargeEvents.length && !startEvents.length) return null;

  const text = events.map((e) => e.subject).join(' ');

  // Unknown senders must say somewhere that the charge repeats. A receipt from
  // a shop nobody recognises is far more likely a one-off purchase, and those
  // false positives are what make a scan feel like it invents things. Repeat
  // charges alone are not enough — ordering twice from the same shop looks
  // identical to monthly billing. Catalog brands skip this: a Netflix receipt
  // means what it says.
  if (!group.knownMerchant && !events.some((e) => e.recurring)) return null;

  let status: 'active' | 'cancelled' = 'active';
  let cancelledAt: number | undefined;
  let restartedAt: number | undefined;
  let lastChargeAt: number | undefined;
  let lastPaymentFailed = false;
  const chargeDates: number[] = [];

  for (const event of events) {
    switch (event.kind) {
      case 'cancel':
        status = 'cancelled';
        cancelledAt = event.date;
        lastPaymentFailed = false;
        break;

      case 'start':
        if (status === 'cancelled') restartedAt = event.date;
        status = 'active';
        lastPaymentFailed = false;
        break;

      case 'charge': {
        // Money moving after a cancellation means the cancellation did not
        // stick, or they resubscribed — but only once the settlement window
        // for the final invoice has passed.
        const settled =
          cancelledAt !== undefined && event.date - cancelledAt > RESTART_GRACE_DAYS * DAY_MS;
        if (status === 'cancelled' && settled) {
          restartedAt = event.date;
          status = 'active';
        }
        if (status === 'active') {
          lastChargeAt = event.date;
          chargeDates.push(event.date);
        }
        lastPaymentFailed = false;
        break;
      }

      case 'payment_failed':
        lastPaymentFailed = true;
        break;

      default:
        break; // notices and price changes never flip the status
    }
  }

  const reasons: string[] = [];

  // ---- billing cycle: measured gaps beat any wording in the email ----
  const measured = cycleFromGaps(chargeDates);
  const worded = cycleFromText(events.map((e) => `${e.subject} ${e.label}`).join(' '));
  const billing_cycle: Cycle = measured?.cycle ?? worded ?? 'monthly';

  if (measured) {
    reasons.push(
      measured.note ?? `${chargeDates.length} charges ${CYCLE_ADVERB[billing_cycle]} apart`,
    );
  } else if (worded) {
    reasons.push(`Billing described as ${worded}`);
  } else {
    reasons.push('Assumed monthly — only one charge seen');
  }

  // ---- price: the most recent charge is the price they pay now ----
  const priced = [...events]
    .filter((e) => e.money && (e.kind === 'charge' || e.kind === 'start'))
    .sort((a, b) => b.date - a.date);
  const latestMoney = priced[0]?.money ?? [...events].reverse().find((e) => e.money)?.money;

  const priceChanged = priced.length > 1 && priced.some((e) => e.money!.amount !== latestMoney?.amount);
  if (priceChanged) reasons.push('Amount changed between charges');
  if (!latestMoney) reasons.push('No amount found in these emails');

  // ---- dormancy ----
  const referenceDate = lastChargeAt ?? restartedAt ?? events[events.length - 1].date;
  const overdueBy = (Date.now() - referenceDate) / DAY_MS;
  const dormant =
    status === 'active' &&
    overdueBy > CYCLE_DAYS[billing_cycle] * DORMANT_CYCLES + DORMANT_GRACE_DAYS;
  if (dormant) reasons.push(`No charge in ${Math.round(overdueBy)} days`);

  if (restartedAt) reasons.push('Cancelled earlier, then started again');
  if (status === 'cancelled') reasons.push('Latest email is a cancellation');
  if (lastPaymentFailed) reasons.push('Most recent payment failed');

  // ---- confidence ----
  const chargeCount = chargeDates.length;
  const confidence: Candidate['confidence'] =
    group.knownMerchant && chargeCount >= 2 && latestMoney
      ? 'high'
      : (group.knownMerchant && latestMoney) || (chargeCount >= 2 && latestMoney)
        ? 'medium'
        : 'low';

  return {
    key: group.key,
    name: group.name,
    domain: group.domain,
    category: group.category ?? guessCategory(`${group.name} ${text}`),
    amount: latestMoney?.amount,
    currency: latestMoney?.currency ?? 'INR',
    billing_cycle,
    next_renewal: projectNextRenewal(referenceDate, billing_cycle),
    status,
    resubscribed: restartedAt !== undefined,
    dormant,
    lastPaymentFailed,
    priceChanged,
    cancelledAt: status === 'cancelled' ? cancelledAt : undefined,
    restartedAt,
    lastChargeAt,
    confidence,
    reasons,
    events: events.reverse(), // newest first reads better in the UI
  };
}

const CYCLE_ADVERB: Record<Cycle, string> = {
  weekly: 'a week',
  monthly: 'a month',
  yearly: 'a year',
};

/** Step the last known payment forward by whole cycles until it is in the future. */
function projectNextRenewal(fromMs: number, cycle: Cycle): string {
  let iso = new Date(fromMs).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  // ISO dates compare correctly as strings; the guard stops a runaway loop on a
  // nonsense timestamp.
  for (let i = 0; iso < today && i < 500; i++) iso = advanceRenewal(iso, cycle);
  return iso;
}

// --------------------------------------------------------------- matching --

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Links each candidate to a subscription the user already tracks, and records
 * where the two disagree — the mailbox is the more recent source of truth, so a
 * cancellation it found is worth surfacing against an "active" row.
 */
function matchAgainstExisting(candidates: Candidate[], existing: Subscription[]): void {
  if (!existing.length) return;

  const byDomain = new Map<string, Subscription>();
  const byName = new Map<string, Subscription>();
  for (const sub of existing) {
    if (sub.domain) byDomain.set(sub.domain.toLowerCase(), sub);
    byName.set(normalizeName(sub.name), sub);
  }

  for (const candidate of candidates) {
    const name = normalizeName(candidate.name);
    const match =
      (candidate.domain ? byDomain.get(candidate.domain) : undefined) ??
      byName.get(name) ??
      existing.find((s) => {
        const other = normalizeName(s.name);
        return other.length > 3 && name.length > 3 && (other.startsWith(name) || name.startsWith(other));
      });

    if (!match) continue;

    candidate.existingId = match.id;
    candidate.existingStatus = match.status;

    if (candidate.status === 'cancelled' && match.status !== 'cancelled') {
      candidate.drift = 'cancelled-in-gmail';
    } else if (candidate.status === 'active' && match.status === 'cancelled') {
      candidate.drift = 'active-again';
    } else if (
      candidate.amount !== undefined &&
      Math.abs(candidate.amount - match.amount) > Math.max(1, match.amount * 0.02)
    ) {
      candidate.drift = 'amount-changed';
    }
  }
}
