import { describe, expect, it } from 'vitest';
import type { Subscription } from './api';
import type { Audit } from './savings';
import { buildStory, paywallIndex } from './story';
import { markPlayed, REPLAY_AFTER_DAYS, shouldPlayStory } from './story-gate';

const TODAY = new Date(2026, 6, 30);

function sub(over: Partial<Subscription> = {}): Subscription {
  return {
    id: over.name ?? Math.random().toString(36).slice(2),
    name: 'Netflix',
    amount: 649,
    currency: 'INR',
    billing_cycle: 'monthly',
    category: 'Entertainment',
    next_renewal: '2026-08-15',
    status: 'active',
    ...over,
  } as Subscription;
}

const emptyAudit: Audit = { savings: [], totalAnnual: 0, currency: 'INR', certainCount: 0 };

function story(subs: Subscription[], audit: Audit = emptyAudit, name?: string) {
  return buildStory({
    subs,
    audit,
    primaryCurrency: 'INR',
    convert: (amount) => amount,
    name,
    today: TODAY,
  });
}

describe('buildStory', () => {
  it('offers a scan and nothing else when there is nothing tracked', () => {
    const slides = story([]);
    expect(slides).toHaveLength(1);
    expect(slides[0].kind).toBe('scan');
  });

  it('treats an all-cancelled account as empty', () => {
    const slides = story([sub({ status: 'cancelled' })]);
    expect(slides[0].kind).toBe('scan');
  });

  it('opens on the intro, then monthly, then yearly', () => {
    const slides = story([sub({ name: 'A' }), sub({ name: 'B', amount: 100 })]);
    expect(slides.slice(0, 3).map((s) => s.id)).toEqual(['intro', 'monthly', 'yearly']);
  });

  it('greets by name when it knows one', () => {
    const [intro] = story([sub()], emptyAudit, 'Vansh');
    expect(intro.kind === 'intro' && intro.title).toContain('Vansh');
  });

  it('states the annual figure as twelve times the monthly one', () => {
    const slides = story([sub({ amount: 649 })]);
    const monthly = slides.find((s) => s.id === 'monthly');
    const yearly = slides.find((s) => s.id === 'yearly');

    expect(monthly?.kind === 'amount' && monthly.value).toBe(649);
    expect(yearly?.kind === 'amount' && yearly.value).toBe(649 * 12);
  });

  it('converts to the primary currency before totalling', () => {
    const slides = buildStory({
      subs: [sub({ name: 'A', amount: 1000 }), sub({ name: 'B', amount: 10, currency: 'USD' })],
      audit: emptyAudit,
      primaryCurrency: 'INR',
      convert: (amount, from) => (from === 'USD' ? amount * 88 : amount),
      today: TODAY,
    });

    const monthly = slides.find((s) => s.id === 'monthly');
    expect(monthly?.kind === 'amount' && monthly.value).toBe(1000 + 880);
  });

  it('holds trials out of the monthly total', () => {
    const paid = sub({ name: 'Paid', amount: 500 });
    const trial = sub({ name: 'Trial', amount: 900, is_trial: true, trial_ends: '2026-08-05' });

    const slides = story([paid, trial]);
    const monthly = slides.find((s) => s.id === 'monthly');

    // A trial costs nothing today, so counting it would overstate the total.
    expect(monthly?.kind === 'amount' && monthly.value).toBe(500);
  });

  it('adds a trial slide saying what the total becomes', () => {
    const slides = story([
      sub({ name: 'Paid', amount: 500 }),
      sub({ name: 'Trial', amount: 900, is_trial: true, trial_ends: '2026-08-05' }),
    ]);

    const trials = slides.find((s) => s.id === 'trials');
    expect(trials?.kind === 'amount' && trials.value).toBe(900);
    expect(trials?.kind === 'amount' && trials.label).toMatch(/one free trial/i);
  });

  it('spotlights the largest by monthly cost, not by sticker price', () => {
    const monthlySub = sub({ name: 'Monthly', amount: 649 }); // 649/mo
    const yearlySub = sub({ name: 'Yearly', amount: 1499, billing_cycle: 'yearly' }); // ~125/mo

    const slides = story([monthlySub, yearlySub]);
    const spot = slides.find((s) => s.kind === 'spotlight');

    expect(spot?.kind === 'spotlight' && spot.sub.name).toBe('Monthly');
  });

  it('skips the spotlight when there is only one subscription', () => {
    // "Your biggest one" is a silly thing to say about a list of one.
    const slides = story([sub()]);
    expect(slides.some((s) => s.kind === 'spotlight')).toBe(false);
  });

  it('ends on the savings slide when there is something to claim', () => {
    const audit: Audit = {
      savings: [{ id: 'x' } as never],
      totalAnnual: 6340,
      currency: 'INR',
      certainCount: 1,
    };
    const slides = story([sub({ name: 'A' }), sub({ name: 'B' })], audit);
    const last = slides[slides.length - 1];

    expect(last.kind).toBe('savings');
    expect(last.kind === 'savings' && last.total).toBe(6340);
  });

  it('omits the savings slide when there is nothing to claim', () => {
    // "We found ₹0" undoes every slide before it.
    const slides = story([sub({ name: 'A' }), sub({ name: 'B' })]);
    expect(slides.some((s) => s.kind === 'savings')).toBe(false);
  });

  it('gives every slide a unique id, so the pager can key on it', () => {
    const audit: Audit = {
      savings: [{ id: 'x' } as never],
      totalAnnual: 100,
      currency: 'INR',
      certainCount: 0,
    };
    const slides = story(
      [
        sub({ name: 'A', amount: 900 }),
        sub({ name: 'B', amount: 100 }),
        sub({ name: 'C', is_trial: true, trial_ends: '2026-08-05' }),
      ],
      audit,
    );
    expect(new Set(slides.map((s) => s.id)).size).toBe(slides.length);
  });
});

