/**
 * Turning one email into one subscription event.
 *
 * Everything here is deliberately regex-and-lookup rather than an LLM call:
 * the rules are auditable, they run offline, they cost nothing per scan, and
 * when a result looks wrong the user can be shown the exact email and phrase
 * that produced it. The trade-off is recall on oddly-worded mail, which the
 * review step in app/scan.tsx exists to catch.
 */

// ------------------------------------------------------------------ events --

export type EventKind =
  | 'start' // signed up / resubscribed / trial began
  | 'charge' // money actually left the account
  | 'cancel' // subscription ended or auto-renew switched off
  | 'renewal_notice' // heads-up about a *future* charge
  | 'payment_failed'
  | 'price_change';

type Rule = {
  kind: EventKind;
  label: string;
  re: RegExp;
  /**
   * An extra pattern that must also match somewhere in subject+snippet.
   *
   * Exists for phrases that are only meaningful in a billing context. "Welcome
   * to …" heads every newsletter ever sent; "Welcome to …" *plus* the word
   * subscription is a signup. Without this the scan invents a subscription for
   * every mailing list the user has ever joined.
   */
  needs?: RegExp;
};

/** Wording that marks a mail as being about a paid, recurring arrangement. */
const BILLING_CONTEXT =
  /\b(?:subscription|subscribed|membership|member|premium|plan|billing|billed|charged|payment|invoice|receipt|renew|trial|per\s+month|per\s+year|monthly|yearly|annual)\b/i;

/**
 * Order matters — the first match wins.
 *
 * Cancellations lead because a cancellation email routinely also contains
 * "subscription" and a final amount, and would otherwise be read as a charge.
 * Failed payments come next for the same reason: "payment" appears in both.
 */
