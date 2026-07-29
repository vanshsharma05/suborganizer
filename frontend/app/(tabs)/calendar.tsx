import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth-context';
import { BrandAvatar, formatMoney, formatMoneyRounded } from '@/src/ui';
import { convertToPrimary, monthlyEquivalent as monthlyEq, useExchangeRate } from '@/src/currency';
import { parseISO, differenceInCalendarDays, format, isSameDay, isToday } from 'date-fns';

export default function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { subs, refreshSubs, user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const primary = (user?.primary_currency || 'INR').toUpperCase();
  // In the deps below so totals recompute when the live USD rate arrives.
  const rate = useExchangeRate();

  const timeline = useMemo(() => {
    return subs
      .filter((s) => s.status === 'active')
      .slice()
      .sort((a, b) => parseISO(a.next_renewal).getTime() - parseISO(b.next_renewal).getTime());
  }, [subs]);

  const total7 = useMemo(() => {
    const now = new Date();
    return timeline
      .filter((s) => {
        const d = differenceInCalendarDays(parseISO(s.next_renewal), now);
        return d >= 0 && d <= 7;
      })
      .reduce((acc, s) => acc + convertToPrimary(s.amount, s.currency, primary), 0);
  }, [timeline, primary, rate]);

  const total30 = useMemo(() => {
    const now = new Date();
    return timeline
      .filter((s) => {
        const d = differenceInCalendarDays(parseISO(s.next_renewal), now);
        return d >= 0 && d <= 30;
      })
      .reduce((acc, s) => acc + convertToPrimary(s.amount, s.currency, primary), 0);
  }, [timeline, primary, rate]);

  const onRefresh = async () => { setRefreshing(true); await refreshSubs(); setRefreshing(false); };

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 20, paddingBottom: insets.bottom + 110, paddingHorizontal: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.brand} />}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>Timeline</Text>
        <Text style={styles.title}>Upcoming{'\n'}renewals</Text>

        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryVal}>{formatMoneyRounded(total7, primary)}</Text>
            <Text style={styles.summaryLabel}>Next 7 days</Text>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: theme.color.ink }]}>
            <Text style={[styles.summaryVal, { color: '#FFFFFF' }]}>{formatMoneyRounded(total30, primary)}</Text>
            <Text style={[styles.summaryLabel, { color: 'rgba(255,255,255,0.6)' }]}>Next 30 days</Text>
          </View>
        </View>

        <View style={styles.timeline}>
          {timeline.map((s, idx) => {
            const d = parseISO(s.next_renewal);
            const daysLeft = differenceInCalendarDays(d, new Date());
            const soon = daysLeft >= 0 && daysLeft <= 7;
            return (
              <Animated.View key={s.id} entering={FadeInDown.delay(idx * 40).duration(380)}>
                <Pressable
                  onPress={() => router.push({ pathname: '/subscription/[id]', params: { id: s.id } })}
                  style={styles.node}
                  testID={`timeline-${s.name}`}
                >
                  <View style={styles.rail}>
                    <View style={[styles.dot, soon && { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary }]} />
                    {idx !== timeline.length - 1 && <View style={styles.line} />}
                  </View>
                  <View style={styles.nodeBody}>
                    <Text style={styles.nodeDate}>
                      {format(d, 'EEE, MMM d')}
                      {isToday(d) && <Text style={{ color: theme.color.brandPrimary }}>  · Today</Text>}
                      {daysLeft > 0 && daysLeft <= 7 && <Text style={{ color: theme.color.brandPrimary }}>{`  · in ${daysLeft}d`}</Text>}
                    </Text>
                    <View style={styles.nodeCard}>
                      <BrandAvatar sub={s} size={40} />
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={styles.nodeName}>{s.name}</Text>
                        <Text style={styles.nodeCategory}>{s.category}</Text>
                      </View>
                      <Text style={styles.nodeAmt}>{formatMoney(s.amount, s.currency)}</Text>
                    </View>
                  </View>
                </Pressable>
              </Animated.View>
            );
          })}
          {timeline.length === 0 && (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <Text style={{ color: theme.color.inkSoft }}>No upcoming renewals.</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: theme.color.brandPrimary, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { color: theme.color.ink, fontSize: 34, fontWeight: '800', letterSpacing: -1, lineHeight: 38, marginTop: 6 },
  summaryRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
  summaryCard: {
    flex: 1, backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16,
    borderWidth: 1, borderColor: theme.color.border,
  },
  summaryVal: { color: theme.color.ink, fontSize: 22, fontWeight: '800', letterSpacing: -0.6 },
  summaryLabel: { color: theme.color.inkSoft, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 4 },
  timeline: { marginTop: 32 },
  node: { flexDirection: 'row', gap: 14 },
  rail: { alignItems: 'center', width: 20 },
  dot: {
    width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFFFFF',
    borderWidth: 3, borderColor: theme.color.borderStrong, marginTop: 24,
  },
  line: { width: 2, flex: 1, backgroundColor: theme.color.border, marginTop: 4 },
  nodeBody: { flex: 1, paddingBottom: 20 },
  nodeDate: { color: theme.color.inkSoft, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, marginTop: 18 },
  nodeCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderRadius: 20, padding: 14, borderWidth: 1, borderColor: theme.color.border,
  },
  nodeName: { color: theme.color.ink, fontSize: 15, fontWeight: '700' },
  nodeCategory: { color: theme.color.inkSoft, fontSize: 12, marginTop: 2 },
  nodeAmt: { color: theme.color.ink, fontSize: 16, fontWeight: '800', letterSpacing: -0.4 },
});
