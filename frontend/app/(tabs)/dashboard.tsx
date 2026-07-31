/**
 * Home.
 *
 * The screen answers one question before any others: what is this costing me?
 * So the monthly figure is the largest thing here by a wide margin, counts up
 * on arrival, and everything else is arranged as context around it.
 *
 * Order is by urgency, not by category. Trials come first because they are the
 * only thing on this screen with a deadline; price rises next because they are
 * money already leaking; then reminders, then the tools, then the analysis.
 * A dashboard sorted by what is easiest to render is how everything ends up
 * looking equally important.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, RefreshControl, ScrollView, InteractionManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { differenceInCalendarDays, parseISO } from 'date-fns';

import { theme, CATEGORY_COLORS } from '@/src/theme';
import { useAuth, monthlyEquivalent } from '@/src/auth-context';
import {
  Badge, BrandAvatar, Card, EmptyState, SectionHeader, formatMoney, formatMoneyRounded,
} from '@/src/ui';
import { CountUp, Meter, Press, Reveal, Skeleton, useCollapsingHeader } from '@/src/motion';
import { convertToPrimary, symbolFor, useExchangeRate } from '@/src/currency';
import { dismissPriceChange } from '@/src/api';
import { activeTrials, splitByTrial, trialDaysLeft, trialLabel } from '@/src/trials';
import { findPriceRises } from '@/src/price-watch';
import { RemindersSection } from '@/src/reminders';
import { getNotifPermission, requestNotifPermission, rescheduleReminders } from '@/src/notifications';

const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

/**
 * Spend split as one horizontal bar rather than a donut.
 *
 * A donut asks the eye to compare arc lengths, which nobody is good at; a bar
 * puts the categories in a row so the biggest is simply the widest and the
 * order is readable at a glance. It also survives being 12px tall, which a
 * donut does not, so it can sit inline instead of demanding its own card.
 */
/*
 * `amount`, not `value`: the Reanimated Babel plugin rewrites any `.value` read
 * inside an inline `style={{ }}` in JSX and warns that a shared value is being
 * unwrapped. It matches on the property name alone, so a plain number called
 * `value` trips it — once per segment per render, which buries every other
 * warning in the log.
 */
function SpendBar({ data, total }: { data: { key: string; amount: number }[]; total: number }) {
  if (total <= 0) return null;

  return (
    <View style={sb.track}>
      {data.map((d, i) => (
        <Reveal key={d.key} index={i} delay={140} distance={0} style={{ flexGrow: d.amount }}>
          <View
            style={[
              sb.segment,
              { backgroundColor: CATEGORY_COLORS[d.key] ?? theme.color.brand },
            ]}
          />
        </Reveal>
      ))}
    </View>
  );
}

const sb = StyleSheet.create({
  track: {
    flexDirection: 'row', gap: 3, height: 14,
    borderRadius: 7, overflow: 'hidden',
  },
  segment: { flex: 1, height: 14, borderRadius: 7 },
});

/** Days remaining, drawn as a filling ring so proximity is felt, not read. */
function DayRing({ days, size = 38 }: { days: number; size?: number }) {
  // Anything past a month reads as "not soon"; compressing it keeps the ring
  // meaningful in the window where it matters.
  const fraction = Math.max(0, Math.min(1, 1 - days / 30));
  const urgent = days <= 3;
  const color = urgent ? theme.color.error : days <= 7 ? theme.color.warning : theme.color.brandSecondary;

  return (
    <View style={{ width: size, alignItems: 'center', gap: 5 }}>
      <Text style={[ring.label, { color }]}>{days <= 0 ? 'Today' : `${days}d`}</Text>
      <View style={{ width: size }}>
        <Meter fraction={fraction} color={color} height={4} track="rgba(19,21,24,0.08)" />
      </View>
    </View>
  );
}

