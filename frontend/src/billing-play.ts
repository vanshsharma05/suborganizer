/**
 * Google Play Billing, behind the `Store` interface.
 *
 * Kept in its own file because it is the only part of the app that cannot be run
 * or tested from a desktop: it needs a real device, a real Play account, and
 * products that exist in Play Console. Everything that can be reasoned about
 * without those — what a purchase unlocks, what a locked card says, what the
 * sheet shows — lives elsewhere and is tested.
 *
 * Three things here are not obvious and all three are expensive to get wrong.
 *
 *   Purchases arrive on an event, not on the promise. `requestPurchase` resolves
 *   when the sheet has been *dispatched*; the outcome shows up later on a
 *   listener, because the user may take a minute, background the app, or pay by
 *   a method that settles asynchronously. `buy()` bridges the two by parking a
 *   deferred and letting the listener resolve it.
 *
 *   An unfinished Android purchase is auto-refunded after three days. Play
 *   treats "acknowledged" as "the app gave the user their goods"; skip
 *   `finishTransaction` and Play quietly claws the money back and the user keeps
 *   the entitlement. So it is called before we resolve, not after.
 *
 *   Both products are non-consumable. `isConsumable: false` is what makes Play
 *   remember them forever and hand them back on any device the account signs
 *   into, which is the whole restore story — there is nothing for us to store.
 *
 * Not done here: server-side receipt verification. Play's own client-side answer
 * is what gates the app today. That is the right trade for one-time unlocks
 * worth ₹10 and ₹199 — the work to defeat it exceeds the price, and a rooted
 * device can lie to a client check whatever we do. Revisit if there is ever a
 * recurring plan or a balance attached to an account.
 */

import { Platform } from 'react-native';
import {
  ErrorCode,
  endConnection,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type ExpoPurchaseError,
  type Purchase,
} from 'expo-iap';
import { ALL_PRODUCTS, isProductId, type ProductId } from './entitlements';
import type { Product, PurchaseResult, Store } from './billing';

/** Resolved by whichever of the two listeners fires first. */
type Deferred = { settle: (r: PurchaseResult) => void };

let pending: Deferred | null = null;
let connecting: Promise<boolean> | null = null;
let listeners: { remove: () => void }[] = [];

function settle(result: PurchaseResult): void {
  const p = pending;
  pending = null;
  p?.settle(result);
}

/**
 * Connects once and keeps the connection.
 *
 * Memoised on the promise rather than on a boolean so that two screens mounting
 * at the same time — the scan gate and the savings paywall both ask on first
 * render — share one connection attempt instead of racing to open two.
 */
function connect(): Promise<boolean> {
  if (connecting) return connecting;

  connecting = (async () => {
    await initConnection();

    listeners = [
      purchaseUpdatedListener((purchase: Purchase) => {
        void handlePurchase(purchase);
      }),
      purchaseErrorListener((error: ExpoPurchaseError) => {
        settle(
          error.code === ErrorCode.UserCancelled
            ? { status: 'cancelled' }
            : error.code === ErrorCode.AlreadyOwned
              // Owned but not delivered — the usual cause is a reinstall where the
              // acknowledgement never landed. Treating it as success is correct:
              // they paid, and the next getAvailablePurchases confirms it.
              ? { status: 'purchased', id: (error.productId ?? '') as ProductId }
              : { status: 'failed', reason: friendly(error) },
        );
      }),
    ];

    return true;
  })().catch(() => {
    // Leave `connecting` resolved-false rather than null: retrying a broken
    // connection on every render would spin, and the buy button is already
    // disabled by `available` being false.
    return false;
  });

  return connecting;
}

async function handlePurchase(purchase: Purchase): Promise<void> {
  const id = purchase.productId;

  try {
    // Before resolving, always. An unacknowledged purchase is refunded by Play
    // in three days and the user is left holding an entitlement they no longer
    // paid for — the one failure here that costs real money.
    await finishTransaction({ purchase, isConsumable: false });
  } catch {
    // The entitlement is still real and Play will replay the transaction on the
    // next launch, where this runs again. Blocking the user on it would be worse.
  }

  settle(
    isProductId(id)
      ? { status: 'purchased', id }
      : { status: 'failed', reason: 'The store returned a product we do not sell.' },
  );
}

function friendly(error: ExpoPurchaseError): string {
  switch (error.code) {
    case ErrorCode.NetworkError:
      return 'Could not reach Google Play. Check your connection and try again.';
    case ErrorCode.ItemUnavailable:
      return 'This is not available on your account yet. It can take a few hours after release.';
    case ErrorCode.ServiceError:
    case ErrorCode.ServiceDisconnected:
      return 'Google Play is not responding. Try again in a moment.';
    case ErrorCode.DeveloperError:
      return 'Purchases are misconfigured for this build. Please contact support.';
    default:
      return error.message || 'The purchase could not be completed.';
  }
}

export const playStore: Store = {
  // Play Billing is Android-only. iOS would go through StoreKit, which expo-iap
  // also covers, but there is no iOS build to test it against — claiming support
  // we have never run is how you ship a broken buy button.
  available: Platform.OS === 'android',

  products: async (): Promise<Product[]> => {
    if (!(await connect())) return [];

    const fetched = await fetchProducts({ skus: ALL_PRODUCTS, type: 'in-app' });
    const list = Array.isArray(fetched) ? fetched : [];

    return list.flatMap((p) =>
      // `displayPrice` is Play's own string — localised, correct currency, and
      // whatever sale is live. Never rebuilt from the numeric field.
      isProductId(p.id) ? [{ id: p.id, price: p.displayPrice }] : [],
    );
  },

  owned: async (): Promise<ProductId[]> => {
    if (!(await connect())) return [];

    const purchases = await getAvailablePurchases();
    return purchases.map((p) => p.productId).filter(isProductId);
  },

  buy: async (id: ProductId): Promise<PurchaseResult> => {
    if (!(await connect())) {
      return { status: 'unavailable', reason: 'Google Play is not available on this device.' };
    }

    // One at a time. Two sheets cannot be open at once anyway, and a second
    // deferred would orphan the first — its caller would hang forever.
    if (pending) return { status: 'failed', reason: 'Another purchase is already in progress.' };

    return new Promise<PurchaseResult>((resolve) => {
      let done = false;
      const once = (r: PurchaseResult) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(r);
      };

      // Backstop for the case Play never answers at all — a sheet dismissed by
      // the system, say. Without it the sheet closes and the button spins for
      // good. Generous, because a slow bank confirmation is not a failure.
      const timer = setTimeout(() => {
        pending = null;
        once({ status: 'failed', reason: 'Google Play did not respond. If you were charged, use Restore purchases.' });
      }, 180_000);

      pending = { settle: once };

      requestPurchase({
        request: { google: { skus: [id] }, apple: { sku: id } },
        type: 'in-app',
      }).catch((e: unknown) => {
        pending = null;
        once({ status: 'failed', reason: e instanceof Error ? e.message : 'Could not open Google Play.' });
      });
    });
  },
};

/** Only for tests and teardown; the app holds the connection for its lifetime. */
export async function disconnectPlay(): Promise<void> {
  listeners.forEach((l) => l.remove());
  listeners = [];
  connecting = null;
  pending = null;
  await endConnection().catch(() => {});
}
