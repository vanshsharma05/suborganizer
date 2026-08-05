/**
 * Account.
 *
 * Rows are grouped by what they are, rather than listed in the order they were
 * written. The version this replaced had "Privacy policy" and "Delete account"
 * one above the other in the same undifferentiated stack — an irreversible
 * action looking exactly like one that opens a web page.
 *
 * Every row that has a value shows it on the right. A settings screen where you
 * must open something to find out what it is set to is one you open twice.
 */

import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Linking, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';

import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth-context';
import { deleteAccount, updatePrimaryCurrency } from '@/src/api';
import { CURRENCIES, symbolFor } from '@/src/currency';
import { resetStory } from '@/src/story-storage';
import { usePurchases } from '@/src/purchases';
import { PRODUCTS } from '@/src/entitlements';
import { UpgradeSheet } from '@/src/paywall';
import { disconnectGmail, listMailboxes, mailboxLabel, type Mailbox } from '@/src/gmail';
import { IconButton, Stat } from '@/src/ui';
import { Press, Reveal } from '@/src/motion';

const SUPPORT_EMAIL = 'taskteamprosupport@gmail.com';
// The github.io address still redirects here, so older installs keep working.
const SITE = 'https://suborganizer.com';

const CURRENCY_NAME: Record<string, string> = { INR: 'Indian Rupee', USD: 'US Dollar' };

/** Best-effort external open. A missing browser or mail client is not an error worth a dialog. */
async function openUrl(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    // Nothing on the device can handle it; the row simply does nothing.
  }
}

type Row = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Shown right-aligned, so the row answers itself without being opened. */
  value?: string;
  colour: string;
  destructive?: boolean;
  /**
   * What the row does, drawn on its right edge.
   *
   * A chevron is a promise that something opens. Currency does not open
   * anything — it flips between two values in place — and Restore simply runs.
   * Pointing a chevron at either sets up a screen that never arrives.
   */
  trailing?: 'chevron' | 'swap' | 'none';
  onPress: () => void;
};

const TRAILING_ICON = { chevron: 'chevron-forward', swap: 'swap-horizontal' } as const;

