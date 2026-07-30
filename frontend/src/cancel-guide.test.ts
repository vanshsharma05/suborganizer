import { describe, expect, it } from 'vitest';
import { cancelGuideFor, hasCancelGuide, PLAY_SUBSCRIPTIONS } from './cancel-guide';

describe('cancelGuideFor', () => {
  it('returns the merchant guide for a known domain', () => {
    const g = cancelGuideFor({ domain: 'netflix.com' });
    expect(g.url).toBe('https://www.netflix.com/cancelplan');
    expect(g.generic).toBeUndefined();
  });

  it('matches a bulk-mail subdomain to its brand', () => {
    // The Gmail scan stores whatever it parsed, so billing.netflix.com must not
    // fall through to the generic advice.
    expect(cancelGuideFor({ domain: 'billing.netflix.com' }).url)
      .toBe('https://www.netflix.com/cancelplan');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(cancelGuideFor({ domain: '  NETFLIX.COM ' }).url)
      .toBe('https://www.netflix.com/cancelplan');
  });

  it('never confuses a lookalike domain for the real one', () => {
    // Endswith matching must respect the dot boundary, or notnetflix.com would
    // send someone to Netflix's cancellation page.
    expect(cancelGuideFor({ domain: 'notnetflix.com' }).generic).toBe(true);
    expect(cancelGuideFor({ domain: 'fakeamazon.in' }).generic).toBe(true);
  });

  it('falls back to Play for an unknown merchant', () => {
    const g = cancelGuideFor({ domain: 'somesaas.io' });
    expect(g.generic).toBe(true);
    // Most in-app subscriptions on Android are billed by Google, and cancelling
    // on the merchant's own site does nothing to those.
    expect(g.url).toBe(PLAY_SUBSCRIPTIONS);
  });

  it('falls back when there is no domain at all', () => {
    expect(cancelGuideFor({ domain: null }).generic).toBe(true);
    expect(cancelGuideFor({ domain: '' }).generic).toBe(true);
    expect(cancelGuideFor({ domain: undefined }).generic).toBe(true);
  });

  it('always returns usable steps, guide or fallback', () => {
    for (const domain of ['netflix.com', 'openai.com', 'unknown.example', null]) {
      expect(cancelGuideFor({ domain }).steps.length).toBeGreaterThan(10);
    }
  });

  it('gives written steps where there is no dependable link', () => {
    // Guessing a settings URL is worse than none: a 404 costs the trust that
    // made the user tap it.
    const g = cancelGuideFor({ domain: 'openai.com' });
    expect(g.url).toBeUndefined();
    expect(g.steps).toMatch(/Settings/i);
  });

  it('routes both Apple domains to Apple subscription management', () => {
    expect(cancelGuideFor({ domain: 'icloud.com' }).url)
      .toBe(cancelGuideFor({ domain: 'apple.com' }).url);
  });
});

describe('hasCancelGuide', () => {
  it('is true only for known merchants', () => {
    expect(hasCancelGuide({ domain: 'spotify.com' })).toBe(true);
    expect(hasCancelGuide({ domain: 'somesaas.io' })).toBe(false);
  });
});

describe('guide URLs', () => {
  it('are all https', () => {
    for (const domain of ['netflix.com', 'spotify.com', 'youtube.com', 'amazon.in', 'adobe.com']) {
      expect(cancelGuideFor({ domain }).url).toMatch(/^https:\/\//);
    }
  });
});
