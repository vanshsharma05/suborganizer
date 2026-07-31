/**
 * The list.
 *
 * Two things a list of subscriptions has to do that a generic list does not:
 * make the *comparable* cost obvious, and stay usable once there are thirty of
 * them. So every row shows what it costs per month regardless of how it is
 * actually billed — a ₹1,490 yearly plan and a ₹149 monthly one are the same
 * thing, and only one of those is obvious — and the header carries search plus
 * category filters plus a sort, because scrolling is not a search feature.
 *
 * Sorting defaults to cost, not to name. Someone opening this screen is
 * deciding what to cut.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { parseISO, differenceInCalendarDays, format } from 'date-fns';

import { theme } from '@/src/theme';
import { useAuth, monthlyEquivalent } from '@/src/auth-context';
import {
  Badge, BrandAvatar, Chip, EmptyState, IconButton, SearchField, formatMoney,
} from '@/src/ui';
import { Press, Skeleton } from '@/src/motion';
import { convertToPrimary, fmtMoney, useExchangeRate } from '@/src/currency';
import type { Subscription } from '@/src/api';

/**
 * Written out rather than sliced to two characters — that trick only reads
 * correctly for "monthly", and turned yearly plans into "/ye".
 */
const CYCLE_SHORT: Record<string, string> = { weekly: 'wk', monthly: 'mo', yearly: 'yr' };

type Sort = 'cost' | 'soon' | 'name';

/** Hoisted so FlatList sees a stable component and does not remount separators. */
const separator = () => <View style={{ height: 10 }} />;

const SORTS: { value: Sort; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'cost', label: 'Costliest', icon: 'trending-down' },
  { value: 'soon', label: 'Due soon', icon: 'time' },
  { value: 'name', label: 'A–Z', icon: 'text' },
];

export default function SubscriptionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { subs, subsLoading, refreshSubs, user } = useAuth();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState<Sort>('cost');
  const [showPaused, setShowPaused] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const primary = (user?.primary_currency || 'INR').toUpperCase();
  const rate = useExchangeRate();

  const categories = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of subs) counts[s.category] = (counts[s.category] ?? 0) + 1;
    return [
      { key: 'All', count: subs.length },
      ...Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => ({ key, count })),
    ];
  }, [subs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    const list = subs.filter((s) => {
      if (category !== 'All' && s.category !== category) return false;
      if (!showPaused && s.status !== 'active') return false;
      if (q === '') return true;
      // Category is searchable too, so "music" finds Spotify without the user
      // having to know we filed it that way.
      return (
        s.name.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        (s.domain ?? '').toLowerCase().includes(q)
      );
    });

    const sorted = [...list];
    if (sort === 'cost') {
      sorted.sort(
        (a, b) =>
          convertToPrimary(monthlyEquivalent(b), b.currency, primary, rate) -
          convertToPrimary(monthlyEquivalent(a), a.currency, primary, rate),
      );
    } else if (sort === 'soon') {
      sorted.sort((a, b) => parseISO(a.next_renewal).getTime() - parseISO(b.next_renewal).getTime());
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [subs, query, category, sort, showPaused, primary, rate]);

  /** What the filtered view costs, so the filter itself answers a question. */
  const shownMonthly = useMemo(
    () =>
      filtered
        .filter((s) => s.status === 'active')
        .reduce((sum, s) => sum + convertToPrimary(monthlyEquivalent(s), s.currency, primary, rate), 0),
    [filtered, primary, rate],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshSubs();
    } finally {
      setRefreshing(false);
    }
  };

  const pausedCount = subs.filter((x) => x.status !== 'active').length;

  // Stable across renders, so React.memo on Row actually holds. An inline
  // arrow in renderItem is a new prop every time and would re-render every
  // visible row on each keystroke in the search field.
  const openSub = useCallback(
    (id: string) => router.push({ pathname: '/subscription/[id]', params: { id } }),
    [router],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={s.headRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Subscriptions</Text>
            <Text style={s.subtitle}>
              {filtered.length} shown · {formatMoney(shownMonthly, primary)}/mo
            </Text>
          </View>
          <IconButton
            icon="add"
            onPress={() => router.push('/subscription/new')}
            size={46}
            tone="inverse"
            testID="subs-add-btn"
          />
        </View>

        <View style={{ marginTop: 14 }}>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search name, category or site"
            testID="subs-search"
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.chips}
          style={{ marginHorizontal: -20, marginTop: 12 }}
        >
          {SORTS.map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              icon={o.icon}
              active={sort === o.value}
              onPress={() => setSort(o.value)}
              testID={`sort-${o.value}`}
            />
          ))}
          {pausedCount > 0 && (
            <Chip
              label={showPaused ? 'Hiding none' : 'Active only'}
              icon={showPaused ? 'eye' : 'eye-off'}
              active={!showPaused}
              onPress={() => setShowPaused((v) => !v)}
              testID="toggle-paused"
            />
          )}
        </ScrollView>

        {categories.length > 2 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.chips}
            style={{ marginHorizontal: -20, marginTop: 8 }}
          >
            {categories.map((c) => (
              <Chip
                key={c.key}
                label={c.key}
                count={c.key === 'All' ? undefined : c.count}
                active={category === c.key}
                onPress={() => setCategory(c.key)}
                testID={`filter-${c.key}`}
              />
            ))}
          </ScrollView>
        )}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{
          paddingHorizontal: 20, paddingTop: 14, paddingBottom: insets.bottom + 110,
        }}
        ItemSeparatorComponent={separator}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.brand} />
        }
        // Tuned down from the defaults, which render ten rows up front and keep
        // twenty-one screens of them alive. Each row carries an avatar that
        // fetches a remote logo, so an over-eager window is a burst of network
        // and decode work for rows nobody has scrolled to.
        initialNumToRender={7}
        maxToRenderPerBatch={5}
        windowSize={7}
        removeClippedSubviews
        // No entrance animation on rows. FlatList recycles them, so a mount
        // animation re-fires every time a row is reused — the list appeared to
        // stutter and flash precisely while being scrolled, which is the one
        // moment it must not.
        renderItem={({ item }) => (
          <Row sub={item} primary={primary} rate={rate} onPress={openSub} />
        )}
        ListEmptyComponent={
          // Placeholder rows while the first fetch is in flight. Showing
          // "no subscriptions yet" to someone who has thirty is the worst
          // possible guess to make on a slow connection.
          subsLoading ? (
            <View style={{ gap: 10 }} testID="subs-loading">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} width="100%" height={78} radius={theme.radius.lg} />
              ))}
            </View>
          ) : query.trim() !== '' || category !== 'All' ? (
            <EmptyState
              icon="search"
              tone="neutral"
              title="Nothing matches"
              body={`No subscription matches ${query.trim() !== '' ? `"${query.trim()}"` : `the ${category} filter`}.`}
              actionLabel="Clear filters"
              onAction={() => {
                setQuery('');
                setCategory('All');
                setShowPaused(true);
              }}
              testID="subs-no-match"
            />
          ) : (
            <EmptyState
              icon="albums-outline"
              title="No subscriptions yet"
              body="Add one by hand, or let the Gmail scan find everything you already pay for."
              actionLabel="Scan Gmail"
              onAction={() => router.push('/scan')}
              testID="subs-empty"
            />
          )
        }
      />
    </View>
  );
}

