/**
 * The renewal timeline.
 *
 * Amounts here are what actually leaves the account on the day, not monthly
 * equivalents — this screen answers "what is about to be charged", so a yearly
 * plan counts in full on the date it lands and nothing on any other date.
 *
 * Renewals are grouped by month with a sticky-feeling header, because a flat
 * list of forty dates is a wall; the month break is what lets someone find
 * "sometime in October" without reading every row.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { format, isToday } from 'date-fns';

import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth-context';
import {
  Badge, BrandAvatar, EmptyState, IconButton, Stat, formatMoney, formatMoneyRounded,
} from '@/src/ui';
import { Press, Reveal } from '@/src/motion';
import { convertToPrimary, useExchangeRate } from '@/src/currency';
import { currentRenewal } from '@/src/cycles';
import { daysUntilISO, parseISODate, toISODate } from '@/src/dates';
import type { Subscription } from '@/src/api';

/** A subscription paired with where its renewal has actually got to. */
type Due = { sub: Subscription; renewal: string };

type Group = { key: string; label: string; items: Due[]; total: number };

export default function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { subs, refreshSubs, user } = useAuth();

  const [refreshing, setRefreshing] = useState(false);
  const primary = (user?.primary_currency || 'INR').toUpperCase();
  // In the deps below so totals recompute when the live USD rate arrives.
  const rate = useExchangeRate();

  /*
   * Sorted, grouped and counted on where each renewal has actually got to.
   *
   * Reading the stored date put anything stale into a month heading that has
   * already been and gone — "July 2026" sitting above "August 2026" on a screen
   * titled Upcoming renewals — and pinned it to the top of the timeline.
   *
   * The totals were worse than untidy. `left >= 0` quietly excluded every past
   * date, so a subscription charging in four days was left out of "Next 7 days"
   * purely because nobody had opened the app since its last renewal. The figure
   * was wrong in the direction that matters, and nothing said so.
   */
  const timeline = useMemo<Due[]>(() => {
    const todayISO = toISODate(new Date());
    return subs
      .filter((x) => x.status === 'active')
      .map((sub) => ({
        sub,
        renewal: currentRenewal(sub.next_renewal, sub.billing_cycle, todayISO),
      }))
      .sort((a, b) => a.renewal.localeCompare(b.renewal));
  }, [subs]);

  const { total7, total30 } = useMemo(() => {
    const dueWithin = (days: number): number =>
      timeline
        .filter(({ renewal }) => {
          const left = daysUntilISO(renewal);
          return left !== null && left >= 0 && left <= days;
        })
        .reduce((acc, { sub }) => acc + convertToPrimary(sub.amount, sub.currency, primary, rate), 0);

    return { total7: dueWithin(7), total30: dueWithin(30) };
  }, [timeline, primary, rate]);

  const groups = useMemo<Group[]>(() => {
    const out: Group[] = [];
    for (const due of timeline) {
      const d = parseISODate(due.renewal);
      if (!d) continue;
      const key = format(d, 'yyyy-MM');
      const amount = convertToPrimary(due.sub.amount, due.sub.currency, primary, rate);
      const last = out[out.length - 1];
      if (last?.key === key) {
        last.items.push(due);
        last.total += amount;
      } else {
        out.push({ key, label: format(d, 'MMMM yyyy'), items: [due], total: amount });
      }
    }
    return out;
  }, [timeline, primary, rate]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshSubs();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32, paddingHorizontal: 20,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.color.brand}
            colors={[theme.color.brand]}
            progressBackgroundColor={theme.color.raised}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <IconButton
          icon="chevron-back"
          onPress={() => router.back()}
          size={40}
          style={{ marginBottom: 18 }}
          testID="calendar-back"
        />

        <Text style={s.title}>Upcoming{'\n'}renewals</Text>

        <Reveal delay={60} style={s.summary}>
          <Stat label="Next 7 days" value={formatMoneyRounded(total7, primary)} tone="brand" />
          <Stat label="Next 30 days" value={formatMoneyRounded(total30, primary)} />
        </Reveal>

        {groups.map((g, gi) => (
          <View key={g.key} style={{ marginTop: gi === 0 ? 28 : 20 }}>
            <View style={s.monthHead}>
              <Text style={s.monthLabel}>{g.label}</Text>
              <View style={s.monthRule} />
              <Text style={s.monthTotal}>{formatMoneyRounded(g.total, primary)}</Text>
            </View>

            {g.items.map(({ sub, renewal }, i) => {
              const d = parseISODate(renewal);
              const days = daysUntilISO(renewal) ?? 0;
              const soon = days >= 0 && days <= 7;
              if (!d) return null;

              return (
                <Reveal key={sub.id} index={i} delay={80}>
                  <Press
                    onPress={() =>
                      router.push({ pathname: '/subscription/[id]', params: { id: sub.id } })
                    }
                    scale={0.985}
                    testID={`timeline-${sub.name}`}
                  >
                    <View style={s.node}>
                      {/* The rail. The line runs between dots rather than
                          through them, so the sequence reads as connected
                          without the dot looking impaled. */}
                      <View style={s.rail}>
                        <View style={[s.dot, soon && s.dotSoon]} />
                        {i !== g.items.length - 1 && <View style={s.line} />}
                      </View>

                      <View style={s.body}>
                        <View style={s.dateRow}>
                          <Text style={s.date}>{format(d, 'EEE d MMM')}</Text>
                          {isToday(d) ? (
                            <Badge label="Today" tone="danger" />
                          ) : soon ? (
                            <Badge label={`in ${days}d`} tone="warning" />
                          ) : null}
                        </View>

                        <View style={s.card}>
                          <BrandAvatar sub={sub} size={40} />
                          <View style={{ flex: 1 }}>
                            <Text style={s.name} numberOfLines={1}>{sub.name}</Text>
                            <Text style={s.category}>{sub.category}</Text>
                          </View>
                          <Text style={s.amount}>{formatMoney(sub.amount, sub.currency)}</Text>
                        </View>
                      </View>
                    </View>
                  </Press>
                </Reveal>
              );
            })}
          </View>
        ))}

        {timeline.length === 0 && (
          <EmptyState
            icon="calendar-outline"
            tone="neutral"
            title="Nothing coming up"
            body="Once you are tracking subscriptions, every upcoming charge lands here in date order."
            testID="calendar-empty"
          />
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  title: { ...theme.type.title1, color: theme.color.ink },
  summary: { flexDirection: 'row', gap: 10, marginTop: 20 },

  monthHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  monthLabel: { ...theme.type.overline, color: theme.color.inkSoft },
  monthRule: { flex: 1, height: 1, backgroundColor: theme.color.border },
  monthTotal: { ...theme.type.caption, color: theme.color.inkMuted, fontWeight: '800' },

  node: { flexDirection: 'row', gap: 14 },
  rail: { alignItems: 'center', width: 16 },
  dot: {
    width: 12, height: 12, borderRadius: 6, backgroundColor: theme.color.surface,
    borderWidth: 3, borderColor: theme.color.borderStrong, marginTop: 26,
  },
  dotSoon: { borderColor: theme.color.brandPrimary },
  line: { width: 2, flex: 1, backgroundColor: theme.color.border, marginTop: 4 },

  body: { flex: 1, paddingBottom: 14 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, marginBottom: 7 },
  date: { ...theme.type.caption, color: theme.color.inkSoft, fontWeight: '800' },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.color.raised, borderRadius: theme.radius.lg, padding: 14,
    ...theme.shadow.sm,
  },
  name: { ...theme.type.bodyStrong, color: theme.color.ink },
  category: { ...theme.type.caption, color: theme.color.inkMuted, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: '800', color: theme.color.ink, letterSpacing: -0.4 },
});
