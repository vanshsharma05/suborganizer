/**
 * The list.
 *
 * Two things a list of subscriptions must do that a generic list need not: make
 * the *comparable* cost obvious, and stay usable at thirty items. So every row
 * carries what it costs per month regardless of how it is billed — a Rs 1,490
 * yearly plan and a Rs 149 monthly one are the same thing and only one of those
 * is obvious — and search is always in reach.
 *
 * The controls above the list are deliberately one row, not three. The version
 * this replaced stacked a sort row and a category row under the search box and
 * pushed the first subscription almost off the screen; filters you have to
 * scroll past to reach your data are a tax on every visit for the benefit of a
 * rare one. Categories now live behind a single chip that opens a sheet, and
 * appear only when there is more than one category to choose between.
 *
 * Sorting defaults to cost. Someone opening this screen is deciding what to cut.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, RefreshControl, FlatList, Modal, Pressable, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { SlideInDown } from 'react-native-reanimated';
import { parseISO, differenceInCalendarDays, format } from 'date-fns';

import { theme, CATEGORY_COLORS } from '@/src/theme';
import { useAuth, monthlyEquivalent } from '@/src/auth-context';
import {
  Badge, BrandAvatar, Button, EmptyState, IconButton, SearchField, Segmented, formatMoney,
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

export default function SubscriptionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { subs, subsLoading, refreshSubs, user } = useAuth();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState<Sort>('cost');
  const [refreshing, setRefreshing] = useState(false);
  const [picking, setPicking] = useState(false);

  const primary = (user?.primary_currency || 'INR').toUpperCase();
  const rate = useExchangeRate();

  const categories = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const x of subs) counts[x.category] = (counts[x.category] ?? 0) + 1;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count }));
  }, [subs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    const list = subs.filter((x) => {
      if (category !== 'All' && x.category !== category) return false;
      if (q === '') return true;
      // Category is searchable too, so "music" finds Spotify without the user
      // having to know we filed it that way.
      return (
        x.name.toLowerCase().includes(q) ||
        x.category.toLowerCase().includes(q) ||
        (x.domain ?? '').toLowerCase().includes(q)
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

    // Paused always sinks, whatever the sort. It is still yours, but it is not
    // costing you anything, so it should never be the first thing you see.
    return sorted.sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active'));
  }, [subs, query, category, sort, primary, rate]);

  /** What the filtered view costs, so filtering itself answers a question. */
  const shownMonthly = useMemo(
    () =>
      filtered
        .filter((x) => x.status === 'active')
        .reduce((sum, x) => sum + convertToPrimary(monthlyEquivalent(x), x.currency, primary, rate), 0),
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

  // Stable across renders, so React.memo on Row actually holds. An inline arrow
  // in renderItem is a new prop every time and would re-render every visible row
  // on each keystroke in the search field.
  const openSub = useCallback(
    (id: string) => router.push({ pathname: '/subscription/[id]', params: { id } }),
    [router],
  );

  const filtering = query.trim() !== '' || category !== 'All';

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={s.headRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Subscriptions</Text>
            <Text style={s.subtitle}>
              {subsLoading
                ? 'Loading…'
                : `${filtered.length} ${filtered.length === 1 ? 'item' : 'items'} · ${formatMoney(shownMonthly, primary)}/mo`}
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

        <View style={s.controls}>
          <View style={{ flex: 1 }}>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Search"
              testID="subs-search"
            />
          </View>
          {/* One button for all category filtering, and only when there is more
              than one category to pick between. */}
          {categories.length > 1 && (
            <Press onPress={() => setPicking(true)} scale={0.92} testID="subs-filter">
              <View style={[s.filterBtn, category !== 'All' && s.filterBtnOn]}>
                <Ionicons
                  name="funnel"
                  size={17}
                  color={category !== 'All' ? '#FFFFFF' : theme.color.ink}
                />
              </View>
            </Press>
          )}
        </View>

        <View style={{ marginTop: 10 }}>
          <Segmented<Sort>
            options={[
              { value: 'cost', label: 'Costliest' },
              { value: 'soon', label: 'Due soon' },
              { value: 'name', label: 'A–Z' },
            ]}
            value={sort}
            onChange={setSort}
            testID="subs-sort"
          />
        </View>

        {category !== 'All' && (
          <Press onPress={() => setCategory('All')} scale={0.96} testID="subs-clear-filter">
            <View style={s.activeFilter}>
              <View
                style={[s.filterDot, { backgroundColor: CATEGORY_COLORS[category] ?? theme.color.brand }]}
              />
              <Text style={s.activeFilterText}>{category}</Text>
              <Ionicons name="close-circle" size={15} color={theme.color.inkMuted} />
            </View>
          </Press>
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
        keyboardShouldPersistTaps="handled"
        // No entrance animation on rows. FlatList recycles them, so a mount
        // animation re-fires every time a row is reused — the list appeared to
        // stutter and flash precisely while being scrolled, which is the one
        // moment it must not.
        renderItem={({ item }) => (
          <Row sub={item} primary={primary} rate={rate} onPress={openSub} />
        )}
        ListEmptyComponent={
          // Placeholder rows while the first fetch is in flight. Showing "no
          // subscriptions yet" to someone who has thirty is the worst possible
          // guess to make on a slow connection.
          subsLoading ? (
            <View style={{ gap: 10 }} testID="subs-loading">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} width="100%" height={78} radius={theme.radius.lg} />
              ))}
            </View>
          ) : filtering ? (
            <EmptyState
              icon="search"
              tone="neutral"
              title="Nothing matches"
              body={
                query.trim() !== ''
                  ? `No subscription matches "${query.trim()}".`
                  : `Nothing filed under ${category}.`
              }
              actionLabel="Clear"
              onAction={() => {
                setQuery('');
                setCategory('All');
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

      <CategorySheet
        visible={picking}
        categories={categories}
        total={subs.length}
        selected={category}
        onClose={() => setPicking(false)}
        onPick={(c) => {
          setCategory(c);
          setPicking(false);
        }}
      />
    </View>
  );
}

/** Category filtering, out of the way until asked for. */
function CategorySheet({
  visible, categories, total, selected, onClose, onPick,
}: {
  visible: boolean;
  categories: { key: string; count: number }[];
  total: number;
  selected: string;
  onClose: () => void;
  onPick: (c: string) => void;
}) {
  const insets = useSafeAreaInsets();

  const rows = [{ key: 'All', count: total }, ...categories];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={sheet.backdrop} onPress={onClose} testID="cat-backdrop" />
      <Animated.View
        entering={SlideInDown.duration(280)}
        style={[sheet.wrap, { paddingBottom: insets.bottom + 16 }]}
      >
        <View style={sheet.grabber} />
        <Text style={sheet.title}>Filter by category</Text>

        <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
          {rows.map((r) => {
            const on = r.key === selected;
            return (
              <Press key={r.key} onPress={() => onPick(r.key)} scale={0.98} testID={`cat-${r.key}`}>
                <View style={sheet.row}>
                  <View
                    style={[
                      sheet.dot,
                      { backgroundColor: r.key === 'All' ? theme.color.inkMuted : CATEGORY_COLORS[r.key] ?? theme.color.brand },
                    ]}
                  />
                  <Text style={[sheet.label, on && { fontWeight: '800' }]}>{r.key}</Text>
                  <Text style={sheet.count}>{r.count}</Text>
                  {on && <Ionicons name="checkmark" size={18} color={theme.color.brandPrimary} />}
                </View>
              </Press>
            );
          })}
        </ScrollView>

        <Button label="Close" variant="ghost" onPress={onClose} size="md" style={{ marginTop: 10 }} />
      </Animated.View>
    </Modal>
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
  const colour = CATEGORY_COLORS[sub.category] ?? theme.color.brand;

  return (
    <Press onPress={() => onPress(sub.id)} scale={0.985} testID={`sub-row-${sub.name}`}>
      <View style={[s.row, paused && s.rowPaused]}>
        {/* A category stripe. It costs four pixels and makes the list scannable
            by kind without a word of text. */}
        <View style={[s.stripe, { backgroundColor: paused ? theme.color.border : colour }]} />

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
          <Text style={s.cycle}>per {CYCLE_SHORT[sub.billing_cycle] ?? sub.billing_cycle}</Text>
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

  controls: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  filterBtn: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: theme.color.raised,
    alignItems: 'center', justifyContent: 'center',
    ...theme.shadow.sm,
  },
  filterBtnOn: { backgroundColor: theme.color.brandPrimary },

  activeFilter: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7,
    marginTop: 10, paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary,
  },
  filterDot: { width: 8, height: 8, borderRadius: 4 },
  activeFilterText: { ...theme.type.caption, color: theme.color.ink, fontWeight: '700' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    backgroundColor: theme.color.raised,
    borderRadius: theme.radius.lg, padding: 14, paddingLeft: 18,
    overflow: 'hidden',
    ...theme.shadow.sm,
  },
  rowPaused: { opacity: 0.6 },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { ...theme.type.bodyStrong, color: theme.color.ink, fontSize: 15.5, flexShrink: 1 },
  meta: { ...theme.type.caption, color: theme.color.inkMuted },
  amount: { fontSize: 17, fontWeight: '800', color: theme.color.ink, letterSpacing: -0.5 },
  cycle: { ...theme.type.caption, color: theme.color.inkMuted, fontSize: 10.5 },
  monthly: { color: theme.color.brandSecondary, fontSize: 10.5, fontWeight: '700', marginTop: 2 },
});

const sheet = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,16,14,0.5)' },
  wrap: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: 30, borderTopRightRadius: 30,
    paddingHorizontal: 20, paddingTop: 12,
  },
  grabber: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: theme.color.border, marginBottom: 14,
  },
  title: { ...theme.type.title3, color: theme.color.ink, marginBottom: 6 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.color.border,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  label: { ...theme.type.body, color: theme.color.ink, fontWeight: '600', flex: 1 },
  count: { ...theme.type.caption, color: theme.color.inkMuted, fontWeight: '700' },
});
