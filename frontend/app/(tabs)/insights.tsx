import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { theme, IMAGES, CATEGORY_COLORS } from '@/src/theme';
import { useAuth, monthlyEquivalent } from '@/src/auth-context';
import { formatMoney, formatMoneyRounded } from '@/src/ui';
import { convertToPrimary } from '@/src/currency';
import { upgradeToPro } from '@/src/api';

export default function InsightsScreen() {
  const insets = useSafeAreaInsets();
  const { user, subs, refreshSubs, refreshUser, setPro } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  const isPro = user?.is_pro ?? false;

  // The old backend computed this in GET /insights. With the whole list already
  // in context there is nothing to fetch — deriving it keeps the numbers in
  // lockstep with the dashboard, which computes its totals the same way.
  const data = useMemo(() => {
    const primary = (user?.primary_currency || 'INR').toUpperCase();
    const active = subs.filter((s) => s.status === 'active');

    const by_category: Record<string, number> = {};
    let monthly = 0;
    let priciest: { name: string; monthly: number } | null = null;

    for (const s of active) {
      const v = convertToPrimary(monthlyEquivalent(s), s.currency, primary);
      monthly += v;
      by_category[s.category] = (by_category[s.category] || 0) + v;
      if (!priciest || v > priciest.monthly) priciest = { name: s.name, monthly: v };
    }

    const ranked = Object.entries(by_category).sort(([, a], [, b]) => b - a);
    const top_category = ranked[0]?.[0] ?? '—';
    const money = (n: number) => formatMoneyRounded(n, primary);

    const basic_summary = active.length === 0
      ? 'No active subscriptions yet. Add one to see where your money actually goes.'
      : `You're spending ${money(monthly)}/month across ${active.length} active `
        + `${active.length === 1 ? 'subscription' : 'subscriptions'}. `
        + `Your top category is ${top_category} (${money(by_category[top_category])}/mo).`;

    // Deterministic, data-derived prompts. Genuinely useful, and honest — real
    // LLM tips need a Supabase Edge Function to hold the API key server-side.
    const savings_tip = priciest
      ? `${priciest.name} is your largest line item at ${money(priciest.monthly)}/month — `
        + `${money(priciest.monthly * 12)} a year. Worth checking if a cheaper tier covers you.`
      : 'Add a few subscriptions and this will show you where to cut first.';

    const paused = subs.filter((s) => s.status === 'paused').length;
    const yearlyPlans = active.filter((s) => s.billing_cycle === 'yearly').length;
    const unused_alert = paused > 0
      ? `You have ${paused} paused ${paused === 1 ? 'subscription' : 'subscriptions'}. `
        + 'If you have not missed them, cancel outright so they cannot silently resume.'
      : yearlyPlans > 0
        ? `${yearlyPlans} of your plans renew yearly — easy to forget. `
          + 'Those charges are the ones that catch people out.'
        : 'Nothing looks dormant right now. Check back after a few renewal cycles.';

    return {
      primary_currency: primary,
      monthly_total: monthly,
      yearly_projected: monthly * 12,
      top_category,
      by_category,
      basic_summary,
      pro_savings_tip: savings_tip,
      pro_unused_alert: unused_alert,
    };
  }, [subs, user?.primary_currency]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshSubs();
    } finally {
      setRefreshing(false);
    }
  };

  const upgrade = async () => {
    setUpgrading(true);
    try {
      await upgradeToPro();
      setPro(true);
      await refreshUser();
    } finally { setUpgrading(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 20, paddingBottom: insets.bottom + 110 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.brand} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: 24 }}>
          <Text style={styles.eyebrow}>AI Insights</Text>
          <Text style={styles.title}>Understand your{'\n'}spending, effortlessly.</Text>
        </View>

        {(
          <>
            {/* Hero AI card */}
            <Animated.View entering={FadeInDown.duration(500)} style={styles.aiCardWrap}>
              <LinearGradient colors={theme.color.coralGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.aiCard}>
                <View style={styles.aiChip}>
                  <Ionicons name="sparkles" size={12} color="#FFFFFF" />
                  <Text style={styles.aiChipText}>AI Summary</Text>
                </View>
                <Text style={styles.aiText}>{data.basic_summary}</Text>
                <View style={styles.aiStats}>
                  <View style={styles.aiStat}>
                    <Text style={styles.aiStatVal} numberOfLines={1} adjustsFontSizeToFit>{formatMoneyRounded(data.monthly_total, data.primary_currency)}</Text>
                    <Text style={styles.aiStatLabel}>Monthly</Text>
                  </View>
                  <View style={styles.aiDivider} />
                  <View style={styles.aiStat}>
                    <Text style={styles.aiStatVal} numberOfLines={1} adjustsFontSizeToFit>{formatMoneyRounded(data.yearly_projected, data.primary_currency)}</Text>
                    <Text style={styles.aiStatLabel}>Yearly</Text>
                  </View>
                  <View style={styles.aiDivider} />
                  <View style={styles.aiStat}>
                    <Text style={styles.aiStatVal} numberOfLines={1}>{data.top_category}</Text>
                    <Text style={styles.aiStatLabel}>Top category</Text>
                  </View>
                </View>
              </LinearGradient>
            </Animated.View>

            {/* Category bars */}
            {data.by_category && Object.keys(data.by_category).length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Where it goes</Text>
                <View style={styles.categoriesCard}>
                  {Object.entries(data.by_category)
                    .sort(([, a], [, b]) => b - a)
                    .map(([cat, amount], i) => {
                      const pct = data.monthly_total > 0 ? (amount / data.monthly_total) * 100 : 0;
                      return (
                        <Animated.View key={cat} entering={FadeIn.delay(i * 80)} style={styles.barRow}>
                          <View style={styles.barHeader}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <View style={[styles.catDot, { backgroundColor: CATEGORY_COLORS[cat] || theme.color.brand }]} />
                              <Text style={styles.barCat}>{cat}</Text>
                            </View>
                            <Text style={styles.barAmount}>{formatMoney(amount)}</Text>
                          </View>
                          <View style={styles.barTrack}>
                            <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: CATEGORY_COLORS[cat] || theme.color.brand }]} />
                          </View>
                        </Animated.View>
                      );
                    })}
                </View>
              </View>
            )}

            {/* Pro insights */}
            <View style={styles.section}>
              <View style={styles.proHeader}>
                <Text style={styles.sectionTitle}>Smart tips</Text>
                {!isPro && (
                  <View style={styles.proBadge}>
                    <Ionicons name="lock-closed" size={11} color={theme.color.gold} />
                    <Text style={styles.proBadgeText}>PRO</Text>
                  </View>
                )}
              </View>

              <View style={styles.proTipsWrap}>
                <View style={styles.proTip}>
                  <View style={[styles.proIcon, { backgroundColor: '#0D948820' }]}>
                    <Ionicons name="trending-down" size={16} color={theme.color.brandSecondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.proTipLabel}>Savings tip</Text>
                    <Text style={styles.proTipText}>{data.pro_savings_tip}</Text>
                  </View>
                </View>
                <View style={styles.proTip}>
                  <View style={[styles.proIcon, { backgroundColor: '#E87A5D20' }]}>
                    <Ionicons name="warning-outline" size={16} color={theme.color.brandPrimary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.proTipLabel}>Unused alert</Text>
                    <Text style={styles.proTipText}>{data.pro_unused_alert}</Text>
                  </View>
                </View>

                {!isPro && (
                  <BlurView intensity={22} tint="light" style={styles.blurOverlay}>
                    <View style={styles.blurInner}>
                      <View style={styles.starBadge}>
                        <Ionicons name="sparkles" size={16} color={theme.color.gold} />
                      </View>
                      <Text style={styles.upgradeTitle}>Unlock Pro Insights</Text>
                      <Text style={styles.upgradeSub}>Personalized savings tips & unused-sub alerts, powered by AI.</Text>
                      <Pressable
                        onPress={upgrade}
                        disabled={upgrading}
                        style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1, marginTop: 16 }]}
                        testID="insights-upgrade"
                      >
                        <LinearGradient colors={theme.color.proGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.upgradeBtn}>
                          {upgrading ? (
                            <ActivityIndicator color="#FFFFFF" />
                          ) : (
                            <>
                              <Ionicons name="star" size={16} color={theme.color.gold} />
                              <Text style={styles.upgradeBtnText}>Upgrade to Pro</Text>
                            </>
                          )}
                        </LinearGradient>
                      </Pressable>
                    </View>
                  </BlurView>
                )}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: theme.color.brandPrimary, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { color: theme.color.ink, fontSize: 30, fontWeight: '800', letterSpacing: -0.8, lineHeight: 36, marginTop: 4 },
  aiCardWrap: { marginTop: 22, marginHorizontal: 24, borderRadius: 24, overflow: 'hidden' },
  aiCard: { padding: 22 },
  aiChip: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.25)', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: theme.radius.pill,
  },
  aiChipText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  aiText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600', lineHeight: 24, marginTop: 14 },
  aiStats: { flexDirection: 'row', marginTop: 20, backgroundColor: 'rgba(0,0,0,0.12)', borderRadius: 16, padding: 12 },
  aiStat: { flex: 1, alignItems: 'center' },
  aiStatVal: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: -0.3 },
  aiStatLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 3 },
  aiDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: 8 },
  section: { marginTop: 28 },
  sectionTitle: { color: theme.color.ink, fontSize: 18, fontWeight: '700', letterSpacing: -0.4, paddingHorizontal: 24, marginBottom: 14 },
  categoriesCard: {
    marginHorizontal: 24, padding: 18, backgroundColor: '#FFFFFF',
    borderRadius: 24, borderWidth: 1, borderColor: theme.color.border, gap: 14,
  },
  barRow: { gap: 8 },
  barHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  catDot: { width: 10, height: 10, borderRadius: 5 },
  barCat: { color: theme.color.ink, fontSize: 14, fontWeight: '600' },
  barAmount: { color: theme.color.inkSoft, fontSize: 13, fontWeight: '700' },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: theme.color.surfaceSecondary, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  proHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, marginBottom: 14 },
  proBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.color.ink, paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill },
  proBadgeText: { color: theme.color.gold, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  proTipsWrap: { marginHorizontal: 24, borderRadius: 24, overflow: 'hidden', position: 'relative' },
  proTip: {
    flexDirection: 'row', gap: 14, padding: 18, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: theme.color.border, borderRadius: 20, marginBottom: 10,
    alignItems: 'flex-start',
  },
  proIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  proTipLabel: { color: theme.color.brandPrimary, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  proTipText: { color: theme.color.ink, fontSize: 14, fontWeight: '600', marginTop: 4, lineHeight: 20 },
  blurOverlay: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
    borderRadius: 24, overflow: 'hidden',
    backgroundColor: 'rgba(253,251,247,0.4)',
  },
  blurInner: { alignItems: 'center', paddingHorizontal: 32 },
  starBadge: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: theme.color.ink,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  upgradeTitle: { color: theme.color.ink, fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  upgradeSub: { color: theme.color.inkSoft, fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 18 },
  upgradeBtn: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, paddingHorizontal: 24, borderRadius: theme.radius.pill,
    shadowColor: '#1A1C1E', shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 6,
  },
  upgradeBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', letterSpacing: 0.3 },
});