describe('paywallIndex', () => {
  it('points at the savings slide', () => {
    const audit: Audit = {
      savings: [{ id: 'x' } as never],
      totalAnnual: 500,
      currency: 'INR',
      certainCount: 0,
    };
    const slides = story([sub({ name: 'A' }), sub({ name: 'B' })], audit);
    expect(paywallIndex(slides)).toBe(slides.length - 1);
  });

  it('is -1 when the story has no money moment', () => {
    expect(paywallIndex(story([sub()]))).toBe(-1);
  });
});

describe('shouldPlayStory', () => {
  it('plays the first time', () => {
    expect(shouldPlayStory({ lastShown: null }, true, TODAY)).toBe(true);
  });

  it('does not play with nothing to show', () => {
    expect(shouldPlayStory({ lastShown: null }, false, TODAY)).toBe(false);
  });

  it('does not play again the same day', () => {
    expect(shouldPlayStory({ lastShown: '2026-07-30' }, true, TODAY)).toBe(false);
  });

  it('does not play again the next day', () => {
    expect(shouldPlayStory({ lastShown: '2026-07-29' }, true, TODAY)).toBe(false);
  });

  it('plays again after a week', () => {
    const weekAgo = new Date(TODAY);
    weekAgo.setDate(weekAgo.getDate() - REPLAY_AFTER_DAYS);
    expect(shouldPlayStory({ lastShown: markPlayed(weekAgo).lastShown }, true, TODAY)).toBe(true);
  });

  it('does not play six days later', () => {
    const sixDays = new Date(TODAY);
    sixDays.setDate(sixDays.getDate() - (REPLAY_AFTER_DAYS - 1));
    expect(shouldPlayStory({ lastShown: markPlayed(sixDays).lastShown }, true, TODAY)).toBe(false);
  });

  it('survives a date in the future without replaying every launch', () => {
    // A clock change or corrupt storage must not turn the story into a loop.
    expect(shouldPlayStory({ lastShown: '2027-01-01' }, true, TODAY)).toBe(false);
  });

  it('treats an unreadable stored value as never shown', () => {
    expect(shouldPlayStory({ lastShown: 'yesterday' }, true, TODAY)).toBe(true);
  });
});

describe('markPlayed', () => {
  it('records the local calendar day', () => {
    expect(markPlayed(new Date(2026, 6, 30, 1, 0)).lastShown).toBe('2026-07-30');
  });

  it('round-trips: marking today means it will not play again today', () => {
    const state = markPlayed(TODAY);
    expect(shouldPlayStory(state, true, TODAY)).toBe(false);
  });
});
