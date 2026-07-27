import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth-context';
import { api } from '@/src/api';
import { CURRENCIES, symbolFor } from '@/src/currency';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout, subs, refreshSubs, refreshReminders, refreshUser } = useAuth();
  const [resetting, setResetting] = useState(false);
  const [savingCur, setSavingCur] = useState(false);

  const doLogout = async () => {
    await logout();
    router.replace('/auth');
  };

  const resetData = async () => {
    setResetting(true);
    try {
      await api('/subscriptions/reset', { method: 'POST' });
      await Promise.all([refreshSubs(), refreshReminders()]);
    } finally {
      setResetting(false);
    }
  };

  const cyclePrimaryCurrency = async () => {
    const cur = (user?.primary_currency || 'INR').toUpperCase();
    const idx = CURRENCIES.indexOf(cur as any);
    const next = CURRENCIES[(idx + 1) % CURRENCIES.length];
    setSavingCur(true);
    try {
      await api('/auth/preferences', { method: 'POST', body: { primary_currency: next } });
      await refreshUser();
    } finally {
      setSavingCur(false);
    }
  };

  const active = subs.filter((s) => s.status === 'active').length;
  const primary = (user?.primary_currency || 'INR').toUpperCase();

  const rows = [
    { icon: 'notifications-outline', label: 'Notifications', color: '#D97706' },
    { icon: 'shield-checkmark-outline', label: 'Security', color: '#0D9488' },
    { icon: 'card-outline', label: 'Payment methods', color: '#B84A32' },
    { icon: 'help-circle-outline', label: 'Help & support', color: '#4A4C4A' },
    { icon: 'document-text-outline', label: 'Privacy policy', color: '#8A867F' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 20, paddingBottom: insets.bottom + 110, paddingHorizontal: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>Account</Text>
        <Text style={styles.title}>Profile</Text>

        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(user?.name || 'A').charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{user?.name}</Text>
            <Text style={styles.userEmail} numberOfLines={1}>{user?.email}</Text>
          </View>
          {user?.is_pro && (
            <LinearGradient colors={theme.color.proGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.proBadge}>
              <Ionicons name="star" size={11} color={theme.color.gold} />
              <Text style={styles.proText}>PRO</Text>
            </LinearGradient>
          )}
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statVal}>{active}</Text>
            <Text style={styles.statLabel}>Active subs</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statVal}>{subs.length}</Text>
            <Text style={styles.statLabel}>Tracked</Text>
          </View>
          <Pressable style={styles.statCard} onPress={cyclePrimaryCurrency} disabled={savingCur} testID="profile-currency">
            <Text style={[styles.statVal, { color: theme.color.brandPrimary }]}>{savingCur ? '…' : symbolFor(primary)}</Text>
            <Text style={styles.statLabel}>{primary}</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={resetData}
          disabled={resetting}
          style={styles.resetBtn}
          testID="profile-reset-data"
        >
          <Ionicons name="refresh-outline" size={16} color={theme.color.ink} />
          <Text style={styles.resetText}>{resetting ? 'Resetting…' : 'Reset demo data (INR + USD mix)'}</Text>
        </Pressable>

        <View style={styles.list}>
          {rows.map((r) => (
            <Pressable key={r.label} style={styles.row} testID={`profile-${r.label}`}>
              <View style={[styles.rowIcon, { backgroundColor: r.color + '18' }]}>
                <Ionicons name={r.icon as any} size={18} color={r.color} />
              </View>
              <Text style={styles.rowLabel}>{r.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.color.inkMuted} />
            </Pressable>
          ))}
        </View>

        <Pressable style={styles.logout} onPress={doLogout} testID="profile-logout">
          <Ionicons name="log-out-outline" size={18} color={theme.color.error} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>

        <Text style={styles.footer}>SubOrganizer · v1.0</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: theme.color.brandPrimary, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { color: theme.color.ink, fontSize: 30, fontWeight: '800', letterSpacing: -0.8, marginTop: 4 },
  userCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 24,
    backgroundColor: '#FFFFFF', borderRadius: 24, padding: 18,
    borderWidth: 1, borderColor: theme.color.border,
  },
  avatar: { width: 56, height: 56, borderRadius: 18, backgroundColor: theme.color.ink, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 22, fontWeight: '800' },
  userName: { color: theme.color.ink, fontSize: 17, fontWeight: '700' },
  userEmail: { color: theme.color.inkSoft, fontSize: 13, marginTop: 2 },
  proBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radius.pill },
  proText: { color: theme.color.gold, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  statCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: theme.color.border, alignItems: 'center' },
  statVal: { color: theme.color.ink, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  statLabel: { color: theme.color.inkSoft, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 2 },
  resetBtn: {
    marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.pill,
    paddingVertical: 12, borderWidth: 1, borderColor: theme.color.border,
  },
  resetText: { color: theme.color.ink, fontSize: 13, fontWeight: '700' },
  list: { marginTop: 20, backgroundColor: '#FFFFFF', borderRadius: 24, borderWidth: 1, borderColor: theme.color.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  rowIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { color: theme.color.ink, fontSize: 15, fontWeight: '600', flex: 1 },
  logout: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 20, paddingVertical: 16, borderRadius: theme.radius.pill,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DC262620',
  },
  logoutText: { color: theme.color.error, fontSize: 14, fontWeight: '700' },
  footer: { color: theme.color.inkMuted, fontSize: 12, textAlign: 'center', marginTop: 24 },
});
