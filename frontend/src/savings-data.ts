/**
 * Reference data for the savings audit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE EDITING
 *
 * Every claim the app makes about someone's money is computed from this file.
 * A wrong entry here does not produce a wrong pixel — it tells a real person to
 * cancel a service they still need, or that they are wasting money they are not.
 * That is the most damaging thing this app can do, so:
 *
 *   1. Every entry carries `verifiedOn`. Nothing is shown to a user from an
 *      entry older than STALE_AFTER_DAYS — the audit silently drops it instead.
 *      Indian plan pricing and bundle line-ups change constantly.
 *   2. Every entry carries `source`. If you cannot cite where a price came from,
 *      it does not go in.
 *   3. Bundles are never asserted, only offered as something to check. We cannot
 *      see someone's telecom plan, and "your plan includes this" said wrongly
 *      costs them the service.
 *
 * The tables below are deliberately small and seeded from the merchant list the
 * Gmail classifier already recognises. Breadth is worth less than being right.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Beyond this, an entry is treated as unknown rather than trusted. */
export const STALE_AFTER_DAYS = 120;

// ------------------------------------------------------------- plan prices --

export type PlanPrice = {
  /** Matches Subscription.domain, so the Gmail scan and manual rows both hit. */
  domain: string;
  /** Display name, for when the user's own row is named something else. */
  name: string;
  /** Cheapest monthly price of the tier, in `currency`. */
  monthly: number;
  /** Cheapest yearly price of the same tier. */
  yearly: number;
  currency: 'INR' | 'USD';
  /** Which tier these two prices describe — they must be the same tier. */
  tier: string;
  /** ISO date. See STALE_AFTER_DAYS. */
  verifiedOn: string;
  source: string;
};

/**
 * Services that sell the same tier both monthly and yearly, where the yearly
 * option is cheaper over twelve months.
 *
 * Only include a pair when both prices are for the *same tier*. Comparing a
 * monthly Premium against a yearly Basic invents a saving that does not exist
 * and quietly downgrades the user.
 *
 * Deliberately absent: Netflix India, which sells no annual plan at all (Mobile
 * ₹149, Basic ₹199, Standard ₹499, Premium ₹649, monthly only). An entry with
 * `yearly` set to twelve monthly payments would produce a saving of zero at
 * best, and a negative one if the figure ever drifted.
 */
export const PLAN_PRICES: PlanPrice[] = [
  {
    domain: 'spotify.com',
    name: 'Spotify',
    monthly: 139,
    yearly: 799,
    currency: 'INR',
    tier: 'Premium Standard',
    verifiedOn: '2026-07-30',
    // Read off the live pricing page. Note this contradicts most third-party
    // articles, which still quote the pre-May-2026 ₹1,189 annual figure — the
    // reason entries here come from the merchant rather than from coverage.
    source: 'https://www.spotify.com/in-en/premium/',
  },
  {
    domain: 'youtube.com',
    name: 'YouTube Premium',
    monthly: 149,
    yearly: 1490,
    currency: 'INR',
    tier: 'Individual',
    verifiedOn: '2026-07-30',
    source: 'https://www.croma.com/unboxed/youtube-premium-plans-prices-increased-in-india',
  },

  // JioHotstar sells three tiers on one domain, which is why planPriceFor()
  // matches on what the user actually pays rather than taking the first hit.
  // Prices effective 28 January 2026.
  {
    domain: 'hotstar.com',
    name: 'JioHotstar',
    monthly: 79,
    yearly: 499,
    currency: 'INR',
    tier: 'Mobile',
    verifiedOn: '2026-07-30',
    source: 'https://www.business-standard.com/companies/news/jiohotstar-premium-plan-price-hike-january-2026-subscription-details-126011900746_1.html',
  },
  {
    domain: 'hotstar.com',
    name: 'JioHotstar',
    monthly: 149,
    yearly: 1099,
    currency: 'INR',
    tier: 'Super',
    verifiedOn: '2026-07-30',
    source: 'https://www.business-standard.com/companies/news/jiohotstar-premium-plan-price-hike-january-2026-subscription-details-126011900746_1.html',
  },
  {
    domain: 'hotstar.com',
    name: 'JioHotstar',
    monthly: 299,
    yearly: 2199,
    currency: 'INR',
    tier: 'Premium',
    verifiedOn: '2026-07-30',
    source: 'https://variety.com/2026/tv/news/indian-streaming-giant-jiohotstar-raises-prices-monthly-plans-1236634622/',
  },
];

