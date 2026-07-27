import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Svg, { Circle, G } from 'react-native-svg';
import { theme, IMAGES, CATEGORY_COLORS } from '@/src/theme';
import { useAuth, monthlyEquivalent } from '@/src/auth-context';
import { BrandAvatar, formatMoney, formatMoneyRounded } from '@/src/ui';
import { convertToPrimary, fmtMoney } from '@/src/currency';
import { Subscription } from '@/src/api';
import { differenceInCalendarDays, parseISO, format } from 'date-fns';
import { RemindersSection } from '@/src/reminders';
import { getNotifPermission, requestNotifPermission, rescheduleReminders } from '@/src/notifications';

function AnimatedCounter({ value, currency }: { value: number; currency: string }) {
  const [displayed, setDisplayed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const dur = 900;
    let raf = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3); // cubic-out
      setDisplayed(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <Text
      style={hStyles.heroAmount}
      testID="dashboard-total-amount"
      numberOfLines={1}
      adjustsFontSizeToFit
    >
      {fmtMoney(displayed, currency)}
    </Text>
  );
}

function DonutChart({ data, total }: { data: { key: string; value: number }[]; total: number }) {
  const size = 160;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <Svg width={size} height={size}>
      <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.color.surfaceSecondary} strokeWidth={stroke} fill="none" />
        {data.map((d) => {
          const frac = total > 0 ? d.value / total : 0;
          const dash = c * frac;
          const el = (
            <Circle
              key={d.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={CATEGORY_COLORS[d.key] || theme.color.brand}
              strokeWidth={stroke}
              fill="none"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += dash;
          return el;
        })}
      </G>
    </Svg>
  );
}

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, subs, refreshSubs, refreshReminders } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [notifPromptShown, setNotifPromptShown] = useState(false);
  const [notifState, setNotifState] = useState<'unknown' | 'granted' | 'denied' | 'blocked' | 'unsupported'>('unknown');

  useEffect(() => {
    (async () => {
      const { state } = await getNotifPermission();
      setNotifState(state === 'undetermined' ? 'unknown' : (state as any));
      if (state === 'granted') {
        rescheduleReminders(subs);
      }
    })();
  }, [subs]);

  const promptForNotifs = async () => {
    setNotifPromptShown(true);
    const r = await requestNotifPermission();
    setNotifState(r === 'undetermined' ? 'unknown' : (r as any));
    if (r === 'granted') {
      await rescheduleReminders(subs);
    }
  };

  const activeSubs = subs.filter((s) => s.status === 'active');
  const primaryCurrency = (user?.primary_currency || 'INR').toUpperCase();

  const monthly = useMemo(
    () => activeSubs.reduce((sum, s) => sum + convertToPrimary(monthlyEquivalent(s), s.currency, primaryCurrency), 0),
    [activeSubs, primaryCurrency],
  );
  const yearly = monthly * 12;

  const byCat = useMemo(() => {
    const m: Record<string, number> = {};
    activeSubs.forEach((s) => {
      const v = convertToPrimary(monthlyEquivalent(s), s.currency, primaryCurrency);
      m[s.category] = (m[s.category] || 0) + v;
    });
    return Object.entries(m).map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
  }, [activeSubs, primaryCurrency]);

  const upcoming = useMemo(() => {
    return [...activeSubs]
      .sort((a, b) => parseISO(a.next_renewal).getTime() - parseISO(b.next_renewal).getTime())
      .slice(0, 8);
  }, [activeSubs]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshSubs(), refreshReminders()]);
    setRefreshing(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.brand} />}
        showsVerticalScrollIndicator={false}
        testID="dashboard-scroll"
      >
        {/* Hero */}
        <View style={[hStyles.hero, { paddingTop: insets.top + 24 }]}>
          <Image source={IMAGES.heroMesh} style={StyleSheet.absoluteFillObject} contentFit="cover" />
          <LinearGradient
            colors={['rgba(253,251,247,0)', 'rgba(253,251,247,0.35)', theme.color.surface]}
            locations={[0, 0.6, 1]}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={hStyles.heroTop}>
            <View>
              <Text style={hStyles.greeting}>Welcome back,</Text>
              <Text style={hStyles.name}>{user?.name || 'friend'}</Text>
            </View>
            <Pressable
              onPress={() => router.push('/(tabs)/profile')}
              style={hStyles.avatarBtn}
              testID="dashboard-avatar"
            >
              <Text style={hStyles.avatarText}>{(user?.name || 'A').charAt(0).toUpperCase()}</Text>
            </Pressable>
          </View>

          <Animated.View entering={FadeInDown.duration(500)} style={hStyles.heroCard}>
            <Text style={hStyles.heroLabel}>Total monthly · {primaryCurrency}</Text>
            <AnimatedCounter value={monthly} currency={primaryCurrency} />
            <View style={hStyles.heroRow}>
              <View style={hStyles.heroChip}>
                <Ionicons name="trending-up" size={14} color={theme.color.brandSecondary} />
                <Text style={hStyles.heroChipText}>{formatMoneyRounded(yearly, primaryCurrency)} / year</Text>
              </View>
              <View style={hStyles.heroChip}>
                <View style={[hStyles.dot, { backgroundColor: theme.color.brandPrimary }]} />
                <Text style={hStyles.heroChipText}>{activeSubs.length} active</Text>
              </View>
            </View>
          </Animated.View>
        </View>

        {/* Reminders — appears above scan actions when there are any */}
        <RemindersSection />

        {/* Notification permission prompt (only after user has some reminders and hasn't granted yet) */}
        {(notifState === 'unknown' || notifState === 'denied') && !notifPromptShown && (
          <View style={hStyles.notifPrompt} testID="dashboard-notif-prompt">
            <Ionicons name="notifications-outline" size={18} color={theme.color.brandSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={hStyles.notifTitle}>Get renewal reminders on your phone</Text>
              <Text style={hStyles.notifSub}>{'We\'ll ping you a few days before charges hit.'}</Text>
            </View>
            <Pressable onPress={promptForNotifs} style={hStyles.notifBtn} testID="dashboard-enable-notifs">
              <Text style={hStyles.notifBtnText}>Enable</Text>
            </Pressable>
          </View>
        )}

        {/* Actions */}
        <View style={hStyles.actionsRow}>
          <Pressable
            onPress={() => router.push('/subscription/new')}
            style={({ pressed }) => [hStyles.addBtn, pressed && { opacity: 0.9 }]}
            testID="dashboard-add-sub"
          >
            <LinearGradient
              colors={theme.color.coralGradient}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={hStyles.addInner}
            >
              <Ionicons name="add-circle-outline" size={20} color="#FFFFFF" />
              <View style={{ flex: 1 }}>
                <Text style={hStyles.addTitle}>Add a subscription</Text>
                <Text style={hStyles.addSub}>Track what you actually pay for</Text>
              </View>
              <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
            </LinearGradient>
          </Pressable>
        </View>

        {/* Gmail scan — reads receipts and cancellation emails to find subs the
            user never got round to adding by hand. */}
        <Pressable
          onPress={() => router.push('/scan')}
          style={({ pressed }) => [hStyles.scanBtn, pressed && { opacity: 0.9 }]}
          testID="dashboard-scan-gmail"
        >
          <View style={hStyles.scanIcon}>
            <Ionicons name="mail-open-outline" size={19} color={theme.color.brandSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={hStyles.scanTitle}>Scan Gmail for subscriptions</Text>
            <Text style={hStyles.scanSub}>Finds what you pay for — and what you already cancelled</Text>
          </View>
          <Ionicons name="arrow-forward" size={18} color={theme.color.inkMuted} />
        </Pressable>

        {/* Category donut */}
        <View style={hStyles.section}>
          <Text style={hStyles.sectionTitle}>Spending mix</Text>
          <View style={hStyles.donutCard}>
            {byCat.length > 0 ? (
              <>
                <View>
                  <DonutChart data={byCat} total={monthly} />
                  <View style={hStyles.donutCenter} pointerEvents="none">
                    <Text style={hStyles.donutTotal}>{formatMoneyRounded(monthly, primaryCurrency)}</Text>
                    <Text style={hStyles.donutLabel}>per month</Text>
                  </View>
                </View>
                <View style={{ flex: 1, marginLeft: 20, gap: 10 }}>
                  {byCat.slice(0, 5).map((c) => (
                    <View key={c.key} style={hStyles.legendRow}>
                      <View style={[hStyles.legendDot, { backgroundColor: CATEGORY_COLORS[c.key] || theme.color.brand }]} />
                      <Text style={hStyles.legendKey} numberOfLines={1}>{c.key}</Text>
                      <Text style={hStyles.legendVal}>{formatMoneyRounded(c.value, primaryCurrency)}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : (
              <Text style={hStyles.emptyText}>Add a subscription to see your mix.</Text>
            )}
          </View>
        </View>

        {/* Upcoming */}
        <View style={hStyles.section}>
          <View style={hStyles.sectionHeader}>
            <Text style={hStyles.sectionTitle}>Coming up</Text>
            <Pressable onPress={() => router.push('/(tabs)/calendar')} testID="dashboard-see-all">
              <Text style={hStyles.seeAll}>See all →</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, gap: 12 }}>
            {upcoming.map((s, idx) => {
              const daysLeft = differenceInCalendarDays(parseISO(s.next_renewal), new Date());
              return (
                <Animated.View key={s.id} entering={FadeInDown.delay(idx * 40).duration(400)}>
                  <Pressable
                    onPress={() => router.push({ pathname: '/subscription/[id]', params: { id: s.id } })}
                    style={hStyles.upcomingCard}
                    testID={`upcoming-${s.name}`}
                  >
                    <BrandAvatar sub={s} size={40} />
                    <Text style={hStyles.upcomingName} numberOfLines={1}>{s.name}</Text>
                    <Text style={hStyles.upcomingAmt}>{formatMoney(s.amount, s.currency)}</Text>
                    <View style={hStyles.upcomingDaysWrap}>
                      <Text style={hStyles.upcomingDays}>
                        {daysLeft <= 0 ? 'Today' : `in ${daysLeft}d`}
                      </Text>
                    </View>
                  </Pressable>
                </Animated.View>
              );
            })}
            {upcoming.length === 0 && <Text style={hStyles.emptyText}>Nothing coming up.</Text>}
          </ScrollView>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
  );
}

const hStyles = StyleSheet.create({
  hero: { paddingHorizontal: 24, paddingBottom: 24, minHeight: 320 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greeting: { color: theme.color.inkSoft, fontSize: 13, fontWeight: '500' },
  name: { color: theme.color.ink, fontSize: 22, fontWeight: '700', letterSpacing: -0.4, marginTop: 2 },
  avatarBtn: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: theme.color.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  heroCard: {
    marginTop: 28, backgroundColor: 'rgba(255,255,255,0.75)',
    borderRadius: 28, padding: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#B84A32', shadowOpacity: 0.1, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 6,
  },
  heroLabel: {
    color: theme.color.brandPrimary, fontSize: 11, fontWeight: '700',
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  heroAmount: { color: theme.color.ink, fontSize: 56, fontWeight: '800', letterSpacing: -2, marginTop: 6 },
  heroRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  heroChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: theme.color.surface, borderRadius: theme.radius.pill,
    paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: theme.color.border,
  },
  heroChipText: { color: theme.color.ink, fontSize: 12, fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  notifPrompt: {
    marginTop: 12, marginHorizontal: 24, padding: 14, borderRadius: 20,
    backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  notifTitle: { color: theme.color.ink, fontSize: 13, fontWeight: '700' },
  notifSub: { color: theme.color.inkSoft, fontSize: 11, marginTop: 2 },
  notifBtn: { backgroundColor: theme.color.ink, paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill },
  notifBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  actionsRow: { flexDirection: 'row', paddingHorizontal: 24, gap: 12, marginTop: 8 },
  addBtn: { flex: 1, borderRadius: 20, overflow: 'hidden' },
  addInner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 16 },
  addTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  addSub: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 2 },
  scanBtn: {
    marginHorizontal: 24, marginTop: 12, padding: 14, borderRadius: 20,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: theme.color.border,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  scanIcon: {
    width: 38, height: 38, borderRadius: 13, backgroundColor: theme.color.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  scanTitle: { color: theme.color.ink, fontSize: 14, fontWeight: '700' },
  scanSub: { color: theme.color.inkSoft, fontSize: 11, marginTop: 2 },
  section: { marginTop: 28 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, marginBottom: 12 },
  sectionTitle: { color: theme.color.ink, fontSize: 18, fontWeight: '700', letterSpacing: -0.4, paddingHorizontal: 24, marginBottom: 12 },
  seeAll: { color: theme.color.brandSecondary, fontSize: 13, fontWeight: '600' },
  donutCard: {
    marginHorizontal: 24, padding: 20, backgroundColor: '#FFFFFF',
    borderRadius: 24, borderWidth: 1, borderColor: theme.color.border,
    flexDirection: 'row', alignItems: 'center',
  },
  donutCenter: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  donutTotal: { color: theme.color.ink, fontSize: 18, fontWeight: '800', letterSpacing: -0.5 },
  donutLabel: { color: theme.color.inkSoft, fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendKey: { color: theme.color.ink, fontSize: 13, fontWeight: '600', flex: 1 },
  legendVal: { color: theme.color.inkSoft, fontSize: 13, fontWeight: '600' },
  emptyText: { color: theme.color.inkSoft, textAlign: 'center', paddingVertical: 20, paddingHorizontal: 24, fontSize: 13 },
  upcomingCard: {
    width: 140, backgroundColor: '#FFFFFF', borderRadius: 20, padding: 14,
    borderWidth: 1, borderColor: theme.color.border, gap: 10,
  },
  upcomingName: { color: theme.color.ink, fontSize: 14, fontWeight: '700', marginTop: 4 },
  upcomingAmt: { color: theme.color.brandPrimary, fontSize: 15, fontWeight: '800' },
  upcomingDaysWrap: {
    alignSelf: 'flex-start', backgroundColor: theme.color.surfaceSecondary,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill,
  },
  upcomingDays: { color: theme.color.inkSoft, fontSize: 11, fontWeight: '600' },
});
