/**
 * How the money actually left — read off the receipt.
 *
 * A subscription tracker that knows the amount and the date but not the card is
 * missing the thing people ask first when a charge surprises them: *which* card
 * was that on? It is also the difference between "cancel this" being advice and
 * being actionable — you cannot stop a payment without knowing where it comes
 * from.
 *
 * Receipts say it, almost always, and in a handful of stable shapes:
 *
 *     Visa ending in 4242              a card, with the tail
 *     •••• 1234                        a card, no network named
 *     Paid via UPI                     an app, no card at all
 *     UPI Ref No 412345678901          same, with a reference
 *     Net Banking - HDFC               a bank transfer
 *     Billed to your Apple ID          Apple took it, not the merchant
 *
 * The last one matters more than it looks. A subscription bought through the App
 * Store or Play cannot be cancelled on the merchant's website at all — it is
 * cancelled in the store — and telling someone to go to adobe.com when Apple
 * holds the mandate wastes their afternoon.
 *
 * Everything here is pure text in, structured value out, so it can be tested
 * against real receipt wording without a network or a mailbox.
 */

/** What kind of instrument paid. */
export type PaymentKind =
  | 'card'
  | 'upi'
  | 'netbanking'
  | 'wallet'
  | 'appstore'
  | 'playstore'
  | 'paypal';

export type PaymentMethod = {
  kind: PaymentKind;
  /** Visa, Mastercard, RuPay, Amex, HDFC, Google Pay — when the mail names one. */
  brand?: string;
  /** The last four digits of a card, when shown. */
  last4?: string;
  /**
   * The mail said the charge repeats on its own — a mandate, autopay, or
   * standing instruction. Worth surfacing separately: a card on file and a
   * standing instruction against it are different things to cancel.
   */
  autopay: boolean;
};

/**
 * Wording that means "we could not charge you" or "please add a card", not
 * "here is how you paid".
 *
 * Checked before anything else. A failed-payment mail names a card in exactly
 * the same shape as a receipt does, and recording it as the payment method
 * would attach a dead card to a live subscription — precisely backwards.
 */
const NOT_A_PAYMENT =
  /\b(?:update\s+your\s+payment|add\s+a\s+(?:new\s+)?(?:card|payment)|payment\s+(?:failed|declined|unsuccessful)|card\s+(?:was\s+)?declined|could\s+not\s+(?:be\s+)?(?:process|charge)|expir(?:ed|ing)\s+card)\b/i;

/** Card networks, longest first so "american express" wins over "express". */
const NETWORKS: [RegExp, string][] = [
  [/\bamerican\s+express\b|\bamex\b/i, 'Amex'],
  [/\bmaster\s?card\b/i, 'Mastercard'],
  [/\brupay\b/i, 'RuPay'],
  [/\bdiners\s+club\b/i, 'Diners Club'],
  [/\bdiscover\b/i, 'Discover'],
  [/\bvisa\b/i, 'Visa'],
];

/** UPI apps worth naming. Generic "UPI" is the fallback. */
const UPI_APPS: [RegExp, string][] = [
  [/\bgoogle\s?pay\b|\bg\s?pay\b|\btez\b/i, 'Google Pay'],
  [/\bphonepe\b/i, 'PhonePe'],
  [/\bpaytm\s+upi\b/i, 'Paytm UPI'],
  [/\bbhim\b/i, 'BHIM'],
  [/\bamazon\s?pay\s+upi\b/i, 'Amazon Pay UPI'],
  [/\bcred\s+pay\b/i, 'CRED'],
];

const WALLETS: [RegExp, string][] = [
  [/\bpaytm\s+wallet\b/i, 'Paytm Wallet'],
  [/\bamazon\s?pay\s+balance\b|\bamazon\s?pay\s+wallet\b/i, 'Amazon Pay'],
  [/\bmobikwik\b/i, 'MobiKwik'],
  [/\bfreecharge\b/i, 'FreeCharge'],
];

/**
 * The last four digits of a card.
 *
 * Deliberately anchored to wording that means "the tail of a card" rather than
 * grabbing any four digits — a receipt is full of them: order numbers, years,
 * amounts, reference ids. The masked forms allow the several bullet characters
 * different senders use, and any run of them.
 */
const LAST4 = [
  /(?:ending|ends)\s*(?:in|with)?\s*[:\-]?\s*(\d{4})\b/i,
  /(?:x{2,}|\*{2,}|•{2,}|·{2,}|•{2,}|-{4,})\s*(\d{4})\b/,
  /\bcard\s+(?:no\.?|number)?\s*[:\-]?\s*(?:x|\*|•)*\s*(\d{4})\b/i,
];

function firstMatch(text: string, table: [RegExp, string][]): string | undefined {
  for (const [re, name] of table) if (re.test(text)) return name;
  return undefined;
}

function findLast4(text: string): string | undefined {
  for (const re of LAST4) {
    const m = re.exec(text);
    if (m) return m[1];
  }
  return undefined;
}

/** Whether the mail describes a standing arrangement rather than one payment. */
function isAutopay(text: string): boolean {
  return /\b(?:auto[\s-]?pay|autopay|auto[\s-]?renew(?:al|s|ed)?|e-?mandate|standing\s+instruction|recurring\s+(?:payment|mandate|billing)|subscription\s+will\s+(?:automatically\s+)?renew)\b/i.test(
    text,
  );
}