const ring = StyleSheet.create({
  label: { fontSize: 11, fontWeight: '800', letterSpacing: -0.2 },
});

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    user, subs, subsError, subsLoading, refreshSubs, refreshReminders, priceChanges,
    refreshPriceChanges,
  } = useAuth();

  const [refreshing, setRefreshing] = useState(false);
  const [notifPromptShown, setNotifPromptShown] = useState(false);
  const [notifState, setNotifState] =
    useState<'unknown' | 'granted' | 'denied' | 'blocked' | 'unsupported'>('unknown');

  const scrollY = useSharedValue(0);
  const header = useCollapsingHeader(scrollY, 110);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  useEffect(() => {
    // Deferred until the screen has settled. Rescheduling is a long run of
    // awaited native calls; running it during mount put that traffic in
    // competition with the first paint and the tab transition, which is most of
    // what "the dashboard feels slow" was. rescheduleReminders itself now skips
    // entirely when nothing reminder-shaped has changed.
    const task = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        const { state } = await getNotifPermission();
        setNotifState(state === 'undetermined' ? 'unknown' : state);
        if (state === 'granted') await rescheduleReminders(subs);
      })();
    });

    return () => task.cancel();
  }, [subs]);

  const promptForNotifs = async () => {
    setNotifPromptShown(true);
    const r = await requestNotifPermission();
    setNotifState(r === 'undetermined' ? 'unknown' : r);
    if (r === 'granted') await rescheduleReminders(subs);
  };

  const allActive = useMemo(() => subs.filter((s) => s.status === 'active'), [subs]);
  const primary = (user?.primary_currency || 'INR').toUpperCase();
  // In the deps below so totals recompute when the live USD rate arrives.
  const rate = useExchangeRate();

  // A trial costs nothing today. Counting it would overstate what actually
  // leaves the account, so it is held out of the total and surfaced separately
  // as what the total *becomes* — which is the number worth reacting to.
  const { charging, trialing } = useMemo(() => splitByTrial(allActive), [allActive]);

  const monthly = useMemo(
    () =>
      charging.reduce(
        (sum, s) => sum + convertToPrimary(monthlyEquivalent(s), s.currency, primary, rate),
        0,
      ),
    [charging, primary, rate],
  );

  const trialMonthly = useMemo(
    () =>
      trialing.reduce(
        (sum, s) => sum + convertToPrimary(monthlyEquivalent(s), s.currency, primary, rate),
        0,
      ),
    [trialing, primary, rate],
  );

  const byCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of charging) {
      m[s.category] = (m[s.category] ?? 0) + convertToPrimary(monthlyEquivalent(s), s.currency, primary, rate);
    }
    return Object.entries(m)
      .map(([key, amount]) => ({ key, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [charging, primary, rate]);

  /**
   * The bar and its legend, describing the same thing and adding up to the whole.
   *
   * Simply taking the top four would draw a bar that fills its track while
   * standing for less than the total — the widths would say "this is all of it"
   * and the number above would disagree. Anything past the top three is folded
   * into one bucket instead, so the segments always sum to the month.
   */
  const topCats = useMemo(() => {
    if (byCat.length <= 4) return byCat;
    const rest = byCat.slice(3).reduce((sum, c) => sum + c.amount, 0);
    return [...byCat.slice(0, 3), { key: 'Other', amount: rest }];
  }, [byCat]);

  const upcoming = useMemo(
    () =>
      [...charging]
        .sort((a, b) => parseISO(a.next_renewal).getTime() - parseISO(b.next_renewal).getTime())
        .slice(0, 8),
    [charging],
  );

  const trials = useMemo(() => activeTrials(allActive), [allActive]);
  const rises = useMemo(() => findPriceRises(priceChanges, subs), [priceChanges, subs]);
  const risesAnnual = useMemo(
    () =>
      rises.reduce((sum, r) => sum + convertToPrimary(r.annualDelta, r.sub.currency, primary, rate), 0),
    [rises, primary, rate],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshSubs(), refreshReminders(), refreshPriceChanges()]);
    } finally {
      setRefreshing(false);
    }
  };

  // Only true once we have actually been told so.
  const empty = !subsLoading && subs.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      {/* Compact bar, fading in as the hero scrolls away. Two headers rather
          than one shrinking header: the large one can be laid out for impact
          and the small one for navigation, without compromising either. */}
      <Animated.View
        style={[s.compactBar, { paddingTop: insets.top + 8 }, header.compact]}
        pointerEvents="none"
      >
        {/* Held back while loading for the same reason as the hero: this bar was
            confidently showing ₹0 to someone whose list had not arrived. */}
        <Text style={s.compactAmount}>
          {subsLoading ? '—' : formatMoney(monthly, primary)}
        </Text>
        <Text style={s.compactLabel}>per month</Text>
      </Animated.View>

      <AnimatedScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: insets.bottom + 108 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.brand} />
        }
        showsVerticalScrollIndicator={false}
        testID="dashboard-scroll"
      >
        <View style={[s.head, { paddingTop: insets.top + 14 }]}>
          <Animated.View style={[s.headRow, header.big]}>
            <View style={{ flex: 1 }}>
              <Text style={s.greeting}>Welcome back</Text>
              <Text style={s.name} numberOfLines={1}>{user?.name || 'friend'}</Text>
            </View>
            <Press onPress={() => router.push('/profile')} scale={0.92} testID="dashboard-avatar">
              <View style={s.avatar}>
                <Text style={s.avatarText}>{(user?.name || 'A').charAt(0).toUpperCase()}</Text>
              </View>
            </Press>
          </Animated.View>
        </View>

        {/* The number. Everything else on this screen is context for it. */}
        <Reveal style={s.heroWrap}>
          <LinearGradient
            colors={theme.color.coralGradient}
            start={{ x: 0.05, y: 0 }}
            end={{ x: 0.95, y: 1 }}
            style={s.hero}
          >
            <View style={s.heroTop}>
              <Text style={s.heroLabel}>Every month</Text>
              <View style={s.heroCurrency}>
                <Text style={s.heroCurrencyText}>{primary}</Text>
              </View>
            </View>

            {/* A skeleton, not a zero. "₹0" while the list is still in flight
                is a confident wrong answer, and on a slow connection it is the
                first thing a returning user reads. */}
            {subsLoading ? (
              <View style={{ height: 60, justifyContent: 'center' }}>
                <Skeleton width="72%" height={38} radius={12} style={s.heroSkeleton} />
              </View>
            ) : (
              <CountUp
                value={monthly}
                symbol={symbolFor(primary)}
                indian={primary === 'INR'}
                style={s.heroAmount}
                testID="dashboard-total-amount"
              />
            )}

            <View style={s.heroStats}>
              <View style={s.heroStat}>
                <Text style={s.heroStatValue}>
                  {subsLoading ? '—' : formatMoneyRounded(monthly * 12, primary)}
                </Text>
                <Text style={s.heroStatLabel}>a year</Text>
              </View>
              <View style={s.heroDivider} />
              <View style={s.heroStat}>
                <Text style={s.heroStatValue}>{subsLoading ? '—' : charging.length}</Text>
                <Text style={s.heroStatLabel}>active</Text>
              </View>
              {trialing.length > 0 && (
                <>
                  <View style={s.heroDivider} />
                  <View style={s.heroStat}>
                    <Text style={s.heroStatValue}>
                      +{formatMoneyRounded(trialMonthly, primary)}
                    </Text>
                    <Text style={s.heroStatLabel}>
                      if {trialing.length === 1 ? 'trial converts' : 'trials convert'}
                    </Text>
                  </View>
                </>
              )}
            </View>

            {topCats.length > 1 && (
              <View style={{ marginTop: 18 }}>
                <SpendBar data={topCats} total={monthly} />
                <View style={s.legend}>
                  {topCats.map((c) => (
                    <View key={c.key} style={s.legendItem}>
                      <View
                        style={[s.legendDot, { backgroundColor: CATEGORY_COLORS[c.key] ?? '#FFFFFF' }]}
                      />
                      <Text style={s.legendText} numberOfLines={1}>
                        {c.key} {formatMoneyRounded(c.amount, primary)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </LinearGradient>
        </Reveal>

        {/* A failed load must never masquerade as an empty account. Shown only
            when there is nothing on screen — if we have a cached list, the
            numbers are merely stale, which is not worth alarming anyone over. */}
        {subsError !== null && subs.length === 0 && (
          <Reveal style={s.block}>
            <Card style={{ borderLeftWidth: 4, borderLeftColor: theme.color.error }}>
              <View style={s.rowGap}>
                <Ionicons name="cloud-offline-outline" size={20} color={theme.color.error} />
                <View style={{ flex: 1 }}>
                  <Text style={s.alertTitle}>Could not load your subscriptions</Text>
                  <Text style={s.alertBody}>{subsError}</Text>
                </View>
                <Press onPress={onRefresh} testID="dashboard-retry">
                  <View style={s.retry}><Text style={s.retryText}>Retry</Text></View>
                </Press>
              </View>
            </Card>
          </Reveal>
        )}

        {/* Trials first — the only thing here with a hard deadline attached. */}
        {trials.length > 0 && (
          <Reveal delay={80} style={s.block} testID="dashboard-trials">
            <Card padded={false}>
              <View style={s.alertHead}>
                {/* Not pulsing. An element that throbs forever is the kind of
                    thing that looks urgent for five seconds and cheap after
                    that, and it keeps the UI thread awake the whole time Home
                    is open. The red day-count badge on each row already says
                    what the pulse was trying to. */}
                <View style={[s.alertIcon, { backgroundColor: theme.color.brandSecondary }]}>
                  <Ionicons name="hourglass" size={17} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.alertTitle}>
                    {trials.length === 1 ? 'Free trial ending' : `${trials.length} free trials ending`}
                  </Text>
                  <Text style={s.alertBody}>Cancel before it converts and you pay nothing.</Text>
                </View>
              </View>

              {trials.map((sub, i) => {
                const left = trialDaysLeft(sub) ?? 0;
                return (
                  <Press
                    key={sub.id}
                    onPress={() => router.push(`/subscription/${sub.id}`)}
                    scale={0.985}
                    testID={`trial-${sub.name}`}
                  >
                    <View style={[s.itemRow, i === trials.length - 1 && { borderBottomWidth: 0 }]}>
                      <BrandAvatar sub={sub} size={38} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.itemName} numberOfLines={1}>{sub.name}</Text>
                        <Text style={s.itemMeta}>then {formatMoney(sub.amount, sub.currency)}</Text>
                      </View>
                      <Badge
                        label={trialLabel(left)}
                        tone={left <= 2 ? 'danger' : left <= 5 ? 'warning' : 'teal'}
                      />
                    </View>
                  </Press>
                );
              })}
            </Card>
          </Reveal>
        )}

        {rises.length > 0 && (
          <Reveal delay={120} style={s.block} testID="dashboard-price-rises">
            <Card padded={false}>
              <View style={s.alertHead}>
                <View style={[s.alertIcon, { backgroundColor: theme.color.brandPrimary }]}>
                  <Ionicons name="trending-up" size={17} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.alertTitle}>
                    {rises.length === 1 ? 'A price went up' : `${rises.length} prices went up`}
                  </Text>
                  <Text style={s.alertBody}>
                    {formatMoneyRounded(risesAnnual, primary)} more per year than before.
                  </Text>
                </View>
              </View>

              {rises.map((r, i) => (
                <View key={r.change.id} style={[s.itemRow, i === rises.length - 1 && { borderBottomWidth: 0 }]}>
                  <BrandAvatar sub={r.sub} size={38} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.itemName} numberOfLines={1}>{r.sub.name}</Text>
                    <Text style={s.itemMeta}>
                      {formatMoney(r.change.old_amount, r.change.currency)} →{' '}
                      {formatMoney(r.change.new_amount, r.change.currency)} · +{r.percent}%
                    </Text>
                  </View>
                  <Press
                    onPress={async () => {
                      await dismissPriceChange(r.change.id);
                      await refreshPriceChanges();
                    }}
                    scale={0.85}
                    testID={`dismiss-rise-${r.sub.name}`}
                  >
                    <View style={s.dismiss}>
                      <Ionicons name="close" size={15} color={theme.color.inkMuted} />
                    </View>
                  </Press>
                </View>
              ))}
            </Card>
          </Reveal>
        )}

        <RemindersSection />

        {(notifState === 'unknown' || notifState === 'denied') && !notifPromptShown && !empty && (
          <Reveal delay={160} style={s.block} testID="dashboard-notif-prompt">
            <Card>
              <View style={s.rowGap}>
                <View style={[s.alertIcon, { backgroundColor: theme.color.brandSecondaryTint }]}>
                  <Ionicons name="notifications" size={17} color={theme.color.brandSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.alertTitle}>Reminders before you are charged</Text>
                  <Text style={s.alertBody}>A few days ahead, so cancelling is still an option.</Text>
                </View>
                <Press onPress={promptForNotifs} testID="dashboard-enable-notifs">
                  <View style={s.retry}><Text style={s.retryText}>Enable</Text></View>
                </Press>
              </View>
            </Card>
          </Reveal>
        )}

        {/* Two tools, equal weight. Scanning is the one that fills the app in a
            single tap, so it is not buried under the manual path. */}
        <Reveal delay={200} style={[s.block, { flexDirection: 'row', gap: 12 }]}>
          <Press
            onPress={() => router.push('/subscription/new')}
            style={{ flex: 1 }}
            haptic="medium"
            testID="dashboard-add-sub"
          >
            <LinearGradient
              colors={theme.color.coralGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.tool}
            >
              <Ionicons name="add" size={22} color="#FFFFFF" />
              <Text style={s.toolTitle}>Add one</Text>
              <Text style={s.toolSub}>Enter it by hand</Text>
            </LinearGradient>
          </Press>

          <Press onPress={() => router.push('/scan')} style={{ flex: 1 }} testID="dashboard-scan-gmail">
            <View style={[s.tool, s.toolDark]}>
              <Ionicons name="mail-open" size={22} color={theme.color.onInverse} />
              <Text style={[s.toolTitle, { color: theme.color.onInverse }]}>Scan Gmail</Text>
              <Text style={[s.toolSub, { color: 'rgba(252,250,247,0.6)' }]}>Find them all</Text>
            </View>
          </Press>
        </Reveal>

        {empty ? (
          <EmptyState
            icon="albums-outline"
            title="Nothing tracked yet"
            body="Use one of the two buttons above — scanning finds what you already pay for, and most people are surprised by about a third of it."
            testID="dashboard-empty"
          />
        ) : (
          <View style={[s.block, { marginTop: 28 }]}>
            <SectionHeader
              title="Coming up"
              count={upcoming.length}
              action="Calendar"
              onAction={() => router.push('/calendar')}
            />
          </View>
        )}

        {!empty && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingVertical: 4 }}
          >
            {upcoming.map((sub, i) => {
              const days = differenceInCalendarDays(parseISO(sub.next_renewal), new Date());
              return (
                <Reveal key={sub.id} index={i} delay={220}>
                  <Press
                    onPress={() => router.push({ pathname: '/subscription/[id]', params: { id: sub.id } })}
                    testID={`upcoming-${sub.name}`}
                  >
                    <View style={s.upcoming}>
                      <BrandAvatar sub={sub} size={40} />
                      <Text style={s.upcomingName} numberOfLines={1}>{sub.name}</Text>
                      <Text style={s.upcomingAmount}>{formatMoney(sub.amount, sub.currency)}</Text>
                      <DayRing days={days} />
                    </View>
                  </Press>
                </Reveal>
              );
            })}
            {upcoming.length === 0 && (
              <Text style={s.quiet}>Nothing due in the near future.</Text>
            )}
          </ScrollView>
        )}
      </AnimatedScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  compactBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
    paddingBottom: 10, paddingHorizontal: 20,
    backgroundColor: 'rgba(252,250,247,0.94)',
    flexDirection: 'row', alignItems: 'baseline', gap: 7,
    borderBottomWidth: 1, borderBottomColor: theme.color.border,
  },
  compactAmount: { ...theme.type.title3, color: theme.color.ink },
  compactLabel: { ...theme.type.caption, color: theme.color.inkMuted },

  head: { paddingHorizontal: 20, paddingBottom: 16 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  greeting: { ...theme.type.small, color: theme.color.inkMuted },
  name: { ...theme.type.title2, color: theme.color.ink, marginTop: 1 },
  avatar: {
    width: 46, height: 46, borderRadius: 16,
    backgroundColor: theme.color.inverse,
    alignItems: 'center', justifyContent: 'center',
    ...theme.shadow.sm,
  },
  avatarText: { color: theme.color.onInverse, fontSize: 17, fontWeight: '800' },

  heroWrap: { marginHorizontal: 20, borderRadius: theme.radius.xl, overflow: 'hidden', ...theme.shadow.md },
  hero: { padding: 22, paddingTop: 20 },
  heroTop: { flexDirection: 'row', alignItems: 'center' },
  heroLabel: { ...theme.type.overline, color: 'rgba(255,255,255,0.82)', flex: 1 },
  heroCurrency: {
    backgroundColor: 'rgba(0,0,0,0.18)', paddingHorizontal: 9, paddingVertical: 3,
    borderRadius: theme.radius.pill,
  },
  heroCurrencyText: { color: '#FFFFFF', fontSize: 10.5, fontWeight: '800', letterSpacing: 0.5 },
  heroAmount: {
    color: '#FFFFFF', fontSize: 50, fontWeight: '800',
    letterSpacing: -2.4, marginTop: 6, height: 60,
  },
  heroSkeleton: { backgroundColor: 'rgba(255,255,255,0.28)' },

  heroStats: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6 },
  heroStat: { flexShrink: 1 },
  heroStatValue: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: -0.4 },
  heroStatLabel: { color: 'rgba(255,255,255,0.78)', fontSize: 11, fontWeight: '600', marginTop: 1 },
  heroDivider: { width: 1, height: 26, backgroundColor: 'rgba(255,255,255,0.25)' },

  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 11 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '700' },

  block: { marginHorizontal: 20, marginTop: 14 },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  alertHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, paddingBottom: 12 },
  alertIcon: {
    width: 38, height: 38, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  alertTitle: { ...theme.type.bodyStrong, color: theme.color.ink },
  alertBody: { ...theme.type.small, color: theme.color.inkSoft, fontWeight: '500', marginTop: 1 },

  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: theme.color.border,
  },
  itemName: { ...theme.type.bodyStrong, color: theme.color.ink },
  itemMeta: { ...theme.type.caption, color: theme.color.inkMuted, marginTop: 2 },

  dismiss: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  retry: {
    backgroundColor: theme.color.inverse, paddingHorizontal: 15, paddingVertical: 9,
    borderRadius: theme.radius.pill,
  },
  retryText: { color: theme.color.onInverse, fontSize: 12.5, fontWeight: '800' },

  // Both tiles share one elevation. They sit side by side and are equally
  // important, so one casting a heavier shadow than the other just read as
  // a mistake.
  tool: {
    borderRadius: theme.radius.lg, padding: 16, gap: 2, minHeight: 108,
    justifyContent: 'flex-end', ...theme.shadow.md,
  },
  toolDark: { backgroundColor: theme.color.inverse },
  toolTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: -0.3, marginTop: 8 },
  toolSub: { color: 'rgba(255,255,255,0.75)', fontSize: 11.5, fontWeight: '600' },

  upcoming: {
    width: 132, padding: 14, gap: 7,
    backgroundColor: theme.color.raised, borderRadius: theme.radius.lg,
    ...theme.shadow.sm,
  },
  upcomingName: { ...theme.type.small, color: theme.color.ink, fontWeight: '800', marginTop: 3 },
  upcomingAmount: { ...theme.type.caption, color: theme.color.inkSoft },

  quiet: { ...theme.type.small, color: theme.color.inkMuted, paddingHorizontal: 4 },
});
