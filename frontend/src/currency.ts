// Currency utilities — India-first, per-sub currency, INR primary aggregation.
export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AED', 'CAD', 'AUD', 'SGD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const CURRENCY_SYMBOL: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥',
  AED: 'د.إ', CAD: 'C$', AUD: 'A$', SGD: 'S$',
};

// Fixed rates (approx Feb 2026). Value is "1 X in INR".
export const RATES_INR: Record<string, number> = {
  INR: 1, USD: 83, EUR: 90, GBP: 105, JPY: 0.56, AED: 22.6, CAD: 61, AUD: 55, SGD: 62,
};

export function symbolFor(cur?: string): string {
  const c = (cur || 'INR').toUpperCase();
  return CURRENCY_SYMBOL[c] || c + ' ';
}

/** Format a money amount in the given currency with locale-appropriate grouping. */
export function fmtMoney(amount: number, cur?: string, opts: { compact?: boolean } = {}): string {
  const c = (cur || 'INR').toUpperCase();
  const sym = symbolFor(c);
  const zeroDec = c === 'INR' || c === 'JPY';
  const digits = zeroDec ? 0 : 2;
  const rounded = Number(amount.toFixed(digits));
  if (opts.compact && Math.abs(rounded) >= 100000) {
    // 1L, 2.3L, 1.2Cr etc for INR; else fall back to normal
    if (c === 'INR') {
      if (rounded >= 10000000) return `${sym}${(rounded / 10000000).toFixed(1)}Cr`;
      if (rounded >= 100000) return `${sym}${(rounded / 100000).toFixed(1)}L`;
    } else if (rounded >= 1000) {
      return `${sym}${(rounded / 1000).toFixed(1)}k`;
    }
  }
  // grouping
  const locale = c === 'INR' ? 'en-IN' : 'en-US';
  const grouped = rounded.toLocaleString(locale, {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
  return `${sym}${grouped}`;
}

export function convertToPrimary(amount: number, fromCur: string | undefined, primaryCur: string): number {
  const fromRate = RATES_INR[(fromCur || 'INR').toUpperCase()] ?? 1;
  const toRate = RATES_INR[primaryCur.toUpperCase()] ?? 1;
  const inr = amount * fromRate;
  return inr / toRate;
}

export function monthlyEquivalent(amount: number, cycle: string): number {
  if (cycle === 'yearly') return amount / 12;
  if (cycle === 'weekly') return amount * 4.33;
  return amount;
}
