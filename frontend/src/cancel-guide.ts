/**
 * Where to actually cancel a subscription.
 *
 * The app is already good at telling people what to drop, and gives them no way
 * to do it — they still have to go hunting through account settings, which is
 * where the intent dies. Around six in ten people keep paying for something
 * they have decided against, specifically because cancelling is work.
 *
 * Two deliberate choices:
 *
 * A `url` is only present where the destination is stable and well known.
 * Guessing a plausible-looking settings URL is worse than no link: a 404 costs
 * the user the trust that made them tap it. Everything else gets written steps
 * instead.
 *
 * `Play first` leads the generic advice because on Android most in-app
 * subscriptions are billed by Google, not the merchant. Cancelling on the
 * merchant's own site does nothing to a Play-billed subscription, and this is
 * the single most common reason someone believes they cancelled and gets charged
 * anyway.
 */

import type { Subscription } from './api';

export const PLAY_SUBSCRIPTIONS = 'https://play.google.com/store/account/subscriptions';
export const APPLE_SUBSCRIPTIONS = 'https://apps.apple.com/account/subscriptions';

export type CancelGuide = {
  /** Direct destination, when there is a dependable one. */
  url?: string;
  /** What to do — shown whether or not there is a link. */
  steps: string;
  /** True when this is the fallback rather than a known merchant. */
  generic?: boolean;
};

/**
 * Keyed on the registrable domain already stored on each subscription, so the
 * Gmail scan and manual entry both resolve through the same key.
 */
const GUIDES: Record<string, CancelGuide> = {
  'netflix.com': {
    url: 'https://www.netflix.com/cancelplan',
    steps: 'Sign in and confirm. You keep access until the end of the paid period.',
  },
  'spotify.com': {
    url: 'https://www.spotify.com/account/subscription/',
    steps: 'Under your plan, choose Cancel Premium. It reverts to the free tier at period end.',
  },
  'youtube.com': {
    url: 'https://www.youtube.com/paid_memberships',
    steps: 'Covers Premium and individual channel memberships. Pick the one to end.',
  },
  'google.com': {
    url: 'https://one.google.com/settings',
    steps:
      'For Google One and Drive storage. Other Google subscriptions live under Play — see below.',
  },
  'amazon.in': {
    url: 'https://www.amazon.in/gp/primecentral',
    steps: 'Choose End membership. Amazon offers a partial refund if you have used it little.',
  },
  'amazon.com': {
    url: 'https://www.amazon.com/gp/primecentral',
    steps: 'Choose End membership. A partial refund may be offered.',
  },
  'adobe.com': {
    url: 'https://account.adobe.com/plans',
    steps:
      'Adobe charges an early-termination fee on annual plans cancelled mid-term — check before confirming.',
  },
  'microsoft.com': {
    url: 'https://account.microsoft.com/services',
    steps: 'Covers Microsoft 365, Xbox and OneDrive. Turn off recurring billing on the plan.',
  },
  'dropbox.com': {
    url: 'https://www.dropbox.com/account/plan',
    steps: 'Cancel the plan. Files over the free limit become read-only, not deleted.',
  },
  'apple.com': {
    url: APPLE_SUBSCRIPTIONS,
    steps: 'All Apple subscriptions — iCloud+, Music, TV+, Arcade — are managed in one place.',
  },
  'icloud.com': {
    url: APPLE_SUBSCRIPTIONS,
    steps: 'iCloud+ is billed by Apple. Downgrade to the free 5 GB tier here.',
  },
  'linkedin.com': {
    url: 'https://www.linkedin.com/premium/manage/',
    steps: 'Cancel Premium. Your profile stays; only the Premium features stop.',
  },
  'github.com': {
    url: 'https://github.com/settings/billing',
    steps: 'Downgrade the plan to Free. Private repos stay, some features stop.',
  },
  'patreon.com': {
    url: 'https://www.patreon.com/settings/memberships',
    steps: 'Each creator is a separate membership — cancel them individually.',
  },
  'nordvpn.com': {
    url: 'https://my.nordaccount.com/',
    steps: 'Under Subscriptions, turn off auto-renew.',
  },
  'anthropic.com': {
    url: 'https://claude.ai/settings/billing',
    steps: 'Cancel the plan under Billing. Access continues to the end of the period.',
  },

  // Known merchants without a link I would stake a tap on.
  'openai.com': {
    steps:
      'Open ChatGPT, then Settings → Subscription → Manage → Cancel plan. If you subscribed on Android, cancel in Google Play instead.',
  },
  'notion.so': {
    steps: 'Settings & members → Billing → Change plan → Downgrade to Free.',
  },
  'hotstar.com': {
    steps:
      'My Account → Subscription → Cancel. If you subscribed through Play or Jio, cancel there — not in the app.',
  },
  'canva.com': {
    steps: 'Account settings → Billing & plans → Cancel subscription.',
  },
  'figma.com': {
    steps: 'Admin → Billing → downgrade the seat to Starter.',
  },
  'coursera.org': {
    steps: 'Account settings → My purchases → Manage subscription → Cancel.',
  },
  'audible.in': {
    steps: 'Account details → Cancel membership. Books you own stay yours.',
  },
  'audible.com': {
    steps: 'Account details → Cancel membership. Books you own stay yours.',
  },
  'swiggy.in': {
    steps: 'Swiggy app → Account → Swiggy One → Manage → Cancel. In-app only.',
  },
  'zomato.com': {
    steps: 'Zomato app → Account → your membership → Cancel. In-app only.',
  },
  'cult.fit': {
    steps: 'cult.fit app → Profile → Memberships → Cancel. Support may need to confirm.',
  },
  'blinkit.com': {
    steps: 'Blinkit app → Account → your plan → Cancel. In-app only.',
  },
  'uber.com': {
    steps: 'Uber app → Account → Uber One → Manage membership → End membership.',
  },
};

const FALLBACK: CancelGuide = {
  url: PLAY_SUBSCRIPTIONS,
  steps:
    'Check Google Play first — most subscriptions bought inside an Android app are billed by Google, and cancelling on the merchant’s own site will not stop those charges. If it is not listed there, sign in on the merchant’s website and look under Account, Billing or Plan.',
  generic: true,
};

/**
 * How to cancel this subscription. Always returns something: an unknown
 * merchant gets the Play-first fallback, which is right more often than not on
 * Android.
 */
export function cancelGuideFor(sub: Pick<Subscription, 'domain'>): CancelGuide {
  const domain = (sub.domain ?? '').trim().toLowerCase();
  if (!domain) return FALLBACK;

  const exact = GUIDES[domain];
  if (exact) return exact;

  // "billing.netflix.com" and the like — match on the registrable part.
  const match = Object.keys(GUIDES).find((d) => domain === d || domain.endsWith(`.${d}`));
  return match ? GUIDES[match] : FALLBACK;
}

/** True when we have merchant-specific guidance rather than the fallback. */
export function hasCancelGuide(sub: Pick<Subscription, 'domain'>): boolean {
  return !cancelGuideFor(sub).generic;
}
