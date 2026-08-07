/**
 * The monthly check-in.
 *
 * One subscription at a time, two buttons, no typing. It exists because the
 * audit could answer every question about a subscription except the one people
 * actually care about — whether they still use it — and no amount of cleverness
 * derives that from a price and a renewal date.
 *
 * Deliberately not a list with checkboxes. A list invites skimming and a single
 * "mark all", and an answer given without looking is worse than no answer: it
 * would produce a confident finding built on a shrug. One card at a time makes
 * each answer a small decision, and the whole thing still takes under a minute.
 *
 * Nothing here can be got wrong by closing it. Answers are written as they are
 * given, so a review abandoned halfway has still recorded half.
 */

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';

import { theme } from './theme';
import { BrandAvatar, Button, formatMoney } from './ui';
import { Press } from './motion';
import { monthlyEquivalent } from './cycles';
import type { Subscription } from './api';
import { record, writeUsage, type UsageLog } from './usage';

function UsageReviewInner({
  visible,
  queue,
  log,
  onLog,
  onClose,
}: {
  visible: boolean;
  /** Subscriptions to ask about, in the order they should be asked. */
  queue: Subscription[];
  log: UsageLog;
  onLog: (next: UsageLog) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [at, setAt] = useState(0);

  // Start from the top each time it opens. Reopening after a partial review
  // rebuilds the queue from what is still unanswered, so index 0 is correct.
  useEffect(() => {
    if (visible) setAt(0);
  }, [visible]);

  const sub = queue[at];
  const done = at >= queue.length;

  const answer = (used: boolean) => {
    if (!sub) return;
    const next = record(log, sub.id, used);
    onLog(next);
    void writeUsage(next);
    setAt((i) => i + 1);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* A plain Pressable, like every other sheet in the app. Press splits its
          style — position outward, appearance inward — so a style that is
          nothing but `absoluteFillObject` plus a colour leaves the inner view
          with a tint and no dimensions, and the scrim never draws. */}
      <Pressable
        style={s.backdrop}
        onPress={onClose}
        accessibilityLabel="Close the check-in"
        testID="review-backdrop"
      />

      <Animated.View
        entering={SlideInDown.duration(300)}
        style={[s.sheet, { paddingBottom: insets.bottom + 18 }]}
      >
        <View style={s.grabber} />

        {done ? (
          <Animated.View entering={FadeIn.duration(260)} style={s.doneWrap} testID="review-done">
            <View style={s.doneMark}>
              <Ionicons name="checkmark" size={28} color="#FFFFFF" />
            </View>
            <Text style={s.doneTitle}>That is all of them</Text>
            <Text style={s.doneBody}>
              Anything you said you are not using will show up under Savings, with what
              cancelling it is worth.
            </Text>
            <Button label="Done" onPress={onClose} testID="review-finish" />
          </Animated.View>
        ) : (
          <>
            <View style={s.head}>
              <Text style={s.eyebrow}>Monthly check-in</Text>
              <Text style={s.count}>{at + 1} of {queue.length}</Text>
            </View>

            <View style={s.track}>
              <View style={[s.trackFill, { width: `${(at / queue.length) * 100}%` }]} />
            </View>

            {/* Keyed on the subscription so each card enters on its own, rather
                than the text swapping inside a card that never moves. */}
            <Animated.View key={sub.id} entering={FadeIn.duration(240)} style={s.card}>
              <BrandAvatar sub={sub} size={64} />
              <Text style={s.name} numberOfLines={2}>{sub.name}</Text>
              <Text style={s.cost}>
                {formatMoney(monthlyEquivalent(sub.amount, sub.billing_cycle), sub.currency)}
                <Text style={s.per}> a month</Text>
              </Text>
              <Text style={s.question}>Have you used this in the last month?</Text>
            </Animated.View>

            <View style={s.answers}>
              <Press
                onPress={() => answer(false)}
                haptic="medium"
                style={s.answerLeft}
                testID="review-no"
              >
                <View style={[s.answer, s.answerNo]}>
                  <Ionicons name="close-circle-outline" size={19} color={theme.color.error} />
                  <Text style={[s.answerText, { color: theme.color.error }]}>No</Text>
                </View>
              </Press>

              <Press
                onPress={() => answer(true)}
                haptic="medium"
                style={s.answerRight}
                testID="review-yes"
              >
                <View style={[s.answer, s.answerYes]}>
                  <Ionicons name="checkmark-circle" size={19} color="#FFFFFF" />
                  <Text style={[s.answerText, { color: '#FFFFFF' }]}>Yes, I use it</Text>
                </View>
              </Press>
            </View>

            <Press onPress={onClose} style={s.later} testID="review-later">
              <Text style={s.laterText}>Finish later</Text>
            </Press>
          </>
        )}
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,16,14,0.5)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: 30, borderTopRightRadius: 30,
    paddingHorizontal: 22, paddingTop: 12,
  },
  grabber: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: theme.color.border, marginBottom: 16,
  },

  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  eyebrow: { ...theme.type.overline, color: theme.color.inkMuted },
  count: { ...theme.type.caption, color: theme.color.inkMuted, fontWeight: '800' },

  track: {
    height: 3, borderRadius: 2, backgroundColor: theme.color.surfaceTertiary,
    marginTop: 10, overflow: 'hidden',
  },
  trackFill: { height: '100%', borderRadius: 2, backgroundColor: theme.color.brandPrimary },

  card: { alignItems: 'center', paddingVertical: 26, gap: 4 },
  name: { ...theme.type.title2, color: theme.color.ink, textAlign: 'center', marginTop: 14 },
  cost: { fontSize: 17, fontWeight: '800', color: theme.color.ink, letterSpacing: -0.4 },
  per: { ...theme.type.caption, color: theme.color.inkMuted, fontWeight: '600' },
  question: {
    ...theme.type.body, color: theme.color.inkSoft, textAlign: 'center', marginTop: 16,
  },

  answers: { flexDirection: 'row', gap: 10 },
  answerLeft: { flex: 1 },
  answerRight: { flex: 1.4 },
  answer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    height: 54, borderRadius: theme.radius.pill,
  },
  answerNo: { backgroundColor: theme.color.errorTint },
  answerYes: { backgroundColor: theme.color.inverse },
  answerText: { fontSize: 14.5, fontWeight: '800', letterSpacing: -0.2 },

  later: { alignItems: 'center', minHeight: 44, justifyContent: 'center', marginTop: 6 },
  laterText: { ...theme.type.small, color: theme.color.inkMuted, fontWeight: '700' },

  doneWrap: { alignItems: 'center', paddingVertical: 20, gap: 12 },
  doneMark: {
    width: 62, height: 62, borderRadius: 22,
    backgroundColor: theme.color.success,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 6,
  },
  doneTitle: { ...theme.type.title2, color: theme.color.ink },
  doneBody: {
    ...theme.type.body, color: theme.color.inkSoft, textAlign: 'center',
    maxWidth: 300, marginBottom: 14,
  },
});

/**
 * Memoised, and it matters more here than it looks.
 *
 * This is mounted by the dashboard on every render whether or not it is visible,
 * and it holds the review queue and the whole usage log. Its props are stable
 * now that onClose is a useCallback, so a pull-to-refresh no longer walks this
 * subtree to discover that `visible` is still false.
 */
export const UsageReview = React.memo(UsageReviewInner);
