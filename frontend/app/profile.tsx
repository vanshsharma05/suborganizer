import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Linking, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth-context';
import { updatePrimaryCurrency } from '@/src/api';
import { CURRENCIES, symbolFor } from '@/src/currency';
import { resetStory } from '@/src/story-storage';
import { usePurchases } from '@/src/purchases';
import { IconButton, Stat } from '@/src/ui';
import { Press, Reveal } from '@/src/motion';

const SUPPORT_EMAIL = 'taskteamprosupport@gmail.com';
const SITE = 'https://vanshsharma05.github.io/suborganizer';

/** Best-effort external open. A missing browser or mail client is not an error worth a dialog. */
async function openUrl(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    // Nothing on the device can handle it; the row simply does nothing.
  }
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout, subs, refreshUser } = useAuth();
  const { pro, refresh: refreshPurchases, resetForDev: resetPurchases } = usePurchases();
  const [savingCur, setSavingCur] = useState(false);
  const [curError, setCurError] = useState<string | null>(null);

  const doLogout = async () => {
    await logout();
    router.replace('/auth');
  };

  const cyclePrimaryCurrency = async () => {
    const cur = (user?.primary_currency || 'INR').toUpperCase();
    const idx = CURRENCIES.indexOf(cur as (typeof CURRENCIES)[number]);
    const next = CURRENCIES[(idx + 1) % CURRENCIES.length];
    setCurError(null);
    setSavingCur(true);
    try {
      await updatePrimaryCurrency(next);
      await refreshUser();
    } catch {
      // Previously unguarded, so a tap while offline threw past the boundary
      // and took the screen with it.
      setCurError('Could not save that. Check your connection and try again.');
    } finally {
      setSavingCur(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete your account',
      'This removes your account and every subscription you have tracked. It cannot be undone.\n\n' +
        `We handle deletions by email so we can confirm it is you. Tap Continue to open a request to ${SUPPORT_EMAIL}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () =>
            openUrl(
              `mailto:${SUPPORT_EMAIL}` +
                `?subject=${encodeURIComponent('Delete my SubOrganizer account')}` +
                `&body=${encodeURIComponent(
                  `Please delete my account and all associated data.\n\nAccount email: ${user?.email ?? ''}\n`,
                )}`,
            ),
        },
      ],
    );
  };

  const active = subs.filter((s) => s.status === 'active').length;
  const primary = (user?.primary_currency || 'INR').toUpperCase();
  const version = Constants.expoConfig?.version ?? '1.0.0';

  // Every row here does something. They used to be Pressables with no onPress,
  // so half this screen looked interactive and answered nothing — including two
  // rows ("Security", "Payment methods") for features that do not exist.
  const rows: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    color: string;
    onPress: () => void;
  }[] = [
    {
      icon: 'notifications-outline',
      label: 'Notification settings',
      color: '#D97706',
      onPress: () => {
        void Linking.openSettings();
      },
    },
    {
      icon: 'play-circle-outline',
      label: 'Replay your rundown',
      color: theme.color.brandPrimary,
      onPress: async () => {
        // Clearing the stored date is what makes the launch path play it again.
        await resetStory();
        router.replace('/story');
      },
    },
    {
      // Play keeps the receipt for one-time products forever, so this is a read,
      // not a transaction. It exists because "I paid and it is gone" on a new
      // phone is the review that costs the most, and because Play's own policy
      // expects a way back to something already bought.
      icon: 'refresh-outline',
      label: 'Restore purchases',
      color: theme.color.brandSecondary,
      onPress: async () => {
        await refreshPurchases();
        Alert.alert(
          'Purchases restored',
          pro
            ? 'Pro is active on this account.'
            : 'Anything bought with this Google account is now active. If something is still missing, contact support and we will sort it out.',
        );
      },
    },
    ...(__DEV__
      ? [
          {
            icon: 'bug-outline' as const,
            label: 'Reset purchases (dev)',
            color: theme.color.inkMuted,
            onPress: async () => {
              await resetPurchases();
              Alert.alert('Reset', 'Back to owning nothing. The paywall is live again.');
            },
          },
        ]
      : []),
    {
      icon: 'help-circle-outline',
      label: 'Help & support',
      color: '#0D9488',
      onPress: () =>
        void openUrl(
          `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
            `SubOrganizer support (v${version})`,
          )}`,
        ),
    },
    {
      icon: 'document-text-outline',
      label: 'Privacy policy',
      color: '#8A867F',
      onPress: () => void openUrl(`${SITE}/privacy.html`),
    },
    {
      icon: 'trash-outline',
      label: 'Delete account',
      color: theme.color.error,
      onPress: confirmDelete,
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 20, paddingBottom: insets.bottom + 32, paddingHorizontal: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <IconButton
          icon="chevron-back"
          onPress={() => router.back()}
          size={40}
          style={{ marginBottom: 18 }}
          testID="profile-back"
        />

        <Text style={styles.title}>Profile</Text>

        <Reveal style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(user?.name || 'A').charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{user?.name}</Text>
            <Text style={styles.userEmail} numberOfLines={1}>{user?.email}</Text>
          </View>
          {pro && (
            <LinearGradient colors={theme.color.inkGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.proBadge}>
              <Ionicons name="star" size={11} color={theme.color.gold} />
              <Text style={styles.proText}>PRO</Text>
            </LinearGradient>
          )}
        </Reveal>

        <Reveal delay={80} style={styles.statsRow}>
          <Stat label="Active" value={String(active)} />
          <Stat label="Tracked" value={String(subs.length)} />
          {/* Tapping cycles the currency. It is a stat and a control at once
              because there are only two of them, and a picker for two options
              is a menu nobody needs to open. */}
          <Press onPress={cyclePrimaryCurrency} disabled={savingCur} style={{ flex: 1 }} testID="profile-currency">
            <Stat label={primary} value={savingCur ? '…' : symbolFor(primary)} tone="brand" />
          </Press>
        </Reveal>
        {curError && <Text style={styles.err}>{curError}</Text>}

        <Reveal delay={140} style={styles.list}>
          {rows.map((r, i) => (
            <Press key={r.label} onPress={r.onPress} scale={0.99} testID={`profile-${r.label}`}>
              <View style={[styles.row, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={[styles.rowIcon, { backgroundColor: r.color + '18' }]}>
                  <Ionicons name={r.icon} size={18} color={r.color} />
                </View>
                <Text style={styles.rowLabel}>{r.label}</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.color.inkFaint} />
              </View>
            </Press>
          ))}
        </Reveal>

        <Press onPress={doLogout} testID="profile-logout">
          <View style={styles.logout}>
            <Ionicons name="log-out-outline" size={18} color={theme.color.error} />
            <Text style={styles.logoutText}>Log out</Text>
          </View>
        </Press>

        {/* Read from the config rather than typed in, so it cannot say 1.0 while
            the store says something else. */}
        <Text style={styles.footer}>SubOrganizer · v{version}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { ...theme.type.title1, color: theme.color.ink },
  userCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 20,
    backgroundColor: theme.color.raised, borderRadius: theme.radius.lg, padding: 18,
    ...theme.shadow.md,
  },
  avatar: {
    width: 56, height: 56, borderRadius: 19, backgroundColor: theme.color.inverse,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: theme.color.onInverse, fontSize: 22, fontWeight: '800' },
  userName: { ...theme.type.title3, color: theme.color.ink },
  userEmail: { ...theme.type.caption, color: theme.color.inkMuted, marginTop: 2 },
  proBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 11, paddingVertical: 7, borderRadius: theme.radius.pill,
  },
  proText: { color: theme.color.gold, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },

  statsRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  err: { color: theme.color.error, ...theme.type.caption, marginTop: 10 },

  list: {
    marginTop: 20, backgroundColor: theme.color.raised,
    borderRadius: theme.radius.lg, overflow: 'hidden',
    ...theme.shadow.sm,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: theme.color.border,
  },
  rowIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { ...theme.type.body, color: theme.color.ink, fontWeight: '600', flex: 1 },

  logout: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 20, paddingVertical: 16, borderRadius: theme.radius.pill,
    backgroundColor: theme.color.errorTint,
  },
  logoutText: { color: theme.color.error, fontSize: 14, fontWeight: '800' },
  footer: { color: theme.color.inkMuted, ...theme.type.caption, textAlign: 'center', marginTop: 26 },
});
