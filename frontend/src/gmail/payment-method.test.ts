import { describe, expect, it } from 'vitest';
import {
  cancelledAtStore, describePaymentMethod, detectPaymentMethod,
  packPaymentMethod, unpackPaymentMethod,
} from './payment-method';

describe('detectPaymentMethod — cards', () => {
  it('reads the network and the tail', () => {
    expect(detectPaymentMethod('Charged to your Visa ending in 4242')).toMatchObject({
      kind: 'card', brand: 'Visa', last4: '4242',
    });
  });

  it('copes with the masking characters senders actually use', () => {
    expect(detectPaymentMethod('Card •••• 1234')).toMatchObject({ kind: 'card', last4: '1234' });
    expect(detectPaymentMethod('Card XXXX5678')).toMatchObject({ kind: 'card', last4: '5678' });
    expect(detectPaymentMethod('your card ****9012')).toMatchObject({ kind: 'card', last4: '9012' });
  });

  it('recognises the networks, longest name first', () => {
    expect(detectPaymentMethod('American Express card')).toMatchObject({ brand: 'Amex' });
    expect(detectPaymentMethod('MasterCard ending 1111')).toMatchObject({ brand: 'Mastercard' });
    expect(detectPaymentMethod('Master Card ending 1111')).toMatchObject({ brand: 'Mastercard' });
    expect(detectPaymentMethod('paid with RuPay debit card')).toMatchObject({ brand: 'RuPay' });
  });

  /**
   * A receipt is full of four-digit numbers — order ids, years, amounts. Only
   * wording that means "the tail of a card" should produce one.
   */
  it('does not take any four digits for a card', () => {
    expect(detectPaymentMethod('Order 8842 confirmed for 2026')).toBeNull();
    expect(detectPaymentMethod('Invoice 1234 total Rs 499')).toBeNull();
  });

  it('needs something to say "card" when only a tail is present', () => {
    expect(detectPaymentMethod('ending in 4242')).toBeNull();
    expect(detectPaymentMethod('card ending in 4242')).toMatchObject({ kind: 'card' });
  });
});

describe('detectPaymentMethod — UPI', () => {
  it('recognises bare UPI', () => {
    expect(detectPaymentMethod('Paid via UPI')).toMatchObject({ kind: 'upi' });
    expect(detectPaymentMethod('UPI Ref No 412345678901')).toMatchObject({ kind: 'upi' });
  });

  it('names the app when the mail does', () => {
    expect(detectPaymentMethod('Paid using Google Pay')).toMatchObject({
      kind: 'upi', brand: 'Google Pay',
    });
    expect(detectPaymentMethod('PhonePe transaction successful')).toMatchObject({
      kind: 'upi', brand: 'PhonePe',
    });
  });

  it('spots a VPA handle', () => {
    expect(detectPaymentMethod('debited from vansh@okhdfcbank')).toMatchObject({ kind: 'upi' });
    expect(detectPaymentMethod('sent to merchant@ybl')).toMatchObject({ kind: 'upi' });
  });

  /**
   * A UPI receipt often names the funding bank too. The instrument the user
   * recognises is the app, not the bank behind it.
   */
  it('prefers UPI over a card mentioned in the same mail', () => {
    expect(detectPaymentMethod('Paid via UPI from your HDFC card ending 4242'))
      .toMatchObject({ kind: 'upi' });
  });
});

describe('detectPaymentMethod — everything else', () => {
  it('reads net banking, with the bank when named', () => {
    expect(detectPaymentMethod('Paid by Net Banking - HDFC')).toMatchObject({
      kind: 'netbanking', brand: 'HDFC',
    });
    expect(detectPaymentMethod('internet banking payment received')).toMatchObject({
      kind: 'netbanking',
    });
  });

  it('reads wallets', () => {
    expect(detectPaymentMethod('Paid from Paytm Wallet')).toMatchObject({
      kind: 'wallet', brand: 'Paytm Wallet',
    });
  });

  it('reads PayPal', () => {
    expect(detectPaymentMethod('You paid with PayPal')).toMatchObject({ kind: 'paypal' });
  });

  /**
   * The store holds the mandate, so the store is the answer — even though the
   * same receipt names the card Apple has on file. Reporting "Visa" would send
   * someone to their bank for something only Apple can stop.
   */
  it('puts the store ahead of the card it charged', () => {
    expect(detectPaymentMethod('Billed to your Apple ID · Visa ending 4242'))
      .toMatchObject({ kind: 'appstore', brand: 'Apple' });
    expect(detectPaymentMethod('Your Google Play subscription receipt'))
      .toMatchObject({ kind: 'playstore' });
  });

  it('is null when the mail simply does not say', () => {
    expect(detectPaymentMethod('Your Netflix subscription has renewed')).toBeNull();
    expect(detectPaymentMethod('')).toBeNull();
  });
});

/**
 * A failed-payment mail names a card in exactly the same shape as a receipt.
 * Recording it would attach a dead card to a live subscription.
 */
