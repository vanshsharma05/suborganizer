/**
 * The slides shown after sign-in — the app's one emotional moment.
 *
 * A dashboard shows everything at once and lands as furniture. One fact per
 * screen, arriving in an order the user did not choose, lands as a story: this
 * is what you pay, this is what it costs you a year, this is the one you forgot,
 * and here is money you can take back. By the time the last slide arrives the
 * user has already reacted to a number, which is the only moment an upgrade
 * prompt is anything other than an interruption.
 *
 * Deriving the slides is kept pure and separate from drawing them, so the
 * sequence — what is worth saying, in what order, and what to leave out when
 * there is nothing to say — can be tested without rendering anything.
 */

import type { Subscription } from './api';
import { monthlyEquivalent } from './cycles';
import type { Audit } from './savings';
import { activeTrials, splitByTrial } from './trials';

export type Slide =
  /** Opening beat. No number yet — the point is to make the next one land. */
  | { kind: 'intro'; id: string; title: string; caption: string }
  /** A single figure, counted up from zero. */
  | { kind: 'amount'; id: string; label: string; value: number; currency: string; caption: string }
  /** One subscription worth calling out by name. */
  | { kind: 'spotlight'; id: string; label: string; sub: Subscription; caption: string }
  /** The money moment, and where the paywall belongs. */
  | { kind: 'savings'; id: string; total: number; currency: string; count: number; certain: number }
  /** Shown instead of everything else when there is no data yet. */
  | { kind: 'scan'; id: string; title: string; caption: string };

export type StoryInput = {
  subs: Subscription[];
  audit: Audit;
  primaryCurrency: string;
  /** Converts a subscription's amount into the primary currency. */
  convert: (amount: number, from: string | undefined, to: string) => number;
  name?: string;
  today?: Date;
};

/**
 * Builds the sequence.
 *
 * Slides with nothing to say are omitted rather than shown empty — a story that
 * pads itself to a fixed length is the thing people start skipping.
 */
export function buildStory(input: StoryInput): Slide[] {
  const { subs, audit, primaryCurrency: cur, convert, today = new Date() } = input;
  const active = subs.filter((s) => s.status === 'active');

  // Nothing tracked yet: there is no story to tell, only an offer to find one.
  if (active.length === 0) {
    return [
      {
        kind: 'scan',
        id: 'scan',
        title: 'Let us find what you pay for',
        caption:
          'Most people underestimate their subscriptions by about a third. ' +
          'Scan your Gmail and we will show you the real number.',
      },
    ];
  }

  const { charging, trialing } = splitByTrial(active, today);
  const monthly = charging.reduce(
    (sum, s) => sum + convert(monthlyEquivalent(s.amount, s.billing_cycle), s.currency, cur),
    0,
  );

  const slides: Slide[] = [
    {
      kind: 'intro',
      id: 'intro',
      title: input.name ? `Here we go, ${input.name}` : 'Here we go',
      caption: `You are tracking ${active.length} ${active.length === 1 ? 'subscription' : 'subscriptions'}.`,
    },
    {
      kind: 'amount',
      id: 'monthly',
      label: 'Every month, you pay',
      value: monthly,
      currency: cur,
      caption: 'Weekly and yearly plans converted to what actually leaves your account.',
    },
    {
      kind: 'amount',
      id: 'yearly',
      label: 'Which is, every year',
      value: monthly * 12,
      currency: cur,
      // The annual figure is the one that changes behaviour. Nobody cancels over
      // ₹649 a month; people do cancel over ₹7,788 a year.
      caption: 'The same subscriptions, seen a year at a time.',
    },
  ];

  // The single largest line item, by what it actually costs per month.
  const biggest = [...charging].sort(
    (a, b) =>
      convert(monthlyEquivalent(b.amount, b.billing_cycle), b.currency, cur) -
      convert(monthlyEquivalent(a.amount, a.billing_cycle), a.currency, cur),
  )[0];

  if (biggest && charging.length > 1) {
    slides.push({
      kind: 'spotlight',
      id: `biggest:${biggest.id}`,
      label: 'Your biggest one',
      sub: biggest,
      caption: 'Worth checking whether a cheaper tier covers what you use.',
    });
  }

  // Trials have a deadline, which makes them the most urgent thing here.
  const trials = activeTrials(active, today);
  if (trials.length > 0) {
    const trialMonthly = trialing.reduce(
      (sum, s) => sum + convert(monthlyEquivalent(s.amount, s.billing_cycle), s.currency, cur),
      0,
    );
    slides.push({
      kind: 'amount',
      id: 'trials',
      label:
        trials.length === 1
          ? 'One free trial is about to convert'
          : `${trials.length} free trials are about to convert`,
      value: trialMonthly,
      currency: cur,
      caption: 'That is what your monthly total becomes unless you cancel first.',
    });
  }

  // The climax. Only shown when there is something to show — an audit slide
  // reading "we found ₹0" undoes every slide before it.
  if (audit.totalAnnual > 0 && audit.savings.length > 0) {
    slides.push({
      kind: 'savings',
      id: 'savings',
      total: audit.totalAnnual,
      currency: cur,
      count: audit.savings.length,
      certain: audit.certainCount,
    });
  }

  return slides;
}

/** Where the upgrade prompt belongs, or -1 when this story has no such moment. */
export function paywallIndex(slides: Slide[]): number {
  return slides.findIndex((s) => s.kind === 'savings');
}
