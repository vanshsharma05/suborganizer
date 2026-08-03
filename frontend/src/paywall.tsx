/**
 * The two places money changes hands.
 *
 * One component, two configurations, because the pitch is the same shape both
 * times: name the specific thing being bought, show the number it is worth,
 * state the price the store gave us, one button. The version of this that lists
 * nine features and three tiers is the version people close.
 *
 * What the sheet never does:
 *
 *   Invent a price. Everything shown comes from `products[id].price`, which came
 *   from Play. When the store has not answered yet the button says so and does
 *   nothing, which is better than a confident "₹199" that turns out to be ₹249
 *   at the till.
 *
 *   Round up the value. The headline figure is the audit's own total for what is
 *   still locked. If that is ₹240 the sheet says ₹240 and the user decides — the
 *   moment this app oversells a saving is the moment its one asset, being right
 *   about money, is gone.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeInDown, SlideInDown } from 'react-native-reanimated';
import { PRODUCTS, type ProductId } from './entitlements';
import { usePurchases } from './purchases';
import { theme } from './theme';
import { fmtMoney } from './currency';
import { Press } from './motion';

type Pitch = {
  eyebrow: string;
  title: string;
  points: { icon: keyof typeof Ionicons.glyphMap; text: string }[];
  cta: string;
  /** Shown small, under the button. The honesty line. */
  footnote: string;
};

const PITCH: Record<ProductId, Pitch> = {
  [PRODUCTS.pro]: {
    eyebrow: 'Unlock the full audit',
    title: 'See every one of them',
    points: [
      { icon: 'list', text: 'Every finding, with the arithmetic behind it' },
      { icon: 'navigate', text: 'Exactly what to change, and where to click' },
      { icon: 'trending-up', text: 'New findings as prices rise and trials convert' },
      { icon: 'infinite', text: 'One payment, yours for good' },
    ],
    cta: 'Unlock everything',
    // A subscription tracker charging a subscription is the joke every reviewer
    // makes first. Saying it before they do turns it into a reason to trust us.
    footnote: 'A one-time payment. We are not going to charge you monthly for an app about monthly charges.',
  },
  [PRODUCTS.scan]: {
    eyebrow: 'Find what you forgot',
    title: 'Read my inbox for subscriptions',
    points: [
      { icon: 'mail', text: 'Finds subscriptions in your Gmail receipts' },
      { icon: 'eye-off', text: 'Runs on your phone. We never store your email' },
      { icon: 'checkmark-done', text: 'You approve every one before it is added' },
    ],
    cta: 'Unlock the scan',
    footnote: 'Once, not monthly. Scanning costs us real quota, so this keeps it honest on both sides.',
  },
};

export function UpgradeSheet({
  product,
  visible,
  onClose,
  /** Money still behind the lock, in the user's primary currency. */
  worth,
  currency,
  onPurchased,
}: {
  product: ProductId;
  visible: boolean;
  onClose: () => void;
  worth?: number;
  currency?: string;
  onPurchased?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { products, buy, ready, storeAvailable } = usePurchases();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pitch = PITCH[product];
  const price = products[product]?.price;

  const purchase = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await buy(product);
      if (result.status === 'purchased') {
        onPurchased?.();
        onClose();
      } else if (result.status === 'unavailable' || result.status === 'failed') {
        setError(result.reason);
      }
      // 'cancelled' is the user changing their mind. Saying anything about it
      // turns a shrug into a rejection they have to dismiss.
    } finally {
      setBusy(false);
    }
  };

  const buyable = ready && storeAvailable && Boolean(price);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={onClose} testID="paywall-backdrop" />

      <Animated.View
        entering={SlideInDown.duration(320)}
        style={[s.sheet, { paddingBottom: insets.bottom + 18 }]}
      >
        <View style={s.grabber} />

        <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
          <Text style={s.eyebrow}>{pitch.eyebrow}</Text>

          {worth !== undefined && worth > 0 && currency ? (
            <>
              <Text style={s.worth} numberOfLines={1} adjustsFontSizeToFit testID="paywall-worth">
                {fmtMoney(worth, currency)}
              </Text>
              <Text style={s.worthSub}>a year, sitting in findings you cannot read yet</Text>
            </>
          ) : (
            <Text style={s.title}>{pitch.title}</Text>
          )}

          <View style={s.points}>
            {pitch.points.map((p, i) => (
              <Animated.View
                key={p.text}
                entering={FadeInDown.delay(90 + i * 60).duration(360)}
                style={s.point}
              >
                <View style={s.pointIcon}>
                  <Ionicons name={p.icon} size={14} color={theme.color.brandPrimary} />
                </View>
                <Text style={s.pointText}>{p.text}</Text>
              </Animated.View>
            ))}
          </View>

          {error && (
            <Animated.View entering={FadeIn.duration(240)} style={s.error}>
              <Ionicons name="alert-circle" size={15} color={theme.color.brandDeep} />
              <Text style={s.errorText} testID="paywall-error">{error}</Text>
            </Animated.View>
          )}

          {/* Through Press like every other primary button. This was the last
              bare Pressable in the app, which meant the one tap the whole screen
              exists to earn was the one that did not answer. */}
          <Press
            onPress={purchase}
            disabled={busy || !buyable}
            haptic="medium"
            style={s.buyWrap}
            accessibilityLabel={price ? `${pitch.cta} for ${price}` : pitch.cta}
            testID="paywall-buy"
          >
            <LinearGradient
              colors={theme.color.coralGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.buy}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={s.buyText}>
                  {!storeAvailable
                    ? 'Purchases not available yet'
                    : !ready || !price
                      ? 'Checking price…'
                      : `${pitch.cta} · ${price}`}
                </Text>
              )}
            </LinearGradient>
          </Press>

          <Text style={s.footnote}>{pitch.footnote}</Text>

          <Pressable onPress={onClose} style={s.dismiss} testID="paywall-dismiss">
            <Text style={s.dismissText}>Not now</Text>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