describe('detectPaymentMethod — not a payment', () => {
  it('ignores failures and requests to add a card', () => {
    expect(detectPaymentMethod('Your payment failed. Visa ending 4242')).toBeNull();
    expect(detectPaymentMethod('Please update your payment method')).toBeNull();
    expect(detectPaymentMethod('Your card was declined — card ending 1234')).toBeNull();
    expect(detectPaymentMethod('Add a new card to continue')).toBeNull();
    expect(detectPaymentMethod('Your expiring card ending 4242')).toBeNull();
  });
});

describe('autopay', () => {
  it('notices a standing arrangement', () => {
    expect(detectPaymentMethod('Auto-renewal charged to Visa ending 4242')).toMatchObject({
      autopay: true,
    });
    expect(detectPaymentMethod('E-mandate debited via UPI')).toMatchObject({ autopay: true });
    expect(detectPaymentMethod('standing instruction on card ending 1111')).toMatchObject({
      autopay: true,
    });
  });

  it('is false for a one-off charge', () => {
    expect(detectPaymentMethod('Paid with Visa ending 4242')).toMatchObject({ autopay: false });
  });
});

describe('describePaymentMethod', () => {
  it('writes a line short enough for a list', () => {
    expect(describePaymentMethod({ kind: 'card', brand: 'Visa', last4: '4242', autopay: false }))
      .toBe('Visa ···· 4242');
    expect(describePaymentMethod({ kind: 'card', last4: '4242', autopay: false }))
      .toBe('Card ···· 4242');
    expect(describePaymentMethod({ kind: 'card', brand: 'Amex', autopay: false })).toBe('Amex');
    expect(describePaymentMethod({ kind: 'card', autopay: false })).toBe('Card');
  });

  it('covers every kind', () => {
    expect(describePaymentMethod({ kind: 'upi', brand: 'Google Pay', autopay: false }))
      .toBe('Google Pay (UPI)');
    expect(describePaymentMethod({ kind: 'upi', autopay: false })).toBe('UPI');
    expect(describePaymentMethod({ kind: 'netbanking', brand: 'HDFC', autopay: false }))
      .toBe('HDFC net banking');
    expect(describePaymentMethod({ kind: 'netbanking', autopay: false })).toBe('Net banking');
    expect(describePaymentMethod({ kind: 'wallet', brand: 'Paytm Wallet', autopay: false }))
      .toBe('Paytm Wallet');
    expect(describePaymentMethod({ kind: 'appstore', autopay: false })).toBe('Apple');
    expect(describePaymentMethod({ kind: 'playstore', autopay: false })).toBe('Google Play');
    expect(describePaymentMethod({ kind: 'paypal', autopay: false })).toBe('PayPal');
  });

  it('says nothing when there is nothing to say', () => {
    expect(describePaymentMethod(null)).toBeNull();
    expect(describePaymentMethod(undefined)).toBeNull();
  });
});

describe('cancelledAtStore', () => {
  it('is true only for the two stores', () => {
    expect(cancelledAtStore({ kind: 'appstore', autopay: true })).toBe(true);
    expect(cancelledAtStore({ kind: 'playstore', autopay: true })).toBe(true);
    expect(cancelledAtStore({ kind: 'card', autopay: true })).toBe(false);
    expect(cancelledAtStore(null)).toBe(false);
  });
});

describe('pack and unpack', () => {
  it('round-trips everything except the digits', () => {
    for (const pm of [
      { kind: 'card', autopay: false },
      { kind: 'upi', brand: 'PhonePe', autopay: false },
      { kind: 'appstore', brand: 'Apple', autopay: true },
    ] as const) {
      expect(unpackPaymentMethod(packPaymentMethod(pm))).toEqual(pm);
    }
  });

  /**
   * The last four digits never reach the database.
   *
   * Play's Data Safety form declares that this app does not collect financial
   * payment info, and a declaration that does not match behaviour is what gets
   * an app flagged — regardless of whether masked digits would have counted.
   */
  it('never stores the last four digits', () => {
    const packed = packPaymentMethod({
      kind: 'card', brand: 'Visa', last4: '4242', autopay: true,
    });
    expect(packed).not.toContain('4242');
    expect(unpackPaymentMethod(packed)?.last4).toBeUndefined();
    // Everything else survives.
    expect(unpackPaymentMethod(packed)).toEqual({
      kind: 'card', brand: 'Visa', last4: undefined, autopay: true,
    });
  });

  it('is null in, null out', () => {
    expect(packPaymentMethod(null)).toBeNull();
    expect(unpackPaymentMethod(null)).toBeNull();
    expect(unpackPaymentMethod('')).toBeNull();
  });

  /** A row written by something else, or corrupted, must not become a fact. */
  it('refuses a kind it does not know', () => {
    expect(unpackPaymentMethod('bitcoin|||')).toBeNull();
    expect(unpackPaymentMethod('rubbish')).toBeNull();
  });

  it('keeps the field positions fixed so old rows still read', () => {
    expect(packPaymentMethod({ kind: 'upi', autopay: false })).toBe('upi|||');
    expect(unpackPaymentMethod('upi|||')).toEqual({
      kind: 'upi', brand: undefined, last4: undefined, autopay: false,
    });
  });
});
