import { describe, expect, it } from 'vitest';
import {
  classify,
  extractMoney,
  isBankingNoise,
  isIgnoredSender,
  parseSender,
  registrableDomain,
} from './classify';

describe('isBankingNoise — credit-card bills must not become subscriptions', () => {
  // A card bill arrives monthly, states an amount and says "payment received".
  // On those signals alone it is indistinguishable from a subscription charge,
  // which is exactly how it used to get imported as one.
  const BANK_MAIL = [
    'Your HDFC Bank Credit Card Statement for Jul 2026 | Total Amount Due Rs 24,509.00',
    'Payment received towards your Credit Card ending 4417. Thank you.',
    'SBI Card e-Statement | Minimum Amount Due Rs 1,250 | Due date 12 Aug',
    'Your ICICI Bank Credit Card bill is ready. Outstanding balance Rs 8,340.',
    'Axis Bank: Rs 5,000 credited towards your card. Available limit Rs 1,45,000.',
    'Your EMI of Rs 3,499 has been debited for your loan account',
    'Bill payment successful - Rs 12,000 paid to OneCard',
    'NEFT transfer of Rs 20,000 was successful',
    'Statement of account for July 2026',
    'You have earned 450 reward points this month',
    'Unbilled transactions on your card as of 28 Jul',
    'Personal loan EMI reminder - Rs 8,200 due',
  ];

  it.each(BANK_MAIL)('filters: %s', (text) => {
    expect(isBankingNoise(text)).toBe(true);
  });
});

describe('isBankingNoise — real subscriptions must survive', () => {
  const SUBSCRIPTION_MAIL = [
    'Your Netflix subscription payment was received - Rs 649',
    'Receipt for your Spotify Premium subscription',
    // Netflix says "card ending in" too, so that phrase must never disqualify.
    'We charged your card ending in 4242 - Figma Professional Rs 1,200',
    'Payment received - thanks for your Adobe Creative Cloud payment',
    'Your YouTube Premium membership has been renewed',
    'Invoice #4821 from Vercel - $20.00',
    'Your monthly payment to Kurzgesagt',
    'Welcome to Notion - your subscription is active',
    'Your plan renews on 3 Aug for Rs 499',
    'Your Amazon Prime membership fee of Rs 1,499 was charged',
    'Thanks for your payment - Claude Pro $20',
    'Your subscription has been cancelled - sorry to see you go',
    // "payment received for your ..." is how half of all receipts open, so only
    // the distinctly banking "towards" phrasing may match.
    'Payment received for your Pro plan - Rs 999',
    'Payment received for your annual subscription',
  ];

  it.each(SUBSCRIPTION_MAIL)('keeps: %s', (text) => {
    expect(isBankingNoise(text)).toBe(false);
  });
});

describe('classify', () => {
  it('reads a cancellation as a cancellation, not a charge', () => {
    // Cancellation mail routinely contains "subscription" and a final amount.
    expect(classify('Your subscription has been cancelled', 'Final charge Rs 649')?.kind)
      .toBe('cancel');
  });

  it('does not treat retention wording as a cancellation', () => {
    expect(classify('Cancel anytime — no commitment', '')?.kind).not.toBe('cancel');
  });

  it('separates an upcoming renewal from money already spent', () => {
    expect(classify('Your plan renews on 3 August', '')?.kind).toBe('renewal_notice');
  });

  it('reads a failed payment as failed, not as a charge', () => {
    expect(classify('Your payment failed', 'Please update your card')?.kind)
      .toBe('payment_failed');
  });

  it('needs billing context before treating a welcome mail as a signup', () => {
    // Newsletter welcomes outnumber real signups many to one.
    expect(classify('Welcome to our newsletter', 'Weekly stories')).toBeNull();
    expect(classify('Welcome to Notion', 'Your subscription is now active')?.kind).toBe('start');
  });

  it('returns null for unrelated mail', () => {
    expect(classify('Your parcel is out for delivery', '')).toBeNull();
  });
});

describe('extractMoney', () => {
  it('reads rupees in several notations', () => {
    expect(extractMoney('Total ₹649')).toEqual({ amount: 649, currency: 'INR' });
    expect(extractMoney('Rs. 1,499 charged')).toEqual({ amount: 1499, currency: 'INR' });
    expect(extractMoney('INR 99 paid')).toEqual({ amount: 99, currency: 'INR' });
  });

  it('reads dollars', () => {
    expect(extractMoney('You paid $20.00')).toEqual({ amount: 20, currency: 'USD' });
    expect(extractMoney('54.99 USD')).toEqual({ amount: 54.99, currency: 'USD' });
  });

  it('takes the largest figure, which is the total on a receipt', () => {
    expect(extractMoney('Item ₹550, tax ₹99, total ₹649')?.amount).toBe(649);
  });

  it('ignores a discount figure sitting next to the real price', () => {
    expect(extractMoney('₹100 off — you paid ₹649')?.amount).toBe(649);
    expect(extractMoney('Save ₹200 today')).toBeUndefined();
  });

  it('does not capture currencies the app cannot convert', () => {
    // Narrowed to INR and USD; a euro figure must surface without a price
    // rather than be stored under a currency the totals cannot handle.
    expect(extractMoney('Total €19.99')).toBeUndefined();
    expect(extractMoney('¥1200 charged')).toBeUndefined();
  });

  it('returns undefined when there is no money at all', () => {
    expect(extractMoney('Your subscription is active')).toBeUndefined();
    expect(extractMoney('')).toBeUndefined();
  });
});

describe('registrableDomain', () => {
  it('collapses bulk-mail subdomains onto the brand', () => {
    expect(registrableDomain('email.netflix.com')).toBe('netflix.com');
    expect(registrableDomain('billing.stripe.com')).toBe('stripe.com');
  });

  it('keeps three labels for two-part TLDs', () => {
    expect(registrableDomain('mail.amazon.co.in')).toBe('amazon.co.in');
  });

  it('passes short hosts through', () => {
    expect(registrableDomain('cult.fit')).toBe('cult.fit');
    expect(registrableDomain('')).toBe('');
  });
});

describe('parseSender', () => {
  it('pulls the address out of an angle-bracketed From header', () => {
    const s = parseSender('Netflix <info@mailer.netflix.com>');
    expect(s.email).toBe('info@mailer.netflix.com');
    expect(s.domain).toBe('netflix.com');
    expect(s.displayName).toBe('Netflix');
  });

  it('handles a bare address', () => {
    expect(parseSender('receipts@spotify.com').domain).toBe('spotify.com');
  });
});

describe('isIgnoredSender', () => {
  it('drops banks outright', () => {
    expect(isIgnoredSender(parseSender('alerts@hdfcbank.com'), false)).toBe(true);
    expect(isIgnoredSender(parseSender('noreply@sbicard.com'), false)).toBe(true);
  });

  it('drops personal mail providers — a forwarded receipt is not your subscription', () => {
    expect(isIgnoredSender(parseSender('friend@gmail.com'), false)).toBe(true);
  });

  it('lets a catalog merchant through even when the domain is on the list', () => {
    // Uber and Swiggy sit on both lists: they do sell memberships, and the
    // catalog's `requires` gate is what separates those from ride receipts.
    expect(isIgnoredSender(parseSender('no-reply@uber.com'), true)).toBe(false);
  });

  it('keeps an unknown merchant', () => {
    expect(isIgnoredSender(parseSender('billing@somesaas.io'), false)).toBe(false);
  });
});