function Group({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <View style={{ marginTop: 22 }}>
      <Text style={s.groupTitle}>{title}</Text>
      <View style={s.group}>
        {rows.map((r, i) => (
          <Press key={r.label} onPress={r.onPress} scale={0.99} testID={`profile-${r.label}`}>
            <View style={[s.row, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={[s.rowIcon, { backgroundColor: r.colour + '18' }]}>
                <Ionicons name={r.icon} size={17} color={r.colour} />
              </View>
              <Text style={[s.rowLabel, r.destructive === true && { color: theme.color.error }]}>
                {r.label}
              </Text>
              {r.value !== undefined && (
                <Text style={s.rowValue} numberOfLines={1}>{r.value}</Text>
              )}
              {r.trailing !== 'none' && (
                <Ionicons
                  name={TRAILING_ICON[r.trailing ?? 'chevron']}
                  size={16}
                  color={theme.color.inkFaint}
                />
              )}
            </View>
          </Press>
        ))}
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout, subs, refreshUser } = useAuth();
  const { pro, canSell, refresh: refreshPurchases, resetForDev: resetPurchases } = usePurchases();

  const [savingCur, setSavingCur] = useState(false);
  const [curError, setCurError] = useState<string | null>(null);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [upgrading, setUpgrading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // On focus rather than on mount: Gmail is connected on another screen, and
  // this one should not still read "Not connected" when you come back.
  useFocusEffect(
    useCallback(() => {
      listMailboxes()
        .then(setMailboxes)
        .catch(() => setMailboxes([]));
    }, []),
  );

  const doLogout = () => {
    /*
     * Asks first, because of where it sits.
     *
     * Logging out is not destructive — the subscriptions are on the server —
     * but it is one row above Delete account, both are red, and it also drops
     * the Gmail grant on the way out. Getting back in means a password and a
     * fresh consent screen, which is a lot to pay for a mis-tap.
     */
    Alert.alert(
      'Log out?',
      'Your subscriptions stay on your account. You will need to sign in again, and reconnect Gmail if you were using the scan.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await logout();
              router.replace('/auth');
            })();
          },
        },
      ],
    );
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

  const runDelete = async () => {
    setDeleting(true);
    try {
      await deleteAccount();
      // Clears the local session and the cached list too, so what follows is a
      // sign-in screen rather than a dashboard full of a deleted account's data.
      await logout();
      router.replace('/auth');
    } catch (e) {
      setDeleting(false);
      Alert.alert(
        'Could not delete your account',
        `${e instanceof Error ? e.message : 'Something went wrong.'} If this keeps happening, email ${SUPPORT_EMAIL} and we will do it by hand.`,
      );
    }
  };

  /**
   * Deletes the account from inside the app.
   *
   * This used to open a mail client and ask support to do it by hand. Both
   * stores require better — Apple rejects a support address outright under
   * 5.1.1(v), and Play wants an in-app route as well as a web one — but the
   * plainer argument is that an account you can create in one tap should not
   * take an email and a wait to be rid of.
   *
   * Two prompts rather than one, so the tap that actually destroys everything
   * is never the tap that was already on its way to the screen.
   */
  const confirmDelete = () => {
    Alert.alert(
      'Delete your account',
      `This deletes ${user?.email ?? 'your account'} and every subscription you have tracked. It happens immediately and cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Last chance', 'There is no undo, and no copy is kept.', [
              { text: 'Keep my account', style: 'cancel' },
              {
                text: 'Delete everything',
                style: 'destructive',
                onPress: () => void runDelete(),
              },
            ]);
          },
        },
      ],
    );
  };

  const confirmDisconnect = () => {
    Alert.alert(
      mailboxes.length > 1 ? 'Disconnect all inboxes?' : 'Disconnect Gmail?',
      'We stop reading your mail. Subscriptions already found stay in your list.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await disconnectGmail();
            setMailboxes([]);
          },
        },
      ],
    );
  };

  const active = subs.filter((x) => x.status === 'active').length;
  const primary = (user?.primary_currency || 'INR').toUpperCase();
  const version = Constants.expoConfig?.version ?? '1.0.0';

  const preferences: Row[] = [
    {
      icon: 'cash-outline',
      label: 'Currency',
      value: savingCur ? '…' : `${CURRENCY_NAME[primary] ?? primary} ${symbolFor(primary)}`,
      colour: theme.color.brandPrimary,
      trailing: 'swap',
      onPress: cyclePrimaryCurrency,
    },
    {
      icon: 'notifications-outline',
      label: 'Notifications',
      colour: theme.color.warning,
      onPress: () => {
        void Linking.openSettings();
      },
    },
    {
      icon: 'play-circle-outline',
      label: 'Replay your rundown',
      colour: theme.color.brandSecondary,
      onPress: async () => {
        // Clearing the stored date is what makes the launch path play it again.
        await resetStory();
        router.replace('/story');
      },
    },
  ];

  const data: Row[] = [
    {
      icon: 'mail-outline',
      label: 'Gmail',
      // One inbox shows its address; several show the count, because three
      // addresses will not fit on a row and the number is the useful part.
      value:
        mailboxes.length === 0 ? 'Not connected'
        : mailboxes.length === 1 ? mailboxLabel(mailboxes[0])
        : `${mailboxes.length} inboxes`,
      colour: theme.color.brandSecondary,
      onPress: mailboxes.length > 0 ? confirmDisconnect : () => router.push('/scan'),
    },
    {
      // Play keeps the receipt for one-time products forever, so this is a read,
      // not a transaction. It exists because "I paid and it is gone" on a new
      // phone is the review that costs the most.
      icon: 'refresh-outline',
      label: 'Restore purchases',
      colour: theme.color.inkSoft,
      trailing: 'none',
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
            colour: theme.color.inkMuted,
            trailing: 'none' as const,
            onPress: async () => {
              await resetPurchases();
              Alert.alert('Reset', 'Back to owning nothing. The paywall is live again.');
            },
          },
        ]
      : []),
  ];

  const support: Row[] = [
    {
      icon: 'help-circle-outline',
      label: 'Help & support',
      colour: theme.color.brandSecondary,
      onPress: () =>
        void openUrl(
          `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`SubOrganizer support (v${version})`)}`,
        ),
    },
    {
      icon: 'document-text-outline',
      label: 'Privacy policy',
      colour: theme.color.inkMuted,
      onPress: () => void openUrl(`${SITE}/privacy.html`),
    },
  ];

  // Kept apart, and last. An irreversible action should never sit one row below
  // something that merely opens a web page.
  const danger: Row[] = [
    { icon: 'log-out-outline', label: 'Log out', colour: theme.color.error, onPress: doLogout },
    {
      icon: 'trash-outline',
      label: 'Delete account',
      // Says it is working, and cannot be started twice while it is.
      value: deleting ? 'Deleting…' : undefined,
      colour: theme.color.error,
      destructive: true,
      onPress: deleting ? () => {} : confirmDelete,
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32, paddingHorizontal: 20,
        }}
        showsVerticalScrollIndicator={false}
      >
        <IconButton
          icon="chevron-back"
          onPress={() => router.back()}
          size={40}
          style={{ marginBottom: 18 }}
          testID="profile-back"
        />

        <Text style={s.title}>Account</Text>

        <Reveal style={s.userCard}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{(user?.name || 'A').charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.userName} numberOfLines={1}>{user?.name}</Text>
            <Text style={s.userEmail} numberOfLines={1}>{user?.email}</Text>
          </View>
          {pro && (
            <LinearGradient
              colors={theme.color.inkGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.proBadge}
            >
              <Ionicons name="star" size={11} color={theme.color.gold} />
              <Text style={s.proText}>PRO</Text>
            </LinearGradient>
          )}
        </Reveal>

        {/* Counts only. Currency used to sit here as a third tile, which both
            duplicated the row below and put a setting among two facts. */}
        <Reveal delay={70} style={s.statsRow}>
          <Stat label="Active" value={String(active)} tone="brand" />
          <Stat label="Tracked" value={String(subs.length)} />
        </Reveal>

        {curError !== null && <Text style={s.err}>{curError}</Text>}

        {/* Only when there is genuinely something to buy. Advertising an upgrade
            that cannot be completed is worse than not mentioning it at all. */}
        {!pro && canSell && (
          <Reveal delay={120}>
            <Press onPress={() => setUpgrading(true)} haptic="medium" testID="profile-upgrade">
              <LinearGradient
                colors={theme.color.coralGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[s.upsell, theme.shadow.brand]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.upsellTitle}>Unlock the full audit</Text>
                  <Text style={s.upsellSub}>
                    Every finding with what to change. One payment, never a subscription.
                  </Text>
                </View>
                <Ionicons name="arrow-forward-circle" size={26} color="#FFFFFF" />
              </LinearGradient>
            </Press>
          </Reveal>
        )}

        <Group title="Preferences" rows={preferences} />
        <Group title="Data & purchases" rows={data} />
        <Group title="Support" rows={support} />
        <Group title="Account" rows={danger} />

        {/* Read from the config rather than typed in, so it cannot say 1.0 while
            the store says something else. */}
        <Text style={s.footer}>SubOrganizer · v{version}</Text>
      </ScrollView>

      <UpgradeSheet
        product={PRODUCTS.pro}
        visible={upgrading}
        onClose={() => setUpgrading(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
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

  upsell: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: theme.radius.lg, padding: 18, marginTop: 14,
  },
  upsellTitle: { color: '#FFFFFF', fontSize: 15.5, fontWeight: '800', letterSpacing: -0.3 },
  upsellSub: { color: 'rgba(255,255,255,0.85)', ...theme.type.caption, marginTop: 3, lineHeight: 16 },

  groupTitle: {
    ...theme.type.overline, color: theme.color.inkMuted, marginBottom: 8, paddingHorizontal: 4,
  },
  group: {
    backgroundColor: theme.color.raised, borderRadius: theme.radius.lg,
    overflow: 'hidden', ...theme.shadow.sm,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: theme.color.border,
  },
  rowIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { ...theme.type.body, color: theme.color.ink, fontWeight: '600', flex: 1 },
  rowValue: { ...theme.type.caption, color: theme.color.inkMuted, maxWidth: 150 },

  footer: { color: theme.color.inkMuted, ...theme.type.caption, textAlign: 'center', marginTop: 28 },
});
