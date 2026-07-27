import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { theme } from './theme';
import { BrandAvatar, formatMoney } from './ui';
import { api, ReminderItem } from './api';
import { useAuth } from './auth-context';

export function RemindersSection() {
  const { reminders, refreshReminders, refreshSubs } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!reminders || reminders.length === 0) return null;

  const act = async (id: string, path: string, body?: any) => {
    setBusyId(id);
    try {
      await api(`/subscriptions/${id}${path}`, { method: 'POST', body });
      await Promise.all([refreshReminders(), refreshSubs()]);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.badgeCircle}>
          <Ionicons name="alert-circle" size={16} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Heads up — charges coming</Text>
          <Text style={styles.sub}>Review before you're billed. Keep it, or cancel now.</Text>
        </View>
      </View>

      <Animated.View layout={LinearTransition.duration(240)} style={{ gap: 10 }}>
        {reminders.slice(0, 4).map((r, i) => (
          <Animated.View
            key={r.id}
            entering={FadeInDown.delay(i * 60).duration(360)}
            exiting={FadeOut.duration(220)}
            layout={LinearTransition.duration(240)}
          >
            <ReminderRow item={r} busy={busyId === r.id}
              onKeep={() => act(r.id, '/keep')}
              onCancel={() => act(r.id, '/cancel')}
              onSnooze={() => act(r.id, '/snooze', { days: 3 })}
            />
          </Animated.View>
        ))}
      </Animated.View>

      {reminders.length > 4 && (
        <Text style={styles.moreText}>+ {reminders.length - 4} more coming up soon</Text>
      )}
    </View>
  );
}

function ReminderRow({
  item, busy, onKeep, onCancel, onSnooze,
}: {
  item: ReminderItem; busy: boolean;
  onKeep: () => void; onCancel: () => void; onSnooze: () => void;
}) {
  const urgencyColor =
    item.urgency === 'overdue' ? theme.color.error :
    item.urgency === 'today' ? theme.color.brandDeep :
    item.urgency === 'soon' ? theme.color.brandPrimary :
    theme.color.brandSecondary;

  const urgencyLabel =
    item.urgency === 'overdue' ? `${Math.abs(item.days_left)}d overdue` :
    item.days_left === 0 ? 'Today' :
    item.days_left === 1 ? 'Tomorrow' :
    `in ${item.days_left}d`;

  return (
    <View style={styles.row} testID={`reminder-${item.name}`}>
      <View style={styles.rowTop}>
        <BrandAvatar sub={item} size={40} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <View style={[styles.chip, { backgroundColor: urgencyColor + '18' }]}>
              <View style={[styles.chipDot, { backgroundColor: urgencyColor }]} />
              <Text style={[styles.chipText, { color: urgencyColor }]}>{urgencyLabel}</Text>
            </View>
            <Text style={styles.rowSub} numberOfLines={1}>{formatMoney(item.amount, item.currency)} · {item.billing_cycle}</Text>
          </View>
        </View>
      </View>
      <View style={styles.actionsRow}>
        {busy ? (
          <View style={styles.busyRow}><ActivityIndicator color={theme.color.brand} size="small" /></View>
        ) : (
          <>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [styles.actionBtn, styles.cancelBtn, pressed && { opacity: 0.85 }]}
              testID={`reminder-cancel-${item.name}`}
            >
              <Ionicons name="close-circle-outline" size={15} color={theme.color.error} />
              <Text style={[styles.actionText, { color: theme.color.error }]}>Cancel it</Text>
            </Pressable>
            <Pressable
              onPress={onSnooze}
              style={({ pressed }) => [styles.actionBtn, styles.snoozeBtn, pressed && { opacity: 0.85 }]}
              testID={`reminder-snooze-${item.name}`}
            >
              <Ionicons name="time-outline" size={15} color={theme.color.inkSoft} />
              <Text style={[styles.actionText, { color: theme.color.inkSoft }]}>Snooze 3d</Text>
            </Pressable>
            <Pressable
              onPress={onKeep}
              style={({ pressed }) => [pressed && { opacity: 0.85 }, { flex: 1 }]}
              testID={`reminder-keep-${item.name}`}
            >
              <LinearGradient
                colors={theme.color.coralGradient}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={styles.keepBtn}
              >
                <Ionicons name="checkmark-circle" size={15} color="#FFFFFF" />
                <Text style={styles.keepText}>Keep it</Text>
              </LinearGradient>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12, marginHorizontal: 24, padding: 18, borderRadius: 24,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: theme.color.border,
    shadowColor: '#B84A32', shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  badgeCircle: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: theme.color.brandDeep,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: theme.color.ink, fontSize: 15, fontWeight: '800', letterSpacing: -0.3 },
  sub: { color: theme.color.inkSoft, fontSize: 12, marginTop: 2 },
  row: {
    borderRadius: 18, backgroundColor: theme.color.surfaceSecondary, padding: 12,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  rowName: { color: theme.color.ink, fontSize: 15, fontWeight: '700' },
  rowSub: { color: theme.color.inkSoft, fontSize: 12, fontWeight: '600' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { fontSize: 11, fontWeight: '700' },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: theme.radius.pill,
    backgroundColor: '#FFFFFF', borderWidth: 1,
  },
  cancelBtn: { borderColor: '#DC262640' },
  snoozeBtn: { borderColor: theme.color.border },
  actionText: { fontSize: 12, fontWeight: '700' },
  keepBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 9, borderRadius: theme.radius.pill,
  },
  keepText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  busyRow: { paddingVertical: 8, flex: 1, alignItems: 'center' },
  moreText: { color: theme.color.inkSoft, fontSize: 12, textAlign: 'center', marginTop: 12, fontWeight: '600' },
});