/**
 * The payment method a receipt describes, or null when it does not say.
 *
 * Null is the common case and an honest one. Plenty of receipts never mention
 * the instrument, and inventing "card" because most subscriptions are on cards
 * would put a guess somewhere the interface presents as fact.
 *
 * Order matters. The stores are checked first because an App Store receipt also
 * carries the card Apple has on file, and the useful answer there is "Apple",
 * not "Visa" — that is who holds the mandate and who can stop it.
 */
export function detectPaymentMethod(text: string): PaymentMethod | null {
  if (!text) return null;
  if (NOT_A_PAYMENT.test(text)) return null;

  const autopay = isAutopay(text);

  if (/\b(?:apple\s+id|app\s+store|itunes)\b/i.test(text) && /\bbill|charg|receipt|subscri/i.test(text)) {
    return { kind: 'appstore', brand: 'Apple', autopay };
  }
  if (/\bgoogle\s+play\b/i.test(text)) {
    return { kind: 'playstore', brand: 'Google Play', autopay };
  }
  if (/\bpaypal\b/i.test(text)) {
    return { kind: 'paypal', brand: 'PayPal', autopay };
  }

  const wallet = firstMatch(text, WALLETS);
  if (wallet) return { kind: 'wallet', brand: wallet, autopay };

  // UPI before card: a UPI receipt sometimes names the funding bank too, and
  // the instrument the user recognises is the UPI app.
  const upiApp = firstMatch(text, UPI_APPS);
  const saysUpi = /\bupi\b/i.test(text) || /\bvpa\b/i.test(text) || /@(?:ok\w+|upi|ybl|paytm|axl)\b/i.test(text);
  if (upiApp || saysUpi) {
    return { kind: 'upi', brand: upiApp, autopay };
  }

  if (/\bnet\s?banking\b|\binternet\s+banking\b/i.test(text)) {
    const bank = /\b(HDFC|ICICI|SBI|Axis|Kotak|Yes\s?Bank|IDFC|IndusInd|PNB|BOB)\b/i.exec(text);
    return { kind: 'netbanking', brand: bank ? bank[1].replace(/\s+/g, ' ') : undefined, autopay };
  }

  const network = firstMatch(text, NETWORKS);
  const last4 = findLast4(text);
  // A bare four digits proves nothing on its own; something has to say "card".
  const saysCard = /\b(?:credit\s+card|debit\s+card|\bcard\b)\b/i.test(text);
  if (network || (last4 && saysCard)) {
    return { kind: 'card', brand: network, last4, autopay };
  }

  return null;
}

/**
 * One short line for the interface.
 *
 * Written to be read in a list — "Visa ···· 4242", not "Payment method: Visa
 * credit card ending in 4242". The autopay flag is shown separately by the
 * caller rather than crammed in here, because it answers a different question.
 */
export function describePaymentMethod(pm: PaymentMethod | null | undefined): string | null {
  if (!pm) return null;

  switch (pm.kind) {
    case 'card':
      if (pm.brand && pm.last4) return `${pm.brand} ···· ${pm.last4}`;
      if (pm.last4) return `Card ···· ${pm.last4}`;
      return pm.brand ?? 'Card';
    case 'upi':
      return pm.brand ? `${pm.brand} (UPI)` : 'UPI';
    case 'netbanking':
      return pm.brand ? `${pm.brand} net banking` : 'Net banking';
    case 'wallet':
      return pm.brand ?? 'Wallet';
    case 'appstore':
      return 'Apple';
    case 'playstore':
      return 'Google Play';
    case 'paypal':
      return 'PayPal';
  }
}

/**
 * Whether this subscription can only be cancelled where it was bought.
 *
 * The App Store and Play hold the mandate themselves. Sending someone to the
 * merchant's cancellation page in that case is not merely unhelpful — they will
 * find no way to cancel there, conclude the app is wrong, and keep paying.
 */
export function cancelledAtStore(pm: PaymentMethod | null | undefined): boolean {
  return pm?.kind === 'appstore' || pm?.kind === 'playstore';
}

// ------------------------------------------------------------- persistence --

/**
 * Packed for the `payment_method` column: `kind|brand|last4|autopay`.
 *
 * A string rather than jsonb so the column can be added, read and filtered by
 * anything without a migration to a structured type, and so a row written by an
 * older client is still readable. Empty fields stay empty rather than being
 * omitted, which keeps the position of each part fixed.
 */
export function packPaymentMethod(pm: PaymentMethod | null | undefined): string | null {
  if (!pm) return null;
  return [pm.kind, pm.brand ?? '', pm.last4 ?? '', pm.autopay ? '1' : ''].join('|');
}

const KINDS: ReadonlySet<string> = new Set<PaymentKind>([
  'card', 'upi', 'netbanking', 'wallet', 'appstore', 'playstore', 'paypal',
]);

export function unpackPaymentMethod(packed: string | null | undefined): PaymentMethod | null {
  if (!packed) return null;
  const [kind, brand, last4, autopay] = packed.split('|');
  if (!KINDS.has(kind)) return null;
  return {
    kind: kind as PaymentKind,
    brand: brand || undefined,
    last4: last4 || undefined,
    autopay: autopay === '1',
  };
}
