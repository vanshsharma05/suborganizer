import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { theme } from '@/src/theme';
import { useAuth, monthlyEquivalent } from '@/src/auth-context';
import { BrandAvatar, Chip, formatMoney } from '@/src/ui';
import { parseISO, differenceInCalendarDays, format } from 'date-fns';

export default function SubscriptionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { subs, refreshSubs } = useAuth();
  const [category, setCategory] = useState<string>('All');
  const [refreshing, setRefreshing] = useState(false);

  const categories = useMemo(() => {
    const set = new Set<string>();
    subs.forEach((s) => set.add(s.category));
    return ['All', ...Array.from(set)];
  }, [subs]);

  const filtered = useMemo(() => {
    const list = category === 'All' ? subs : subs.filter((s) => s.category === category);
    return [...list].sort((a, b) => monthlyEquivalent(b) - monthlyEquivalent(a));
  }, [subs, category]);

  const onRefresh = async () => { setRefreshing(true); await refreshSubs(); setRefreshing(false); };

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      {/* Sticky header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.eyebrow}>Your list</Text>
            <Text style={styles.title}>Subscriptions</Text>
          </View>
          <Pressable
            onPress={() => router.push('/subscription/new')}
            style={styles.addBtn}
            testID="subs-add-btn"
          >
            <Ionicons name="add" size={22} color="#FFFFFF" />
          </Pressable>
        </View>
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={{ marginTop: 4 }}
        >
          {categories.map((c) => (
            <Chip
              key={c} label={c} active={category === c}
              onPress={() => setCategory(c)}
              testID={`filter-${c}`}
            />
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 110 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.brand} />}
        renderItem={({ item, index }) => {
          const daysLeft = differenceInCalendarDays(parseISO(item.next_renewal), new Date());
          const monthly = monthlyEquivalent(item);
          const isPaused = item.status !== 'active';
          return (
            <Animated.View entering={FadeInDown.delay(index * 30).duration(340)}>
              <Pressable
                onPress={() => router.push({ pathname: '/subscription/[id]', params: { id: item.id } })}
                style={[styles.row, isPaused && { opacity: 0.6 }]}
                testID={`sub-row-${item.name}`}
              >
                <BrandAvatar sub={item} size={48} />
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                    {isPaused && <View style={styles.pausedBadge}><Text style={styles.pausedText}>PAUSED</Text></View>}
                  </View>
                  <Text style={styles.meta} numberOfLines={1}>
                    {item.category} · Renews {format(parseISO(item.next_renewal), 'MMM d')}
                    {daysLeft >= 0 && daysLeft <= 7 && (
                      <Text style={{ color: theme.color.brandPrimary, fontWeight: '700' }}>{`  · in ${daysLeft}d`}</Text>
                    )}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.amount}>{formatMoney(item.amount)}</Text>
                  <Text style={styles.cycle}>/{item.billing_cycle.slice(0, 2)}</Text>
                  {item.billing_cycle !== 'monthly' && (
                    <Text style={styles.monthly}>{formatMoney(monthly)}/mo</Text>
                  )}
                </View>
              </Pressable>
            </Animated.View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No subscriptions yet</Text>
            <Text style={styles.emptySub}>Tap + to add one, or scan Gmail from the dashboard.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 24, paddingBottom: 12, backgroundColor: theme.color.surface, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  eyebrow: { color: theme.color.brandPrimary, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { color: theme.color.ink, fontSize: 30, fontWeight: '800', letterSpacing: -0.8, marginTop: 4 },
  addBtn: { width: 44, height: 44, borderRadius: theme.radius.pill, backgroundColor: theme.color.ink, alignItems: 'center', justifyContent: 'center' },
  chipsRow: { gap: 8, paddingHorizontal: 24, marginTop: 16, marginHorizontal: -24, alignItems: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderRadius: 20, paddingVertical: 14, paddingHorizontal: 14,
    borderWidth: 1, borderColor: theme.color.border,
  },
  name: { color: theme.color.ink, fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  meta: { color: theme.color.inkSoft, fontSize: 12, marginTop: 3 },
  amount: { color: theme.color.ink, fontSize: 17, fontWeight: '800', letterSpacing: -0.4 },
  cycle: { color: theme.color.inkMuted, fontSize: 11, fontWeight: '600', marginTop: -2 },
  monthly: { color: theme.color.brandSecondary, fontSize: 11, fontWeight: '600', marginTop: 2 },
  pausedBadge: { backgroundColor: theme.color.surfaceTertiary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill },
  pausedText: { color: theme.color.inkSoft, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  empty: { padding: 40, alignItems: 'center' },
  emptyTitle: { color: theme.color.ink, fontSize: 18, fontWeight: '700' },
  emptySub: { color: theme.color.inkSoft, fontSize: 13, marginTop: 6, textAlign: 'center' },
});
