/**
 * Savings.
 *
 * The screen the paid unlock is for, so its whole job is to be believable. Three
 * things follow from that:
 *
 *   The arithmetic sits in front of the claim. Every finding shows the sum it
 *   came from, in words the user can check against their own bank statement.
 *
 *   Findings are grouped by how sure we are, strongest first, and each group
 *   says plainly what its confidence means. Mixing a fact derived from the
 *   user's own data in among guesses that depend on their phone plan makes the
 *   fact look like a guess.
 *
 *   Anything can be dismissed. The audit asks questions it cannot answer, and a
 *   list that keeps raising things you have already checked is one you stop
 *   reading — which costs far more than any single finding was worth.
 *
 * One finding is always readable in full, chosen by revealAudit as the cheapest
 * certain one. The locked ones show the money and hide the identity — see
 * entitlements.ts for why that asymmetry is the offer.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';

import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth-context';
import { Badge, BrandAvatar, Button, Card, EmptyState, formatMoney } from '@/src/ui';
import { CountUp, Press, Reveal, Skeleton } from '@/src/motion';
import { convertToPrimary, symbolFor, useExchangeRate } from '@/src/currency';
import { runAudit, type Saving, type SavingConfidence } from '@/src/savings';
import { LOCKED_LABEL, lockedCount, lockedValue, PRODUCTS, revealAudit } from '@/src/entitlements';
import { usePurchases } from '@/src/purchases';
import { UpgradeSheet } from '@/src/paywall';
import {
  activeIds, dismiss, readDismissals, restore, writeDismissals, type Dismissals,
} from '@/src/dismissals';

const CONFIDENCE: Record<
  SavingConfidence,
  { tone: 'success' | 'warning' | 'neutral'; heading: string; blurb: string }
> = {
  certain: {
    tone: 'success',
    heading: 'Confirmed',
    blurb: 'Arithmetic on your own subscriptions. These cannot be wrong.',
  },
  likely: {
    tone: 'warning',
    heading: 'Very likely',
    blurb: 'Checked against published prices, assuming your plan matches.',
  },
  check: {
    tone: 'neutral',
    heading: 'Worth a look',
    blurb: 'Depends on something only you know. Dismiss any that do not apply.',
  },
};

const ORDER: SavingConfidence[] = ['certain', 'likely', 'check'];

const ICON: Record<Saving['kind'], keyof typeof Ionicons.glyphMap> = {
  'trial-converting': 'hourglass',
  bundled: 'gift',
  'annual-switch': 'calendar',
  'price-rise': 'trending-up',
  overlap: 'copy',
  dormant: 'pause-circle',
};

export default function SavingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, subs, subsLoading, priceChanges, refreshSubs, refreshPriceChanges } = useAuth();
  const { unlocked } = usePurchases();

  const [refreshing, setRefreshing] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [dismissals, setDismissals] = useState<Dismissals>({});
  /** The last thing dismissed, so it can be put back without hunting for it. */
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null);

  const primary = (user?.primary_currency || 'INR').toUpperCase();
  const rate = useExchangeRate();

  useEffect(() => {
    void readDismissals().then(setDismissals);
  }, []);

  const hidden = useMemo(() => activeIds(dismissals), [dismissals]);

  const audit = useMemo(
    () =>
      runAudit(subs, priceChanges, {
        primaryCurrency: primary,
        convert: (amount, from, to) => convertToPrimary(amount, from, to, rate),
        dismissed: hidden,
      }),
    [subs, priceChanges, primary, rate, hidden],
  );

  const reveals = useMemo(() => revealAudit(audit.savings, unlocked), [audit.savings, unlocked]);
  const behindWall = lockedValue(reveals);
  const stillLocked = lockedCount(reveals);
  const found = audit.savings.length > 0;

  /** Grouped strongest-first, so a fact never sits beside a guess. */
  const groups = useMemo(
    () =>
      ORDER.map((confidence) => ({
        confidence,
        items: reveals.filter((r) => r.saving.confidence === confidence),
      })).filter((g) => g.items.length > 0),
    [reveals],
  );

  const hide = useCallback((f: Saving) => {
    setDismissals((prev) => {
      const next = dismiss(prev, f.id);
      void writeDismissals(next);
      return next;
    });
    setUndo({ id: f.id, name: f.sub.name });
  }, []);

  const putBack = useCallback(() => {
    if (!undo) return;
    setDismissals((prev) => {
      const next = restore(prev, undo.id);
      void writeDismissals(next);
      return next;
    });
    setUndo(null);
  }, [undo]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshSubs(), refreshPriceChanges()]);
    } finally {
      setRefreshing(false);
    }
  };

  const hiddenCount = hidden.size;

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 110 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.brand} />
        }
        showsVerticalScrollIndicator={false}
        testID="savings-scroll"
      >
        <View style={{ paddingHorizontal: 20 }}>
          <Text style={s.title}>Savings</Text>
          <Text style={s.subtitle}>
            Every subscription, checked against cheaper plans, bundles you already pay for, and
            prices that moved.
          </Text>
        </View>

        <Reveal delay={60} style={s.heroWrap}>
          <LinearGradient
            colors={found ? theme.color.coralGradient : theme.color.tealGradient}
            start={{ x: 0.05, y: 0 }}
            end={{ x: 0.95, y: 1 }}
            style={s.hero}
          >
            <Text style={s.heroLabel}>{found ? 'Money on the table' : 'Nothing to claim yet'}</Text>

            {subsLoading ? (
              <View style={{ height: 60, justifyContent: 'center' }}>
                <Skeleton width="65%" height={38} radius={12} style={s.heroSkeleton} />
              </View>
            ) : (
              <CountUp
                value={audit.totalAnnual}
                symbol={symbolFor(primary)}
                indian={primary === 'INR'}
                style={s.heroAmount}
                testID="savings-total"
              />
            )}

            <Text style={s.heroSub}>
              {found
                ? `a year, across ${audit.savings.length} ${audit.savings.length === 1 ? 'thing' : 'things'} worth acting on`
                : 'Add your subscriptions and we will audit them'}
            </Text>

            {audit.certainCount > 0 && (
              <View style={s.heroChip}>
                <Ionicons name="shield-checkmark" size={13} color="#FFFFFF" />
                <Text style={s.heroChipText}>
                  {audit.certainCount} confirmed by arithmetic, not guesswork
                </Text>
              </View>
            )}
          </LinearGradient>
        </Reveal>

        {subsLoading && (
          <View style={{ paddingHorizontal: 20, gap: 12, marginTop: 14 }} testID="savings-loading">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} width="100%" height={132} radius={theme.radius.lg} />
            ))}
          </View>
        )}

        {/* Laid out so a dismissal closes the gap it left rather than making the
            rest of the list jump. */}
        <Animated.View layout={LinearTransition.duration(220)}>
          {groups.map((g, gi) => (
            <View key={g.confidence} style={{ marginTop: gi === 0 ? 24 : 28 }}>
              <View style={s.groupHead}>
                <Badge label={CONFIDENCE[g.confidence].heading} tone={CONFIDENCE[g.confidence].tone} />
                <Text style={s.groupCount}>
                  {g.items.length} {g.items.length === 1 ? 'finding' : 'findings'}
                </Text>
              </View>
              <Text style={s.groupBlurb}>{CONFIDENCE[g.confidence].blurb}</Text>

              {g.items.map(({ saving: f, locked }, i) => (
                <Reveal key={f.id} index={i} delay={80} style={s.cardWrap}>
                  <Card
                    padded={false}
                    onPress={() =>
                      locked
                        ? setUpgrading(true)
                        : router.push({ pathname: '/subscription/[id]', params: { id: f.sub.id } })
                    }
                    testID={locked ? `saving-locked-${f.id}` : `saving-${f.sub.name}`}
                  >
                    <View style={s.cardBody}>
                      <View style={s.cardTop}>
                        {/* No brand avatar on a locked card — the logo is the answer. */}
                        {locked ? (
                          <View style={s.kindIcon}>
                            <Ionicons name={ICON[f.kind]} size={19} color={theme.color.inkMuted} />
                          </View>
                        ) : (
                          <BrandAvatar sub={f.sub} size={42} />
                        )}

                        <View style={{ flex: 1 }}>
                          <Text style={s.cardTitle} numberOfLines={2}>
                            {locked ? LOCKED_LABEL[f.kind] : f.title}
                          </Text>
                        </View>

                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={s.cardAmount}>{formatMoney(f.annualSaving, f.currency)}</Text>
                          <Text style={s.cardPer}>a year</Text>
                        </View>
                      </View>

                      {locked ? (
                        <View style={s.lockRow}>
                          <Ionicons name="lock-closed" size={13} color={theme.color.inkMuted} />
                          <Text style={s.lockText}>We know which one, and what to change</Text>
                          <Text style={s.lockCta}>Unlock</Text>
                        </View>
                      ) : (
                        <>
                          {/* The arithmetic, so nobody has to take our word for it. */}
                          <View style={s.detail}>
                            <Text style={s.detailText}>{f.detail}</Text>
                          </View>

                          <View style={s.actionRow}>
                            <Ionicons
                              name="arrow-forward-circle"
                              size={16}
                              color={theme.color.brandSecondary}
                            />
                            <Text style={s.actionText}>{f.action}</Text>
                          </View>

                          {/* Deliberately quiet: findable when a finding does not
                              apply, invisible the rest of the time. */}
                          <Press onPress={() => hide(f)} scale={0.94} testID={`dismiss-${f.id}`}>
                            <View style={s.dismiss}>
                              <Ionicons name="close" size={13} color={theme.color.inkMuted} />
                              <Text style={s.dismissText}>Not applicable to me</Text>
                            </View>
                          </Press>
                        </>
                      )}
                    </View>
                  </Card>
                </Reveal>
              ))}
            </View>
          ))}
        </Animated.View>

        {stillLocked > 0 && (
          <Reveal delay={220} style={{ paddingHorizontal: 20, marginTop: 22 }}>
            <Press onPress={() => setUpgrading(true)} haptic="medium" testID="savings-unlock">
              <LinearGradient
                colors={theme.color.inkGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[s.unlock, theme.shadow.md]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.unlockTitle}>Unlock {formatMoney(behindWall, primary)} a year</Text>
                  <Text style={s.unlockSub}>
                    {stillLocked} more {stillLocked === 1 ? 'finding' : 'findings'}, each with what to do
                  </Text>
                </View>
                <View style={s.unlockIcon}>
                  <Ionicons name="lock-open" size={18} color={theme.color.ink} />
                </View>
              </LinearGradient>
            </Press>
          </Reveal>
        )}

        {!subsLoading && !found && subs.length > 0 && (
          <EmptyState
            icon="shield-checkmark"
            tone="teal"
            title={hiddenCount > 0 ? 'Nothing left to act on' : 'Nothing wasteful found'}
            body="We checked for cheaper annual plans, subscriptions your telecom or card already includes, overlapping services, price rises, and trials about to charge."
            testID="savings-clean"
          />
        )}

        {!subsLoading && subs.length === 0 && (
          <EmptyState
            icon="mail-open-outline"
            title="Add subscriptions to audit"
            body="Scan your Gmail and we will find what you pay for — then check every one of them for money you should not be spending."
            actionLabel="Scan Gmail"
            onAction={() => router.push('/scan')}
            testID="savings-empty"
          />
        )}

        {/* Dismissals lapse. The screen says so rather than quietly hiding things
            the user can no longer find or reason about. */}
        {hiddenCount > 0 && (
          <View style={s.hiddenNote}>
            <Text style={s.hiddenText}>
              {hiddenCount} {hiddenCount === 1 ? 'finding' : 'findings'} dismissed. We will raise
              {hiddenCount === 1 ? ' it' : ' them'} again in six months, in case prices change.
            </Text>
            <Button
              label="Show them again"
              variant="ghost"
              size="sm"
              full={false}
              onPress={() => {
                setDismissals({});
                void writeDismissals({});
                setUndo(null);
              }}
              testID="savings-unhide"
            />
          </View>
        )}
      </ScrollView>

      {/* Undo floats above the tab bar. A dismissal is one tap, so undoing it
          must be too — otherwise a mis-tap costs a finding the user wanted. */}
      {undo !== null && (
        <Animated.View
          entering={FadeIn.duration(200)}
          style={[s.undo, { bottom: insets.bottom + 96 }]}
        >
          <Text style={s.undoText} numberOfLines={1}>Dismissed {undo.name}</Text>
          <Press onPress={putBack} scale={0.94} testID="savings-undo">
            <Text style={s.undoAction}>Undo</Text>
          </Press>
        </Animated.View>
      )}

      <UpgradeSheet
        product={PRODUCTS.pro}
        visible={upgrading}
        onClose={() => setUpgrading(false)}
        worth={behindWall}
        currency={primary}
      />
    </View>
  );
}

