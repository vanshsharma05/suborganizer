/**
 * Who has paid for what, for the rest of the app.
 *
 * Sits between billing.ts (the store) and the screens (which only ever ask
 * `pro` or `canScan`). Three things live here that do not belong in either:
 *
 *   A local cache. Entitlements are read from Play on launch, but Play needs the
 *   network and the app does not. Someone who paid ₹199 on the train must not
 *   lose the thing they bought in a tunnel, so the last known answer is kept on
 *   the device and used until the store contradicts it. It can only ever add
 *   access, never remove it — see `merge`.
 *
 *   The server as a second source. `profiles.is_pro` grants Pro independently of
 *   the store, which covers refunds handled by hand, comped accounts, and the
 *   day there is an iOS build whose purchases Play knows nothing about.
 *
 *   Failure that does nothing. Every path here swallows its errors and resolves
 *   to "no new entitlements". A billing outage should cost the user a buy
 *   button, not the app.
 */

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setProFlag } from './api';
import { useAuth } from './auth-context';
import {
  readOwned, readProducts, resetDevPurchases, store, type Product, type PurchaseResult,
} from './billing';
import {
  canScan as canScanFor, isProductId, isPro as isProFor, PRODUCTS, type ProductId,
} from './entitlements';

const CACHE_KEY = 'billing.owned.v1';

type PurchasesValue = {
  owned: ProductId[];
  /** Store-priced products, by ID. Absent while loading or when unavailable. */
  products: Partial<Record<ProductId, Product>>;
  /** Genuinely owns Pro. Use for badges and anything that states a fact. */
  pro: boolean;
  canScan: boolean;
  /**
   * Whether paid content may be shown.
   *
   * True when the user owns Pro *or* when there is no way to buy it — see
   * `canSell`. Gate locks on this, not on `pro`.
   */
  unlocked: boolean;
  /**
   * True when the store is live and has actually priced something.
   *
   * The distinction matters at launch and during any Play outage: until the
   * products exist in Play Console, `fetchProducts` returns nothing, every buy
   * button is dead, and locking content behind them would leave users staring
   * at a wall with no door. Better to give it away for the hours that lasts
   * than to ship an app whose main feature cannot be reached or bought.
   */
  canSell: boolean;
  /** False until the first store read finishes. Gate buy buttons on it. */
  ready: boolean;
  /** False when this build cannot take payments at all. */
  storeAvailable: boolean;
  buy: (id: ProductId) => Promise<PurchaseResult>;
  refresh: () => Promise<void>;
  /**
   * Puts the account back to owning nothing. Does nothing outside `__DEV__`.
   *
   * Needed because every other path here is deliberately one-way: the cache
   * unions, the server grants, and neither can take anything back. Testing a
   * paywall you can only ever walk through once is not testing it.
   */
  resetForDev: () => Promise<void>;
};

const Ctx = createContext<PurchasesValue | null>(null);

/** Union, never difference: access already granted is never taken back here. */
function merge(a: readonly ProductId[], b: readonly ProductId[]): ProductId[] {
  return Array.from(new Set([...a, ...b]));
}

async function readCache(): Promise<ProductId[]> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is ProductId => typeof v === 'string' && isProductId(v));
  } catch {
    return [];
  }
}

async function writeCache(owned: readonly ProductId[]): Promise<void> {
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(owned)).catch(() => {});
}

export function PurchaseProvider({ children }: { children: React.ReactNode }) {
  const { user, setPro } = useAuth();

  const [owned, setOwned] = useState<ProductId[]>([]);
  const [products, setProducts] = useState<Partial<Record<ProductId, Product>>>({});
  const [ready, setReady] = useState(false);

  // Mirroring Pro to the server is fire-and-forget, but it must not fire on
  // every render — this remembers who we have already told.
  const mirrored = useRef<string | null>(null);

  const apply = useCallback((next: readonly ProductId[]) => {
    setOwned((prev) => {
      const merged = merge(prev, next);
      if (merged.length === prev.length) return prev;
      void writeCache(merged);
      return merged;
    });
  }, []);

  const refresh = useCallback(async () => {
    const [cached, fromStore, list] = await Promise.all([
      readCache(),
      readOwned(),
      readProducts(),
    ]);

    apply(merge(cached, fromStore));

    if (list.length > 0) {
      setProducts(Object.fromEntries(list.map((p) => [p.id, p])) as Partial<Record<ProductId, Product>>);
    }
  }, [apply]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await refresh();
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [refresh]);

  // The server can grant Pro on its own. Fold it in as soon as the profile lands.
  useEffect(() => {
    if (user?.is_pro) apply([PRODUCTS.pro]);
  }, [user?.is_pro, apply]);

  const pro = isProFor(owned) || Boolean(user?.is_pro);

  // …and the store can grant it too, in which case the server should know, so
  // that a fresh install on another device is Pro before Play has answered.
  useEffect(() => {
    if (!pro || !user || user.is_pro || mirrored.current === user.id) return;
    mirrored.current = user.id;
    setPro(true);
    void setProFlag(true).catch(() => {
      // Purely an optimisation — Play still holds the durable receipt, so a
      // failure here costs nothing the next launch will not fix.
      mirrored.current = null;
    });
  }, [pro, user, setPro]);

  const buy = useCallback(
    async (id: ProductId): Promise<PurchaseResult> => {
      const result = await store()
        .buy(id)
        .catch((e: unknown) => ({
          status: 'failed' as const,
          reason: e instanceof Error ? e.message : 'Purchase could not be completed',
        }));

      if (result.status === 'purchased') apply([result.id]);
      return result;
    },
    [apply],
  );

  const resetForDev = useCallback(async () => {
    if (!__DEV__) return;
    await resetDevPurchases();
    await AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
    // The server grant outlives both of the above, so it has to go too, or the
    // account comes back Pro on the next render and the reset looks broken.
    await setProFlag(false).catch(() => {});
    mirrored.current = null;
    setPro(false);
    setOwned([]);
  }, [setPro]);

  const value = useMemo<PurchasesValue>(() => {
    const storeAvailable = store().available;
    // Only once the first read has finished — before that we do not yet know
    // whether there is anything for sale, and guessing "no" would flash the
    // whole paid audit at every user for a frame.
    const canSell = ready && storeAvailable && Object.keys(products).length > 0;

    return {
      owned,
      products,
      pro,
      canScan: canScanFor(owned) || pro || !canSell,
      unlocked: pro || !canSell,
      canSell,
      ready,
      storeAvailable,
      buy,
      refresh,
      resetForDev,
    };
  }, [owned, products, pro, ready, buy, refresh, resetForDev]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePurchases(): PurchasesValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePurchases must be used inside PurchaseProvider');
  return ctx;
}