/**
 * The overlay on a finding the user has not paid for.
 *
 * Deliberately not a blur. Blurred text reads as "there are words here" and the
 * eye slides off it; a solid panel that states the amount and the category is a
 * specific gap, and a specific gap is what makes someone tap. The number is real
 * and the identity is not shown — that asymmetry is the entire offer.
 */
export function LockedOverlay({ amount, label }: { amount: string; label: string }) {
  return (
    <View style={s.locked} testID="locked-overlay">
      <View style={s.lockBadge}>
        <Ionicons name="lock-closed" size={12} color="#FFFFFF" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.lockedLabel} numberOfLines={2}>{label}</Text>
        <Text style={s.lockedHint}>Tap to see which one, and what to do</Text>
      </View>
      <Text style={s.lockedAmount}>{amount}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,16,14,0.55)' },

  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '88%',
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: 30, borderTopRightRadius: 30,
    paddingHorizontal: 26, paddingTop: 12,
  },
  grabber: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: theme.color.border, marginBottom: 18,
  },

  eyebrow: {
    color: theme.color.brandPrimary, fontSize: 11, fontWeight: '800',
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  title: {
    color: theme.color.ink, fontSize: 27, fontWeight: '800',
    letterSpacing: -0.9, lineHeight: 33, marginTop: 6,
  },
  worth: {
    color: theme.color.ink, fontSize: 46, fontWeight: '800',
    letterSpacing: -2, marginTop: 4,
  },
  worthSub: { color: theme.color.inkSoft, fontSize: 13.5, lineHeight: 19, marginTop: 2 },

  points: { gap: 12, marginTop: 22 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pointIcon: {
    width: 28, height: 28, borderRadius: 10,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  pointText: { flex: 1, color: theme.color.ink, fontSize: 13.5, fontWeight: '600', lineHeight: 19 },

  error: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#FDECE7', borderRadius: 14, padding: 12, marginTop: 18,
  },
  errorText: { flex: 1, color: theme.color.brandDeep, fontSize: 12.5, lineHeight: 18, fontWeight: '600' },

  buyWrap: { marginTop: 22, borderRadius: theme.radius.pill, overflow: 'hidden' },
  buy: { height: 56, alignItems: 'center', justifyContent: 'center' },
  buyText: { color: '#FFFFFF', fontSize: 15.5, fontWeight: '800' },

  footnote: {
    color: theme.color.inkMuted, fontSize: 11.5, lineHeight: 17,
    textAlign: 'center', marginTop: 12, paddingHorizontal: 8,
  },
  dismiss: { alignItems: 'center', paddingVertical: 14 },
  dismissText: { color: theme.color.inkSoft, fontSize: 13.5, fontWeight: '700' },

  locked: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: 14, padding: 12,
  },
  lockBadge: {
    width: 26, height: 26, borderRadius: 9,
    backgroundColor: theme.color.inkMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  lockedLabel: { color: theme.color.ink, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  lockedHint: { color: theme.color.inkMuted, fontSize: 11, fontWeight: '600', marginTop: 2 },
  lockedAmount: { color: theme.color.brandPrimary, fontSize: 15.5, fontWeight: '800', letterSpacing: -0.4 },
});
