import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown, useAnimatedProps, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import Svg, { Circle, G } from 'react-native-svg';
import { theme, IMAGES, CATEGORY_COLORS } from '@/src/theme';
import { useAuth, monthlyEquivalent } from '@/src/auth-context';
import { BrandAvatar, formatMoney } from '@/src/ui';
import { api, Subscription } from '@/src/api';
import { differenceInCalendarDays, parseISO, format } from 'date-fns';

const AnimatedText = Animated.createAnimatedComponent(Text);

function AnimatedCounter({ value }: { value: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(value, { duration: 900, easing: Easing.out(Easing.cubic) });
  }, [value, progress]);
  const props: any = useAnimatedProps(() => ({
    text: `$${progress.value.toFixed(2)}`,
    defaultValue: `$${progress.value.toFixed(2)}`,
  }));
  return (
    <AnimatedText
      style={hStyles.heroAmount}
      animatedProps={props}
      testID="dashboard-total-amount"
    >{`$${value.toFixed(2)}`}</AnimatedText>
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
  const { user, subs, refreshSubs } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<any[] | null>(null);

  const activeSubs = subs.filter((s) => s.status === 'active');
  const monthly = useMemo(() => activeSubs.reduce((sum, s) => sum + monthlyEquivalent(s), 0), [activeSubs]);
  const yearly = monthly * 12;

  const byCat = useMemo(() => {
    const m: Record<string, number> = {};
    activeSubs.forEach((s) => { m[s.category] = (m[s.category] || 0) + monthlyEquivalent(s); });
    return Object.entries(m).map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
  }, [activeSubs]);

  const upcoming = useMemo(() => {
    return [...activeSubs]
      .sort((a, b) => parseISO(a.next_renewal).getTime() - parseISO(b.next_renewal).getTime())
      .slice(0, 8);
  }, [activeSubs]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshSubs();
    setRefreshing(false);
  };

  const runScan = async () => {
    setScanning(true);
    setScanResults(null);
    try {
      const r = await api<{ discovered: any[] }>('/subscriptions/scan-mail', { method: 'POST' });
      setScanResults(r.discovered);
    } finally {
      setScanning(false);
    }
  };

  const addDiscovered = async (item: any) => {
    const today = new Date();
    const nextRenew = new Date(today);
    nextRenew.setDate(today.getDate() + 15);
    await api<Subscription>('/subscriptions', {
      method: 'POST',
      body: {
        ...item,
        next_renewal: nextRenew.toISOString().split('T')[0],
        status: 'active',
      },
    });
    await refreshSubs();
    setScanResults((prev) => (prev || []).filter((x) => x.name !== item.name));
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
          <Image source={{ uri: IMAGES.heroMesh }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
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
            <Text style={hStyles.heroLabel}>Total monthly</Text>
            <AnimatedCounter value={monthly} />
            <View style={hStyles.heroRow}>
              <View style={hStyles.heroChip}>
                <Ionicons name="trending-up" size={14} color={theme.color.brandSecondary} />
                <Text style={hStyles.heroChipText}>{formatMoney(yearly)} / year</Text>
              </View>
              <View style={hStyles.heroChip}>
                <View style={[hStyles.dot, { backgroundColor: theme.color.brandPrimary }]} />
                <Text style={hStyles.heroChipText}>{activeSubs.length} active</Text>
              </View>
            </View>
          </Animated.View>
        </View>

        {/* Actions */}
        <View style={hStyles.actionsRow}>
          <Pressable
            onPress={runScan}
            style={({ pressed }) => [hStyles.scanBtn, pressed && { opacity: 0.9 }]}
            testID="dashboard-scan-gmail"
            disabled={scanning}
          >
            <LinearGradient
              colors={theme.color.proGradient}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={hStyles.scanInner}
            >
              <Ionicons name="mail-outline" size={18} color="#FFFFFF" />
              <View style={{ flex: 1 }}>
                <Text style={hStyles.scanTitle}>{scanning ? 'Scanning inbox…' : 'Scan Gmail for subs'}</Text>
                <Text style={hStyles.scanSub}>Uncover hidden charges</Text>
              </View>
              {scanning ? <ActivityIndicator color="#FFFFFF" /> : (
                <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
              )}
            </LinearGradient>
          </Pressable>
          <Pressable
            onPress={() => router.push('/subscription/new')}
            style={({ pressed }) => [hStyles.addBtn, pressed && { opacity: 0.9 }]}
            testID="dashboard-add-sub"
          >
            <Ionicons name="add" size={26} color={theme.color.ink} />
          </Pressable>
        </View>

        {scanResults && scanResults.length > 0 && (
          <View style={hStyles.scanResults} testID="dashboard-scan-results">
            <Text style={hStyles.sectionTitle}>Found in your inbox</Text>
            {scanResults.map((r) => (
              <View key={r.name} style={hStyles.scanRow}>
                <BrandAvatar sub={{ ...r, id: r.name, status: 'active', next_renewal: '' }} size={40} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={hStyles.scanRowTitle}>{r.name}</Text>
                  <Text style={hStyles.scanRowSub}>{formatMoney(r.amount)} · {r.billing_cycle}</Text>
                </View>
                <Pressable
                  onPress={() => addDiscovered(r)}
                  style={hStyles.trackBtn}
                  testID={`dashboard-track-${r.name}`}
                >
                  <Text style={hStyles.trackBtnText}>Track</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* Category donut */}
        <View style={hStyles.section}>
          <Text style={hStyles.sectionTitle}>Spending mix</Text>
          <View style={hStyles.donutCard}>
            {byCat.length > 0 ? (
              <>
                <View>
                  <DonutChart data={byCat} total={monthly} />
                  <View style={hStyles.donutCenter} pointerEvents="none">
                    <Text style={hStyles.donutTotal}>{formatMoney(monthly)}</Text>
                    <Text style={hStyles.donutLabel}>per month</Text>
                  </View>
                </View>
                <View style={{ flex: 1, marginLeft: 20, gap: 10 }}>
                  {byCat.slice(0, 5).map((c) => (
                    <View key={c.key} style={hStyles.legendRow}>
                      <View style={[hStyles.legendDot, { backgroundColor: CATEGORY_COLORS[c.key] || theme.color.brand }]} />
                      <Text style={hStyles.legendKey} numberOfLines={1}>{c.key}</Text>
                      <Text style={hStyles.legendVal}>{formatMoney(c.value)}</Text>
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
                    <Text style={hStyles.upcomingAmt}>{formatMoney(s.amount)}</Text>
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
    shadowColor: '#B84A32', shadowOpacity: 0.1, shadowRadius: 20, shadowOffset: { width: 0, height: 10 },
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
  actionsRow: { flexDirection: 'row', paddingHorizontal: 24, gap: 12, marginTop: 8 },
  scanBtn: { flex: 1, borderRadius: 20, overflow: 'hidden' },
  scanInner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 16 },
  scanTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  scanSub: { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 2 },
  addBtn: { width: 56, height: 56, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: theme.color.border, alignItems: 'center', justifyContent: 'center' },
  scanResults: {
    marginTop: 16, marginHorizontal: 24, padding: 16, borderRadius: 20,
    backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border,
  },
  scanRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  scanRowTitle: { color: theme.color.ink, fontSize: 15, fontWeight: '700' },
  scanRowSub: { color: theme.color.inkSoft, fontSize: 12, marginTop: 2 },
  trackBtn: { backgroundColor: theme.color.ink, paddingHorizontal: 16, paddingVertical: 8, borderRadius: theme.radius.pill },
  trackBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
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