// ----------------------------------------------------------------- bundles --

export type BundleProvider = 'telecom' | 'card' | 'retail';

export type Bundle = {
  id: string;
  /** "Airtel", "HDFC Bank", "Jio" — what the user would recognise. */
  provider: string;
  kind: BundleProvider;
  /** Which plan or card, in the user's words. */
  plan: string;
  /** Domains this plan includes at no extra cost. */
  includes: string[];
  /** Shown verbatim, so the user can check it against their own plan. */
  note: string;
  verifiedOn: string;
  source: string;
};

/**
 * Plans and cards that already include a subscription the user may be paying
 * for separately. This is the highest-value check in the audit and the one most
 * specific to India — telecom and card bundles here are unusually generous, and
 * almost nobody audits them against what they already pay for.
 *
 * Presented as a question ("is this you?"), never as a fact. We cannot see
 * anyone's plan.
 *
 * Sparse on purpose. Telecom bundle pages are region-gated and rendered by
 * script, so the plan-by-plan detail cannot be read reliably, and the coverage
 * that does exist blurs mobile postpaid with converged broadband. Only entries
 * naming a specific price point, a specific service and a specific tier are
 * here; a vague "premium plans include Netflix" is worse than nothing, because
 * it sends someone to cancel on a maybe.
 */
export const BUNDLES: Bundle[] = [
  {
    id: 'airtel-postpaid-jiohotstar',
    provider: 'Airtel',
    kind: 'telecom',
    plan: 'postpaid ₹549 and above',
    includes: ['hotstar.com'],
    // The tier matters and is stated plainly: someone paying for Super or
    // Premium is not fully covered by this, and telling them they are would
    // cost them the tier they chose.
    note:
      'Airtel postpaid plans from ₹549 upward include a one-year JioHotstar ' +
      'Mobile subscription (₹449 plans get three months). Mobile tier only — ' +
      'if you pay for Super or Premium, the bundle does not cover that.',
    verifiedOn: '2026-07-30',
    source: 'https://telecomtalk.info/airtel-bundles-jiohotstar-subscription-on-postpaid-plans/991903/',
  },
];

// ---------------------------------------------------------------- overlaps --

/**
 * Categories where paying for two at once is usually redundant, with the
 * wording used to explain why.
 *
 * Not a claim that either is unnecessary — some people genuinely want both. The
 * audit surfaces it, states the annual cost of the cheaper one, and leaves the
 * decision alone.
 */
export const OVERLAP_CATEGORIES: Record<string, string> = {
  Entertainment: 'two video services',
  Music: 'two music services',
  Storage: 'two cloud storage plans',
  News: 'two news subscriptions',
};

// ------------------------------------------------------------------ lookup --

function isFresh(verifiedOn: string, today: Date): boolean {
  const then = Date.parse(verifiedOn);
  if (Number.isNaN(then)) return false;
  return (today.getTime() - then) / 86_400_000 <= STALE_AFTER_DAYS;
}

/**
 * The verified pricing for a domain, or undefined.
 *
 * `paidMonthly` picks between tiers. Several services sell three tiers on one
 * domain at very different prices — JioHotstar runs ₹79, ₹149 and ₹299 — and
 * returning whichever happened to be listed first would quote a Mobile-tier
 * saving to someone on Premium. Matching on what they actually pay is the only
 * signal available as to which tier they are on.
 */
export function planPriceFor(
  domain: string | null | undefined,
  paidMonthly?: number,
  today: Date = new Date(),
): PlanPrice | undefined {
  if (!domain) return undefined;
  const d = domain.toLowerCase();

  const candidates = PLAN_PRICES.filter(
    (p) => (p.domain === d || d.endsWith(`.${p.domain}`)) && isFresh(p.verifiedOn, today),
  );
  if (candidates.length <= 1) return candidates[0];
  if (paidMonthly === undefined) return undefined; // ambiguous — say nothing

  return candidates.reduce((best, p) =>
    Math.abs(p.monthly - paidMonthly) < Math.abs(best.monthly - paidMonthly) ? p : best,
  );
}

/** Every verified bundle that includes this domain. */
export function bundlesIncluding(
  domain: string | null | undefined,
  today: Date = new Date(),
): Bundle[] {
  if (!domain) return [];
  const d = domain.toLowerCase();
  return BUNDLES.filter(
    (b) =>
      isFresh(b.verifiedOn, today) &&
      b.includes.some((inc) => inc === d || d.endsWith(`.${inc}`)),
  );
}