const Row = React.memo(function Row({
  sub, primary, rate, onPress,
}: {
  sub: Subscription;
  primary: string;
  rate: number;
  onPress: (id: string) => void;
}) {
  const days = differenceInCalendarDays(parseISO(sub.next_renewal), new Date());
  const paused = sub.status !== 'active';
  const monthly = monthlyEquivalent(sub);
  const soon = !paused && days >= 0 && days <= 7;

  return (
    <Press onPress={() => onPress(sub.id)} scale={0.985} testID={`sub-row-${sub.name}`}>
      <View style={[s.row, paused && { opacity: 0.55 }]}>
        <BrandAvatar sub={sub} size={46} />

        <View style={{ flex: 1, gap: 3 }}>
          <View style={s.nameRow}>
            <Text style={s.name} numberOfLines={1}>{sub.name}</Text>
            {paused && <Badge label="Paused" tone="neutral" />}
          </View>
          <Text style={s.meta} numberOfLines={1}>
            {sub.category} · {format(parseISO(sub.next_renewal), 'd MMM')}
          </Text>
          {soon && (
            <Badge
              label={days === 0 ? 'Renews today' : `Renews in ${days}d`}
              tone={days <= 2 ? 'danger' : 'warning'}
              icon="time"
            />
          )}
        </View>

        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.amount}>{formatMoney(sub.amount, sub.currency)}</Text>
          <Text style={s.cycle}>
            per {CYCLE_SHORT[sub.billing_cycle] ?? sub.billing_cycle}
          </Text>
          {/* The comparable number. Without it a yearly plan looks cheap next to
              a monthly one purely because it is charged less often. */}
          {sub.billing_cycle !== 'monthly' && (
            <Text style={s.monthly}>= {fmtMoney(monthly, sub.currency)}/mo</Text>
          )}
        </View>
      </View>
    </Press>
  );
});

const s = StyleSheet.create({
  header: {
    paddingHorizontal: 20, paddingBottom: 14,
    backgroundColor: theme.color.surface,
    borderBottomWidth: 1, borderBottomColor: theme.color.border,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { ...theme.type.title1, color: theme.color.ink },
  subtitle: { ...theme.type.small, color: theme.color.inkMuted, marginTop: 2 },
  chips: { gap: 8, paddingHorizontal: 20, alignItems: 'center' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    backgroundColor: theme.color.raised,
    borderRadius: theme.radius.lg, padding: 14,
    ...theme.shadow.sm,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { ...theme.type.bodyStrong, color: theme.color.ink, fontSize: 15.5, flexShrink: 1 },
  meta: { ...theme.type.caption, color: theme.color.inkMuted },
  amount: { fontSize: 17, fontWeight: '800', color: theme.color.ink, letterSpacing: -0.5 },
  cycle: { ...theme.type.caption, color: theme.color.inkMuted, fontSize: 10.5 },
  monthly: { color: theme.color.brandSecondary, fontSize: 10.5, fontWeight: '700', marginTop: 2 },
});
