/**
 * The seam between the app and Google Play Billing.
 *
 * Everything above this file asks two questions — "what does the user own?" and
 * "buy this for me" — and never learns where the answers come from. That matters
 * more than it looks: Play Billing needs a native module, which needs a new
 * binary, which is a twenty-minute build and a Play Console round trip. Keeping
 * the store behind an interface means the paywall, the gating and the screens
 * are all finished and testable before any of that exists, and switching it on
 * later changes exactly one function.
 *
 * Prices are never written down here. `Product.price` is whatever string the
 * store handed us — already in the user's currency, already formatted for their
 * locale, already reflecting any sale. Play's own policy expects the displayed
 * price to be the store's; more practically, a hardcoded "₹199" becomes a lie
 * the moment you edit the product, and you will not remember this file when you
 * do.
 *
 * ------------------------------------------------------------------ wiring up
 *
 * The Play implementation is written and lives in billing-play.ts. What remains
 * is entirely outside this repo:
 *
 *   1. Create both products in Play Console → Monetise → In-app products, IDs
 *      matching PRODUCTS in entitlements.ts, type "one-time". Note that India's
 *      floor for an in-app product is ₹10 — ₹1 will be rejected.
 *   2. Rebuild the dev client. expo-iap is a native module, so Metro alone will
 *      not pick it up and the store will report itself unavailable until then.
 *   3. Add testers under Play Console → Setup → Licence testing, so the full
 *      flow runs without charging a real card.
 *
 * Release builds with no Play module fall back to `nullStore`, which reports the
 * store as unavailable and grants nothing. That is the only safe default: a stub
 * that quietly hands out Pro ships the day someone forgets a step.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ALL_PRODUCTS, isProductId, PRODUCTS, type ProductId } from './entitlements';

export type Product = {
  id: ProductId;
  /** The store's own formatted price, e.g. "₹199.00". Never assembled here. */
  price: string;
};

export type PurchaseResult =
  | { status: 'purchased'; id: ProductId }
  /** The user backed out. Not an error, and must not be shown as one. */
  | { status: 'cancelled' }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; reason: string };

export interface Store {
  /** False when billing cannot run at all — no module, no Play Services. */
  readonly available: boolean;
  /** Purchasable products, priced by the store. Empty when unavailable. */
  products(): Promise<Product[]>;
  /**
   * Everything this account has ever bought.
   *
   * Play is the durable record for one-time products: it returns them for the
   * same Google account on any device, forever, which is why a reinstall does
   * not need us to have stored anything.
   */
  owned(): Promise<ProductId[]>;
  buy(id: ProductId): Promise<PurchaseResult>;
}

// ------------------------------------------------------------- release stub --

const UNAVAILABLE =
  'In-app purchases are not available on this build yet. Nothing has been charged.';

const nullStore: Store = {
  available: false,
  products: async () => [],
  owned: async () => [],
  buy: async () => ({ status: 'unavailable', reason: UNAVAILABLE }),
};

// ----------------------------------------------------------------- dev stub --

const DEV_KEY = 'billing.devOwned.v1';

/**
 * Stands in for Play while developing, and only while developing.
 *
 * Guarded by `__DEV__` at the single call site below, so a release build can
 * never reach it — the failure mode there, every purchase succeeding for free,
 * is silent, permanent and expensive. Set EXPO_PUBLIC_REAL_BILLING=1 to test
 * against real Play products from a dev build instead.
 *
 * Prices here are placeholders for layout only, set to what Play will actually
 * accept: India's minimum for an in-app product is ₹10, so the ₹1 scan unlock
 * cannot exist. Nothing above this file formats its own prices, which is why
 * that discovery cost one line here instead of a search across the screens.
 */
const devStore: Store = {
  available: true,

  products: async () => [
    { id: PRODUCTS.scan, price: '₹10.00' },
    { id: PRODUCTS.pro, price: '₹199.00' },
  ],

  owned: async () => {
    try {
      const raw = await AsyncStorage.getItem(DEV_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v): v is ProductId => typeof v === 'string' && isProductId(v)) : [];
    } catch {
      return [];
    }
  },

  buy: async (id) => {
    try {
      const current = await devStore.owned();
      if (!current.includes(id)) {
        await AsyncStorage.setItem(DEV_KEY, JSON.stringify([...current, id]));
      }
      return { status: 'purchased', id };
    } catch (e) {
      return { status: 'failed', reason: e instanceof Error ? e.message : 'Could not record purchase' };
    }
  },
};

/** Clears simulated purchases so the paywall can be seen again. Dev only. */
export async function resetDevPurchases(): Promise<void> {
  if (!__DEV__) return;
  await AsyncStorage.removeItem(DEV_KEY).catch(() => {});
}

// ------------------------------------------------------------------ resolve --

let cached: Store | null = null;

/**
 * The store this build talks to.
 *
 * Play is loaded lazily and in a try/catch, because it is a native module: in
 * Expo Go, in a stale dev client built before expo-iap was added, or on a
 * platform without it, the import itself throws. Falling back rather than
 * crashing means an out-of-date dev client shows "purchases not available"
 * instead of a red screen on launch.
 *
 * Dev keeps its simulator regardless, so the paywall stays explorable without a
 * Play account attached.
 */
export function store(): Store {
  if (cached) return cached;

  if (__DEV__ && process.env.EXPO_PUBLIC_REAL_BILLING !== '1') {
    cached = devStore;
    return cached;
  }

  try {
    // Required inline, not imported: a top-level import is evaluated when this
    // module loads, which is on every platform including the ones where the
    // native module is absent. This is the one place the lazy form is correct.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { playStore } = require('./billing-play') as typeof import('./billing-play');
    cached = playStore;
  } catch {
    cached = nullStore;
  }

  return cached;
}

/**
 * Reads the store, tolerating every way it can fail.
 *
 * Billing is the one subsystem that must never be able to block the app: if Play
 * is down or the module throws, the user should see the app they already paid
 * for, minus the buy button — not a spinner. Callers get an empty list and carry
 * on, and the locally cached entitlements (see purchases.tsx) cover the gap.
 */
export async function readOwned(): Promise<ProductId[]> {
  try {
    const owned = await store().owned();
    return owned.filter(isProductId);
  } catch {
    return [];
  }
}

export async function readProducts(): Promise<Product[]> {
  try {
    const list = await store().products();
    return list.filter((p) => ALL_PRODUCTS.includes(p.id));
  } catch {
    return [];
  }
}