const s = StyleSheet.create({
  title: { ...theme.type.title1, color: theme.color.ink },
  subtitle: { ...theme.type.small, color: theme.color.inkSoft, fontWeight: '500', marginTop: 6 },

  heroWrap: {
    marginTop: 20, marginHorizontal: 20,
    borderRadius: theme.radius.xl, overflow: 'hidden', ...theme.shadow.md,
  },
  hero: { padding: 22 },
  heroLabel: { ...theme.type.overline, color: 'rgba(255,255,255,0.85)' },
  heroAmount: {
    color: '#FFFFFF', fontSize: 50, fontWeight: '800',
    letterSpacing: -2.4, marginTop: 4, height: 60,
  },
  heroSkeleton: { backgroundColor: 'rgba(255,255,255,0.28)' },
  heroSub: { color: 'rgba(255,255,255,0.9)', ...theme.type.small, fontWeight: '600' },
  heroChip: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: 'rgba(0,0,0,0.18)', paddingHorizontal: 11, paddingVertical: 7,
    borderRadius: theme.radius.pill, marginTop: 16,
  },
  heroChipText: { color: '#FFFFFF', fontSize: 11.5, fontWeight: '700' },

  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 20 },
  groupCount: { ...theme.type.caption, color: theme.color.inkMuted, fontWeight: '700' },
  groupBlurb: {
    ...theme.type.caption, color: theme.color.inkMuted,
    paddingHorizontal: 20, marginTop: 5, lineHeight: 16,
  },

  cardWrap: { paddingHorizontal: 20, marginTop: 12 },
  cardBody: { padding: 16, gap: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  kindIcon: {
    width: 42, height: 42, borderRadius: 14,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { ...theme.type.bodyStrong, color: theme.color.ink, fontSize: 14.5, lineHeight: 19 },
  cardAmount: { color: theme.color.brandPrimary, fontSize: 17, fontWeight: '800', letterSpacing: -0.5 },
  cardPer: { ...theme.type.caption, color: theme.color.inkMuted, fontSize: 10 },

  detail: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.md, padding: 12,
  },
  detailText: { ...theme.type.small, color: theme.color.inkSoft, fontWeight: '500', lineHeight: 19 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionText: { color: theme.color.brandSecondaryDeep, ...theme.type.small, fontWeight: '700', flex: 1 },

  dismiss: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 6, paddingRight: 12,
  },
  dismissText: { ...theme.type.caption, color: theme.color.inkMuted, fontWeight: '600' },

  lockRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.md, padding: 12,
  },
  lockText: { flex: 1, ...theme.type.caption, color: theme.color.inkSoft },
  lockCta: { ...theme.type.caption, color: theme.color.brandPrimary, fontWeight: '800' },

  unlock: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: theme.radius.lg, padding: 18,
  },
  unlockTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: -0.4 },
  unlockSub: { color: 'rgba(252,250,247,0.7)', ...theme.type.caption, marginTop: 3 },
  unlockIcon: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },

  hiddenNote: {
    marginTop: 26, marginHorizontal: 20, padding: 16,
    borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceSecondary,
    alignItems: 'flex-start', gap: 6,
  },
  hiddenText: { ...theme.type.caption, color: theme.color.inkSoft, lineHeight: 17 },

  undo: {
    position: 'absolute', left: 20, right: 20,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.color.inverse,
    borderRadius: theme.radius.pill, paddingVertical: 13, paddingHorizontal: 18,
    ...theme.shadow.lg,
  },
  undoText: { flex: 1, color: theme.color.onInverse, ...theme.type.small, fontWeight: '600' },
  undoAction: { color: theme.color.brand, ...theme.type.small, fontWeight: '800' },
});