const RULES: Rule[] = [
  // ------------------------------------------------------------- cancel --
  // Each pattern needs a confirming verb. A bare "cancel" also appears in
  // "cancel anytime" and "don't cancel!" retention mail, which must not count.
  { kind: 'cancel', label: 'cancellation confirmed', re: /\b(?:has|have)\s+been\s+cancell?ed\b/i },
  { kind: 'cancel', label: 'cancellation confirmed', re: /\b(?:was|were|is|are|now|successfully)\s+cancell?ed\b/i },
  { kind: 'cancel', label: 'you cancelled', re: /\byou(?:'ve|\s+have)?\s+cancell?ed\b/i },
  { kind: 'cancel', label: 'cancellation notice', re: /\bcancell?ation\s+(?:confirm|complete|receipt|notice|request)/i },
  { kind: 'cancel', label: 'subscription cancelled', re: /\b(?:subscription|membership|plan|order)\s+cancell?ed\b/i },
  { kind: 'cancel', label: 'auto-renew off', re: /\bauto[\s-]?renew(?:al)?\s+(?:is\s+|has\s+been\s+|was\s+)?(?:off|disabled|turned\s+off|cancell?ed|stopped)\b/i },
  { kind: 'cancel', label: 'will not renew', re: /\b(?:will\s+not|won'?t|no\s+longer)\s+(?:be\s+)?renew(?:ed|ing)?\b/i },
  { kind: 'cancel', label: 'subscription ended', re: /\b(?:subscription|membership|plan|access)\s+(?:has\s+)?(?:ended|expired|been\s+terminated)\b/i },
  { kind: 'cancel', label: 'sorry to see you go', re: /\bsorry\s+to\s+see\s+you\s+go\b/i },
  { kind: 'cancel', label: 'refund issued', re: /\b(?:refund(?:ed)?\s+(?:issued|processed|complete)|we\s+(?:have\s+)?refunded)\b/i },

  // ------------------------------------------------------ payment failed --
  { kind: 'payment_failed', label: 'payment failed', re: /\b(?:payment|charge|transaction|billing)\s+(?:has\s+)?(?:failed|declined|was\s+declined|unsuccessful)\b/i },
  { kind: 'payment_failed', label: 'payment problem', re: /\b(?:we\s+)?(?:could\s*n[o']t|unable\s+to|couldn'?t)\s+(?:process|charge|collect|bill)\b/i },
  { kind: 'payment_failed', label: 'card problem', re: /\b(?:update\s+your\s+payment|card\s+(?:was\s+)?declined|payment\s+method\s+(?:issue|problem|expired))\b/i },

  // -------------------------------------------------------- price change --
  { kind: 'price_change', label: 'price change', re: /\b(?:price|pricing|plan\s+cost|subscription\s+(?:price|fee))\s+(?:is\s+)?(?:chang|increas|updat|going\s+up)/i },

  // ------------------------------------------------------ renewal notice --
  // A heads-up, not a charge — must be checked before the charge rules so
  // "your plan renews on 3 Aug" is not read as money already spent.
  { kind: 'renewal_notice', label: 'upcoming renewal', re: /\b(?:will\s+(?:be\s+)?renew|renews?\s+on|is\s+(?:about\s+to|due\s+to)\s+renew|upcoming\s+(?:renewal|charge|payment|bill))\b/i },
  { kind: 'renewal_notice', label: 'trial ending', re: /\b(?:trial|free\s+period)\s+(?:is\s+)?(?:ending|ends|about\s+to\s+end|expires?)\b/i },
  { kind: 'renewal_notice', label: 'reminder', re: /\b(?:renewal\s+reminder|your\s+\w+\s+is\s+expiring)\b/i },

  // ---------------------------------------------------------------- start --
  { kind: 'start', label: 'subscription active', re: /\b(?:subscription|membership|plan)\s+(?:is\s+)?(?:now\s+)?(?:active|confirmed|started|begins?|has\s+begun|activated)\b/i },
  { kind: 'start', label: 'trial started', re: /\b(?:free\s+)?trial\s+(?:has\s+)?(?:started|begun|is\s+active)\b/i },
  { kind: 'start', label: "you're subscribed", re: /\byou(?:'re|\s+are)\s+(?:now\s+)?(?:subscribed|a\s+member|premium)\b/i },
  { kind: 'start', label: 'joined a membership', re: /\b(?:you\s+)?(?:joined|became\s+a\s+member\s+of|signed\s+up\s+for)\b/i, needs: BILLING_CONTEXT },
  { kind: 'start', label: 'thanks for subscribing', re: /\bthanks?\s+(?:you\s+)?for\s+(?:subscrib|becoming\s+a\s+member|joining)/i },
  // Newsletter welcomes outnumber real signups many to one, so this only counts
  // alongside billing wording.
  { kind: 'start', label: 'welcome email', re: /\bwelcome\s+to\b/i, needs: BILLING_CONTEXT },

  // --------------------------------------------------------------- charge --
  { kind: 'charge', label: 'membership payment', re: /\b(?:monthly|yearly|annual|recurring)\s+payment\s+(?:to|for)\b/i },
  { kind: 'charge', label: 'membership charged', re: /\b(?:membership|subscription)\s+(?:payment|fee|charge)\b/i },
  { kind: 'charge', label: 'payment received', re: /\bpayment\s+(?:received|successful|confirmation|confirmed|complete)\b/i },
  { kind: 'charge', label: 'you were charged', re: /\byou(?:r\s+\w+)?\s+(?:has\s+been|have\s+been|was|were)\s+(?:charged|billed|debited)\b/i },
  { kind: 'charge', label: 'renewed', re: /\b(?:has\s+been\s+)?(?:auto[\s-]?)?renewed\b/i },
  { kind: 'charge', label: 'billing statement', re: /\b(?:billing\s+statement|statement\s+is\s+ready|your\s+bill)\b/i },
  { kind: 'charge', label: 'thanks for your payment', re: /\bthanks?\s+(?:you\s+)?for\s+your\s+payment\b/i },
  { kind: 'charge', label: 'debited', re: /\b(?:debited|charged)\s+(?:from|to)\s+your\b/i },
  // Last: a receipt is just as likely to be a one-off purchase. It is still
  // recorded as a charge — deciding whether the merchant is a *subscription*
  // is resolveGroup()'s job, which has the whole timeline to judge from.
  // "order confirmation" is deliberately absent: for most senders it means a
  // parcel, and two parcels from one shop look exactly like recurring billing.
  { kind: 'charge', label: 'receipt', re: /\b(?:receipt|invoice)\b/i },
];

export type Classification = { kind: EventKind; label: string } | null;

/** First matching rule over subject, then snippet. Returns null for noise. */
export function classify(subject: string, snippet: string): Classification {
  const both = `${subject} ${snippet}`;

  for (const source of [subject, snippet]) {
    if (!source) continue;
    for (const rule of RULES) {
      if (!rule.re.test(source)) continue;
      if (rule.needs && !rule.needs.test(both)) continue;
      return { kind: rule.kind, label: rule.label };
    }
  }
  return null;
}

// ----------------------------------------------------------------- senders --

export type Sender = { email: string; host: string; domain: string; displayName: string };

/** Registrable-domain suffixes that need three labels, not two. */
const TWO_PART_TLDS = new Set([
  'co.in', 'co.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za', 'com.au', 'com.br',
  'com.sg', 'com.my', 'com.mx', 'net.in', 'org.in', 'ac.in', 'org.uk',
]);

/** Bulk-mail subdomains that hide the brand: email.netflix.com -> netflix.com. */
const NOISE_LABELS = /^(?:e|em|email|emails|mail|mailer|mailing|news|newsletter|no-?reply|noreply|notification|notifications|notify|reply|send|smtp|t|tm|track|info|billing|invoice|receipts?|account|accounts|members?|support|hello|team|update|updates|go|link|click|m|mg|mkt|marketing|cs|payments?)$/i;

export function parseSender(from: string): Sender {
  const angled = /<([^>]+)>/.exec(from);
  const email = (angled ? angled[1] : from).trim().toLowerCase();

  const displayName = from
    .replace(/<[^>]*>/, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim();

  const host = email.includes('@') ? email.split('@').pop()! : '';

  return { email, host, domain: registrableDomain(host), displayName };
}

export function registrableDomain(host: string): string {
  if (!host) return '';

  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');

  const lastTwo = labels.slice(-2).join('.');
  const keep = TWO_PART_TLDS.has(lastTwo) ? 3 : 2;

  // Strip mailer subdomains above the registrable part so bulk senders collapse
  // onto the brand they send for.
  let start = labels.length - keep;
  while (start > 0 && NOISE_LABELS.test(labels[start - 1])) start--;

  return labels.slice(Math.max(start, labels.length - keep)).join('.');
}

// ---------------------------------------------------------------- merchants --

export type Merchant = {
  domain: string;
  name: string;
  category: string;
  /**
   * For senders that mail about far more than subscriptions (Amazon, Google,
   * Apple). Without a match the message is dropped, so an Amazon parcel
   * receipt does not become a "subscription".
   */
  requires?: RegExp;
};

const M = (domain: string, name: string, category: string, requires?: RegExp): Merchant => ({
  domain,
  name,
  category,
  requires,
});

/** Known subscription senders. A miss is fine — unknown brands still surface. */
export const MERCHANTS: Merchant[] = [
  // Streaming / entertainment
  M('netflix.com', 'Netflix', 'Entertainment'),
  M('primevideo.com', 'Prime Video', 'Entertainment'),
  M('hotstar.com', 'JioHotstar', 'Entertainment'),
  M('jiocinema.com', 'JioCinema', 'Entertainment'),
  M('sonyliv.com', 'SonyLIV', 'Entertainment'),
  M('zee5.com', 'ZEE5', 'Entertainment'),
  M('disneyplus.com', 'Disney+', 'Entertainment'),
  M('hbomax.com', 'HBO Max', 'Entertainment'),
  M('crunchyroll.com', 'Crunchyroll', 'Entertainment'),
  M('twitch.tv', 'Twitch', 'Entertainment'),
  M('mubi.com', 'MUBI', 'Entertainment'),

  // Music / audio
  M('spotify.com', 'Spotify', 'Music'),
  M('apple.com', 'Apple', 'Entertainment', /\b(?:icloud|apple\s+(?:music|tv|one|arcade|fitness)|subscription|receipt|membership)\b/i),
  M('gaana.com', 'Gaana', 'Music'),
  M('wynk.in', 'Wynk Music', 'Music'),
  M('audible.com', 'Audible', 'Music'),
  M('audible.in', 'Audible', 'Music'),

  // Google family — one sender, many products
  M('google.com', 'Google', 'Productivity', /\b(?:google\s+one|youtube|workspace|google\s+play|drive\s+storage|nest\s+aware|subscription)\b/i),
  M('youtube.com', 'YouTube Premium', 'Entertainment'),

  // Productivity / software
  M('adobe.com', 'Adobe', 'Productivity'),
  M('microsoft.com', 'Microsoft 365', 'Productivity', /\b(?:microsoft\s+365|office|xbox|onedrive|subscription|receipt)\b/i),
  M('notion.so', 'Notion', 'Productivity'),
  M('figma.com', 'Figma', 'Productivity'),
  M('canva.com', 'Canva', 'Productivity'),
  M('slack.com', 'Slack', 'Productivity'),
  M('zoom.us', 'Zoom', 'Productivity'),
  M('github.com', 'GitHub', 'Productivity'),
  M('openai.com', 'OpenAI', 'Productivity'),
  M('anthropic.com', 'Claude', 'Productivity'),
  M('grammarly.com', 'Grammarly', 'Productivity'),
  M('1password.com', '1Password', 'Utilities'),
  M('linkedin.com', 'LinkedIn Premium', 'Productivity', /\b(?:premium|subscription|receipt|invoice|billing)\b/i),
  M('atlassian.com', 'Atlassian', 'Productivity'),

  // Storage / infra
  M('dropbox.com', 'Dropbox', 'Storage'),
  M('icloud.com', 'iCloud', 'Storage'),
  M('vercel.com', 'Vercel', 'Utilities'),
  M('netlify.com', 'Netlify', 'Utilities'),
  M('supabase.com', 'Supabase', 'Utilities'),
  M('digitalocean.com', 'DigitalOcean', 'Utilities'),
  M('amazonaws.com', 'AWS', 'Utilities'),
  M('godaddy.com', 'GoDaddy', 'Utilities'),
  M('namecheap.com', 'Namecheap', 'Utilities'),
  M('hostinger.com', 'Hostinger', 'Utilities'),

  // VPN / security
  M('nordvpn.com', 'NordVPN', 'Utilities'),
  M('expressvpn.com', 'ExpressVPN', 'Utilities'),

  // News / reading
  M('nytimes.com', 'NYTimes', 'News'),
  M('medium.com', 'Medium', 'News'),
  M('substack.com', 'Substack', 'News'),
  M('the-ken.com', 'The Ken', 'News'),
  M('livemint.com', 'Mint', 'News'),
  M('economist.com', 'The Economist', 'News'),

  // Education
  M('coursera.org', 'Coursera', 'Education'),
  M('udemy.com', 'Udemy', 'Education'),
  M('duolingo.com', 'Duolingo', 'Education'),
  M('skillshare.com', 'Skillshare', 'Education'),

  // Fitness / health
  M('cult.fit', 'cult.fit', 'Fitness'),
  M('strava.com', 'Strava', 'Fitness'),
  M('headspace.com', 'Headspace', 'Fitness'),
  M('calm.com', 'Calm', 'Fitness'),
  M('myfitnesspal.com', 'MyFitnessPal', 'Fitness'),

  // Shopping / delivery memberships
  M('amazon.in', 'Amazon Prime', 'Shopping', /\b(?:prime|membership|subscribe\s*&\s*save|audible|kindle\s+unlimited)\b/i),
  M('amazon.com', 'Amazon Prime', 'Shopping', /\b(?:prime|membership|subscribe\s*&\s*save|audible|kindle\s+unlimited)\b/i),
  M('swiggy.in', 'Swiggy One', 'Shopping', /\b(?:one|membership|subscription)\b/i),
  M('zomato.com', 'Zomato', 'Shopping', /\b(?:gold|district|membership|subscription)\b/i),
  M('blinkit.com', 'Blinkit', 'Shopping', /\b(?:membership|subscription)\b/i),
  M('uber.com', 'Uber One', 'Shopping', /\b(?:uber\s+one|membership|subscription)\b/i),

  // Gaming
  M('playstation.com', 'PlayStation Plus', 'Entertainment'),
  M('xbox.com', 'Xbox Game Pass', 'Entertainment'),
  M('steampowered.com', 'Steam', 'Entertainment', /\b(?:subscription|receipt|purchase)\b/i),

  // Creator memberships
  M('patreon.com', 'Patreon', 'Entertainment'),
  M('buymeacoffee.com', 'Buy Me a Coffee', 'Entertainment'),

  // Dating
  M('gotinder.com', 'Tinder', 'Other'),
  M('bumble.com', 'Bumble', 'Other'),
];

const BY_DOMAIN = new Map(MERCHANTS.map((m) => [m.domain, m]));

export function lookupMerchant(sender: Sender): Merchant | undefined {
  return BY_DOMAIN.get(sender.domain) ?? MERCHANTS.find((m) => sender.host.endsWith(m.domain));
}

/**
 * Senders that bill on someone else's behalf. Their own name is worthless as a
 * merchant, so the real one is dug out of the subject instead.
 */
const PROCESSOR_DOMAINS = new Set([
  'stripe.com', 'paypal.com', 'razorpay.com', 'paddle.com', 'paddle.net',
  'chargebee.com', 'recurly.com', 'fastspring.com', 'lemonsqueezy.com',
  'billing.stripe.com', 'squareup.com', 'instamojo.com', 'cashfree.com',
]);

export function isPaymentProcessor(sender: Sender): boolean {
  return PROCESSOR_DOMAINS.has(sender.domain);
}

const PROCESSOR_SUBJECT = [
  // "Your monthly payment to Kurzgesagt" — YouTube channel and Patreon
  // memberships, where the thing being paid for is never the sender.
  /(?:monthly|yearly|annual|recurring)\s+payment\s+(?:to|for)\s+([A-Za-z0-9][\w&.'\- ]{1,32}?)(?:\s*[-–—|]|\s+(?:for|on|is|has)\b|$)/i,
  /(?:membership|member)\s+(?:to|of|with)\s+([A-Za-z0-9][\w&.'\- ]{1,32}?)(?:\s*[-–—|]|\s+(?:for|on|is|has)\b|$)/i,
  /became\s+a\s+member\s+of\s+([A-Za-z0-9][\w&.'\- ]{1,32}?)(?:\s*[-–—|]|$)/i,
  /(?:receipt|invoice|payment|subscription|billing)\s+(?:from|to|for)\s+([A-Za-z][\w&.'\- ]{1,32}?)(?:\s+(?:for|on|is|has|–|-|—|\||#)|$)/i,
  /^([A-Za-z][\w&.'\- ]{1,32}?)\s*[-–—|]\s*(?:receipt|invoice|payment|subscription)/i,
  /your\s+([A-Za-z][\w&.'\- ]{1,32}?)\s+(?:subscription|membership|payment|receipt)/i,
];

const NOT_A_NAME = /^(?:your|the|a|an|new|this|our|my|us|it|google|play|apple|order|channel|premium|plan)$/i;

export function merchantFromSubject(subject: string): string | undefined {
  for (const re of PROCESSOR_SUBJECT) {
    const m = re.exec(subject);
    const name = m?.[1]?.trim().replace(/[.,!]+$/, '');
    if (name && name.length >= 2 && !NOT_A_NAME.test(name)) return name;
  }
  return undefined;
}

/**
 * Brands that bill for other people's products: one YouTube sender covers every
 * channel membership, one Patreon sender every creator. Unlike a payment
 * processor the brand name is still useful, so extraction is attempted first
 * and the brand is kept as a fallback.
 */
const AGGREGATOR_DOMAINS = new Set(['youtube.com', 'patreon.com', 'buymeacoffee.com', 'substack.com']);

export function isAggregator(sender: Sender): boolean {
  return AGGREGATOR_DOMAINS.has(sender.domain);
}

/**
 * Senders that are never a consumer subscription. Personal mail providers are
 * on the list because a receipt forwarded by a friend is not a subscription of
 * the user's, and banks because a card statement mentions every merchant at
 * once — which would invent one "subscription" per statement.
 */
const IGNORED_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
  'live.com', 'icloud.com', 'proton.me', 'protonmail.com', 'rediffmail.com',
  // Banks and card issuers. Not exhaustive by design — isBankingNoise() is what
  // catches the ones that will never make a list this long.
  'hdfcbank.com', 'hdfcbank.net', 'icicibank.com', 'axisbank.com', 'sbi.co.in',
  'sbicard.com', 'kotak.com', 'yesbank.in', 'idfcfirstbank.com', 'rblbank.com',
  'indusind.com', 'federalbank.co.in', 'bankofbaroda.in', 'pnbindia.in',
  'canarabank.com', 'unionbankofindia.co.in', 'aubank.in', 'bandhanbank.com',
  'idbibank.in', 'bankofindia.co.in', 'indianbank.in',
  'americanexpress.com', 'aexp.com', 'citibank.com', 'citi.com', 'sc.com',
  'hsbc.co.in', 'dbs.com', 'standardchartered.com',
  'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'capitalone.com',
  'discover.com', 'barclays.co.uk', 'revolut.com', 'monzo.com',
  // Card and payment apps
  'onecard.app', 'cred.club', 'jupiter.money', 'slicepay.in', 'uni.club',
  'fi.money', 'paytm.com', 'phonepe.com', 'mobikwik.com', 'freecharge.com',
  'billdesk.com', 'payu.in',
  'linkedin.com', 'naukri.com', 'indeed.com', 'glassdoor.com',
  'facebook.com', 'facebookmail.com', 'instagram.com', 'x.com', 'twitter.com',
  'quora.com', 'pinterest.com', 'reddit.com', 'whatsapp.com',
  'irctc.co.in', 'makemytrip.com', 'goibibo.com', 'booking.com', 'airbnb.com',
  'uber.com', 'olacabs.com', 'rapido.bike', 'zomato.com', 'swiggy.in',
];

/**
 * Banks and travel sites are dropped outright; Uber/Swiggy/Zomato/LinkedIn sit
 * on both lists because they do sell memberships — the catalog's `requires`
 * gate lets those specific mails through, and this only blocks the rest.
 */
export function isIgnoredSender(sender: Sender, hasCatalogEntry: boolean): boolean {
  if (hasCatalogEntry) return false;
  return IGNORED_DOMAINS.includes(sender.domain);
}

/**
 * Wording that marks a mail as bank or card business rather than a
 * subscription.
 *
 * A credit-card bill is the worst offender the scan meets: it arrives monthly,
 * carries an amount, and says "payment received" — indistinguishable from a
 * subscription charge on those signals alone. There are far too many issuers to
 * keep listing domains, so the giveaway has to be the wording.
 *
 * Every pattern here is something a subscription receipt would never say.
 * "Card ending in 4242" is deliberately absent — Netflix writes that too.
 */
const BANKING_NOISE: RegExp[] = [
  // The bill itself
  /\bcredit\s+card\s+(?:bill|statement|payment|account|dues?)\b/i,
  /\b(?:card|account)\s+statement\b/i,
  /\bstatement\s+of\s+account\b/i,
  /\b(?:total|minimum|min\.?)\s+amount\s+due\b/i,
  /\bunbilled\s+(?:amount|transactions?)\b/i,

  // Balances and limits — a subscription has neither
  /\b(?:credit|available)\s+limit\b/i,
  /\boutstanding\s+(?:amount|balance|dues?)\b/i,

  // Paying the bank rather than a merchant. Only "towards" counts — it is
  // banking phrasing almost to the exclusion of anything else, whereas
  // "payment received for your …" is how half of all receipts open.
  /\bpayment\s+(?:received|credited)\s+towards?\b/i,
  /\btowards?\s+your\s+(?:credit\s+)?card\b/i,
  /\bbill\s+payment\s+(?:successful|received|confirmation)\b/i,

  // Lending
  /\bEMI\b/,
  /\b(?:personal|home|car|auto|education|gold)\s+loan\b/i,
  /\bloan\s+(?:emi|instal?ment|repayment|account)\b/i,

  // Transfer rails and loyalty, written uppercase in bank mail
  /\b(?:NEFT|IMPS|RTGS|NACH)\b/,
  /\breward\s+points\b/i,
];

/**
 * True when the mail is bank or card business. Callers should exempt senders
 * that are in the merchant catalog: a known subscription brand saying something
 * unusual should not be thrown away on wording alone.
 */
export function isBankingNoise(text: string): boolean {
  return BANKING_NOISE.some((re) => re.test(text));
}

// ------------------------------------------------------------------ amounts --

const SYMBOL_TO_CODE: Record<string, string> = {
  '₹': 'INR', 'rs': 'INR', 'rs.': 'INR', 'inr': 'INR',
  '$': 'USD', 'us$': 'USD', 'usd': 'USD',
};

/**
 * INR and USD only — the two currencies the app supports.
 *
 * A euro or yen figure is skipped rather than captured, so an amount is never
 * stored under a currency the totals cannot convert. The candidate still
 * surfaces for review; it just arrives without a price.
 */
const AMOUNT_RE =
  /(₹|Rs\.?|INR|US\$|\$|USD)\s?(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s?(INR|USD)\b/gi;

/**
 * Discount wording has to be *adjacent* to the number to disqualify it, not
 * merely nearby: "₹100 off — you paid ₹649" contains both a saving and a real
 * price, and a loose window would throw the price away with the promo.
 */
const DISCOUNT_BEFORE =
  /\b(?:save|saved|savings?|discount(?:ed)?|coupon|cashback|credit|voucher|worth|up\s*to|upto|flat|extra|get|off)\s*$/i;
const DISCOUNT_AFTER = /^\s*(?:off\b|free\b|discount|cashback|credit\b)/i;

export type Money = { amount: number; currency: string };

/**
 * The price stated in a piece of text, or undefined.
 *
 * Where a receipt lists several figures — line item, tax, total — the total is
 * the largest, and the total is what left the account, so the largest surviving
 * candidate wins.
 */
export function extractMoney(text: string): Money | undefined {
  if (!text) return undefined;

  const found: Money[] = [];
  AMOUNT_RE.lastIndex = 0;

  for (let m = AMOUNT_RE.exec(text); m; m = AMOUNT_RE.exec(text)) {
    const rawSymbol = (m[1] ?? m[4] ?? '').toLowerCase();
    const rawValue = m[2] ?? m[3] ?? '';
    const value = Number(rawValue.replace(/,/g, ''));

    if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) continue;

    const before = text.slice(Math.max(0, m.index - 16), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 14);
    if (DISCOUNT_BEFORE.test(before) || DISCOUNT_AFTER.test(after)) continue;

    found.push({ amount: value, currency: SYMBOL_TO_CODE[rawSymbol] ?? 'INR' });
  }

  if (!found.length) return undefined;
  return found.reduce((best, cur) => (cur.amount > best.amount ? cur : best));
}

// ------------------------------------------------------------------- cycles --

export type Cycle = 'weekly' | 'monthly' | 'yearly';

const CYCLE_WORDS: { cycle: Cycle; re: RegExp }[] = [
  { cycle: 'yearly', re: /\b(?:year(?:ly)?|annual(?:ly)?|12\s*months?|per\s+year|\/\s*(?:yr|year|a)\b)/i },
  { cycle: 'weekly', re: /\b(?:week(?:ly)?|per\s+week|\/\s*(?:wk|week)\b)/i },
  { cycle: 'monthly', re: /\b(?:month(?:ly)?|per\s+month|\/\s*(?:mo|month)\b)/i },
];

export function cycleFromText(text: string): Cycle | undefined {
  return CYCLE_WORDS.find((c) => c.re.test(text))?.cycle;
}

/** Median gap between charges, mapped to the nearest supported cycle. */
export function cycleFromGaps(sortedDates: number[]): { cycle: Cycle; note?: string } | undefined {
  if (sortedDates.length < 2) return undefined;

  const gaps = sortedDates
    .slice(1)
    .map((d, i) => (d - sortedDates[i]) / 86_400_000)
    .filter((g) => g >= 3) // same-day duplicates of one receipt tell us nothing
    .sort((a, b) => a - b);

  if (!gaps.length) return undefined;
  const median = gaps[Math.floor(gaps.length / 2)];

  if (median <= 10) return { cycle: 'weekly' };
  if (median <= 45) return { cycle: 'monthly' };
  // The schema only stores weekly/monthly/yearly, so quarterly and half-yearly
  // are recorded as monthly with the real period kept in the notes.
  if (median <= 135) return { cycle: 'monthly', note: 'Charges look quarterly (~3 months)' };
  if (median <= 240) return { cycle: 'monthly', note: 'Charges look half-yearly (~6 months)' };
  return { cycle: 'yearly' };
}

export const CYCLE_DAYS: Record<Cycle, number> = { weekly: 7, monthly: 30, yearly: 365 };

// ---------------------------------------------------------------- category --

const CATEGORY_HINTS: { category: string; re: RegExp }[] = [
  { category: 'Entertainment', re: /\b(?:stream|movie|tv|video|film|show|cinema|play|game|gaming)\b/i },
  { category: 'Music', re: /\b(?:music|audio|podcast|song|listen)\b/i },
  { category: 'Productivity', re: /\b(?:workspace|productivity|design|team|pro\s+plan|business|cloud\s+app|ai)\b/i },
  { category: 'Storage', re: /\b(?:storage|drive|backup|cloud\s+storage|gb|tb)\b/i },
  { category: 'News', re: /\b(?:news|magazine|journal|daily|times|paper|read)\b/i },
  { category: 'Education', re: /\b(?:course|learn|class|tutor|academy|edu|training)\b/i },
  { category: 'Fitness', re: /\b(?:fitness|gym|workout|health|yoga|meditat|wellness)\b/i },
  { category: 'Shopping', re: /\b(?:prime|delivery|shopping|store|grocer|membership)\b/i },
  { category: 'Utilities', re: /\b(?:vpn|hosting|domain|server|security|password|internet|broadband)\b/i },
];

export function guessCategory(text: string): string {
  return CATEGORY_HINTS.find((c) => c.re.test(text))?.category ?? 'Other';
}

/** "billing.netflix.com" / "NETFLIX" -> "Netflix". */
export function prettyName(sender: Sender): string {
  const fromDisplay = sender.displayName
    .replace(/\b(?:no-?reply|noreply|do-?not-?reply|support|team|billing|account|info|help|notifications?|mailer)\b/gi, '')
    .replace(/[<>"']/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (fromDisplay.length >= 2 && fromDisplay.length <= 40 && !fromDisplay.includes('@')) {
    return titleCase(fromDisplay);
  }

  const base = sender.domain.split('.')[0] ?? sender.domain;
  return titleCase(base.replace(/[-_]/g, ' '));
}

function titleCase(s: string): string {
  // Leave anything already mixed-case alone — "YouTube", "cult.fit", "1Password"
  // are written the way the brand writes them.
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) return s;
  return s
    .toLowerCase()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}
