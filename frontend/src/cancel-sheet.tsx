/**
 * What happens when someone taps "Cancel it".
 *
 * Before this existed, that button only set `status = 'cancelled'` in our own
 * database. The user saw the word "cancelled", believed it was done, and kept
 * being charged — the app was quietly the cause of exactly the problem it exists
 * to solve. Marking a row is bookkeeping; the merchant is the only party who can
 * actually stop a payment.
 *
 * So the flow is now: show where to cancel, let them go do it, and only then
 * offer to update the record. The two steps are deliberately separate, and the
 * order matters.
 */

import React from 'react';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { theme } from './theme';
import { BrandAvatar, formatMoney } from './ui';
import { cancelGuideFor } from './cancel-guide';
import type { Subscription } from './api';

export function CancelSheet({
  sub,
  onClose,
  onConfirmCancelled,
}: {
  /** Null closes the sheet. */
  sub: Subscription | null;
  onClose: () => void;
  onConfirmCancelled: () => void;
}) {
  if (!sub) return null;

  const guide = cancelGuideFor(sub);

  const open = async () => {
    if (!guide.url) return;
    try {
      await Linking.openURL(guide.url);
    } catch {
      // No browser, or the scheme was refused. The written steps are still on
      // screen, so there is nothing useful to say here.
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />

      <View style={s.sheet} testID="cancel-sheet">
        <View style={s.grabber} />

        <View style={s.head}>
          <BrandAvatar sub={sub} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Cancel {sub.name}</Text>
            <Text style={s.sub}>
              {formatMoney(sub.amount, sub.currency)} · {sub.billing_cycle}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} style={s.closeBtn} testID="cancel-sheet-close">
            <Ionicons name="close" size={18} color={theme.color.inkSoft} />
          </Pressable>
        </View>

        <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ paddingBottom: 4 }}>
          <View style={s.stepsBox}>
            <Text style={s.stepsLabel}>
              {guide.generic ? 'Where to look' : `How to cancel ${sub.name}`}
            </Text>
            <Text style={s.stepsText}>{guide.steps}</Text>
          </View>

          {guide.url && (
            <Pressable onPress={open} style={s.openBtn} testID="cancel-sheet-open">
              <Ionicons name="open-outline" size={17} color="#FFFFFF" />
              <Text style={s.openText}>
                {guide.generic ? 'Open Google Play subscriptions' : 'Open cancellation page'}
              </Text>
            </Pressable>
          )}
        </ScrollView>

        <View style={s.divider} />

        <Text style={s.confirmHint}>
          Cancelled it with {sub.name}? Update your list so your totals stay honest.
        </Text>

        <Pressable onPress={onConfirmCancelled} style={s.confirmBtn} testID="cancel-sheet-confirm">
          <Ionicons name="checkmark-circle" size={17} color={theme.color.error} />
          <Text style={s.confirmText}>{"I've cancelled — mark it here"}</Text>
        </Pressable>

        <Pressable onPress={onClose} style={s.laterBtn} testID="cancel-sheet-later">
          <Text style={s.laterText}>Not yet</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(26,28,30,0.45)' },
  sheet: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 34,
  },
  grabber: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: theme.color.surfaceTertiary, marginBottom: 16,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  title: { color: theme.color.ink, fontSize: 18, fontWeight: '800', letterSpacing: -0.4 },
  sub: { color: theme.color.inkSoft, fontSize: 13, fontWeight: '600', marginTop: 2 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  stepsBox: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: 16, padding: 16,
    borderLeftWidth: 3, borderLeftColor: theme.color.brandSecondary,
  },
  stepsLabel: {
    color: theme.color.brandSecondary, fontSize: 11, fontWeight: '800',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6,
  },
  stepsText: { color: theme.color.inkSoft, fontSize: 14, lineHeight: 21 },
  openBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: theme.color.ink, borderRadius: theme.radius.pill,
    paddingVertical: 14, marginTop: 14,
  },
  openText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  divider: { height: 1, backgroundColor: theme.color.border, marginVertical: 18 },
  confirmHint: { color: theme.color.inkMuted, fontSize: 12.5, marginBottom: 12, lineHeight: 18 },
  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: theme.radius.pill, paddingVertical: 14,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DC262640',
  },
  confirmText: { color: theme.color.error, fontSize: 14, fontWeight: '800' },
  laterBtn: { alignItems: 'center', paddingVertical: 14 },
  laterText: { color: theme.color.inkMuted, fontSize: 13, fontWeight: '700' },
});
