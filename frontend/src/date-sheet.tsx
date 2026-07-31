/**
 * A calendar you tap a day in.
 *
 * Replaces a row of "+7d / +14d / +30d / −1d" buttons. Those were quick to build
 * and wrong to use: nobody knows their renewal as an offset from today, they
 * know it as "the 14th". Arithmetic is not an input method.
 *
 * Written in JS rather than pulling in the native date picker, for two reasons.
 * It avoids a native module — and therefore a rebuild — and the OS picker on
 * Android is a spinner dialog that shows one date at a time, where a month grid
 * lets someone find the 14th by looking rather than by scrolling.
 */

import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { SlideInDown } from 'react-native-reanimated';
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay,
  isSameMonth, startOfMonth, startOfWeek,
} from 'date-fns';

import { theme } from './theme';
import { Press } from './motion';
import { Button } from './ui';
import { toISODate, parseISODate, startOfLocalDay } from './dates';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function DateSheet({
  visible, value, onClose, onPick, title = 'Pick a date',
}: {
  visible: boolean;
  /** Currently selected date, as `YYYY-MM-DD`. */
  value: string;
  onClose: () => void;
  onPick: (iso: string) => void;
  title?: string;
}) {
  const insets = useSafeAreaInsets();
  const selected = parseISODate(value) ?? new Date();
  const [month, setMonth] = useState(() => startOfMonth(selected));

  const today = startOfLocalDay(new Date());

  // Whole weeks, so the grid is always rectangular and the columns line up with
  // the weekday header no matter which day the month starts on.
  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month)),
        end: endOfWeek(endOfMonth(month)),
      }),
    [month],
  );

  const pick = (d: Date) => {
    onPick(toISODate(d));
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={onClose} testID="date-backdrop" />

      <Animated.View entering={SlideInDown.duration(300)} style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={s.grabber} />
        <Text style={s.title}>{title}</Text>

        <View style={s.monthRow}>
          <Press onPress={() => setMonth((m) => addMonths(m, -1))} scale={0.88} testID="date-prev">
            <View style={s.arrow}>
              <Ionicons name="chevron-back" size={18} color={theme.color.ink} />
            </View>
          </Press>
          <Text style={s.monthLabel}>{format(month, 'MMMM yyyy')}</Text>
          <Press onPress={() => setMonth((m) => addMonths(m, 1))} scale={0.88} testID="date-next">
            <View style={s.arrow}>
              <Ionicons name="chevron-forward" size={18} color={theme.color.ink} />
            </View>
          </Press>
        </View>

        <View style={s.weekRow}>
          {WEEKDAYS.map((d, i) => (
            <Text key={`${d}${i}`} style={s.weekday}>{d}</Text>
          ))}
        </View>

        <View style={s.grid}>
          {days.map((d) => {
            const inMonth = isSameMonth(d, month);
            const isSelected = isSameDay(d, selected);
            const isToday = isSameDay(d, today);

            return (
              <Press
                key={d.toISOString()}
                onPress={() => pick(d)}
                scale={0.86}
                style={s.cellWrap}
                testID={`date-${toISODate(d)}`}
              >
                <View style={[s.cell, isSelected && s.cellSelected, !isSelected && isToday && s.cellToday]}>
                  <Text
                    style={[
                      s.cellText,
                      // Days spilling in from the neighbouring months stay
                      // tappable but recede, so the current month reads as one
                      // block rather than six rows of equal noise.
                      !inMonth && s.cellTextOutside,
                      isSelected && s.cellTextSelected,
                    ]}
                  >
                    {format(d, 'd')}
                  </Text>
                </View>
              </Press>
            );
          })}
        </View>

        {/* The two dates people actually mean most of the time. */}
        <View style={s.quick}>
          <Quick label="Next month" onPress={() => pick(addMonths(today, 1))} />
          <Quick label="Next year" onPress={() => pick(addMonths(today, 12))} />
        </View>

        <Button label="Close" variant="ghost" onPress={onClose} size="md" testID="date-close" />
      </Animated.View>
    </Modal>
  );
}

function Quick({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} scale={0.94} style={{ flex: 1 }}>
      <View style={s.quickBtn}>
        <Text style={s.quickText}>{label}</Text>
      </View>
    </Press>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,16,14,0.5)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: 30, borderTopRightRadius: 30,
    paddingHorizontal: 20, paddingTop: 12,
  },
  grabber: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: theme.color.border, marginBottom: 14,
  },
  title: { ...theme.type.title3, color: theme.color.ink, textAlign: 'center' },

  monthRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 14, marginBottom: 8,
  },
  arrow: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  monthLabel: { ...theme.type.bodyStrong, color: theme.color.ink, fontSize: 16 },

  weekRow: { flexDirection: 'row', marginTop: 4 },
  weekday: {
    flex: 1, textAlign: 'center', ...theme.type.caption,
    color: theme.color.inkMuted, fontWeight: '800',
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  // Exactly a seventh each, so the columns sit under their weekday letters.
  cellWrap: { width: `${100 / 7}%`, paddingVertical: 3, alignItems: 'center' },
  cell: {
    width: 40, height: 40, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  cellSelected: { backgroundColor: theme.color.brandPrimary },
  cellToday: { borderWidth: 1.5, borderColor: theme.color.borderStrong },
  cellText: { ...theme.type.body, color: theme.color.ink, fontWeight: '600' },
  cellTextOutside: { color: theme.color.inkFaint },
  cellTextSelected: { color: '#FFFFFF', fontWeight: '800' },

  quick: { flexDirection: 'row', gap: 10, marginTop: 14, marginBottom: 6 },
  quickBtn: {
    height: 44, borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  quickText: { ...theme.type.small, color: theme.color.ink, fontWeight: '700' },
});
