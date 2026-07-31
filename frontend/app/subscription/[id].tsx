/**
 * Add or edit a subscription.
 *
 * A form for something that costs money should show what it costs while you are
 * typing it, so the card at the top is live: the logo resolves from the domain,
 * and the figure underneath is the *monthly equivalent*, which is the number the
 * rest of the app will use. Somebody entering ₹1,490 a year finds out here that
 * it is ₹124 a month, rather than discovering the app disagrees with their
 * mental arithmetic three screens later.
 *
 * The order is deliberate: amount first, because it is the only field the user
 * definitely knows and the one they came to type. Name and category follow.
 * Anything optional is below the fold.
 */

import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { format } from 'date-fns';

import { theme, CATEGORIES, CATEGORY_COLORS } from '@/src/theme';
import { useAuth } from '@/src/auth-context';
import {
  createSubscription, deleteSubscription, toggleSubscription, updateSubscription,
} from '@/src/api';
import { BrandAvatar, Button, Chip, Field, IconButton, Segmented } from '@/src/ui';
import { Press, Reveal } from '@/src/motion';
import { CURRENCIES, fmtMoney, symbolFor } from '@/src/currency';
import { monthlyEquivalent } from '@/src/cycles';
import { addDaysISO, parseISODate, shiftISODate } from '@/src/dates';

type Cycle = 'weekly' | 'monthly' | 'yearly';

/** A `YYYY-MM-DD` column rendered for display, tolerating a malformed value. */
function prettyDate(iso: string): string {
  const d = parseISODate(iso);
  return d ? format(d, 'EEE, d MMM yyyy') : iso;
}

export default function SubscriptionForm() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const { subs, refreshSubs } = useAuth();

  const existing = !isNew ? subs.find((x) => x.id === id) : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [amount, setAmount] = useState(existing?.amount ? String(existing.amount) : '');
  const [currency, setCurrency] = useState<string>(existing?.currency ?? 'INR');
  const [cycle, setCycle] = useState<Cycle>((existing?.billing_cycle as Cycle) ?? 'monthly');
  const [category, setCategory] = useState(existing?.category ?? 'Entertainment');
  const [domain, setDomain] = useState(existing?.domain ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [reminderDays, setReminderDays] = useState(existing?.reminder_days_before ?? 3);
  const [date, setDate] = useState(() => existing?.next_renewal ?? addDaysISO(new Date(), 30));
  const [isTrial, setIsTrial] = useState(existing?.is_trial ?? false);
  const [trialEnds, setTrialEnds] = useState<string | null>(existing?.trial_ends ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const numeric = Number.parseFloat(amount);
  const valid = Number.isFinite(numeric) && numeric >= 0;

  const monthly = useMemo(
    () => (valid ? monthlyEquivalent(numeric, cycle) : 0),
    [valid, numeric, cycle],
  );

  /**
   * Turning on "free trial" seeds an end date and moves the renewal to match it,
   * since the first charge lands when the trial converts. Common trial lengths
   * are 7, 14 and 30 days; 14 is the least-wrong default.
   */
  const toggleTrial = () => {
    if (isTrial) {
      setIsTrial(false);
      setTrialEnds(null);
      return;
    }
    const seed = trialEnds ?? addDaysISO(new Date(), 14);
    setIsTrial(true);
    setTrialEnds(seed);
    setDate(seed);
  };

  const setTrialLength = (days: number) => {
    const end = addDaysISO(new Date(), days);
    setTrialEnds(end);
    setDate(end);
  };

  const save = async () => {
    setErr(null);
    if (!name.trim()) return setErr('Give it a name.');
    if (!amount.trim()) return setErr('Enter what it costs.');
    if (!valid) return setErr('That amount does not look right.');

    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        amount: numeric,
        billing_cycle: cycle,
        category,
        currency,
        next_renewal: date,
        domain: domain.trim() || null,
        notes: notes.trim() || null,
        brand_color: existing?.brand_color ?? null,
        status: existing?.status ?? ('active' as const),
        reminder_days_before: reminderDays,
        snoozed_until: existing?.snoozed_until ?? null,
        is_trial: isTrial,
        // Never keep a stale end date on a subscription that is no longer a
        // trial — trialDaysLeft() reads both, and a leftover date would make a
        // paid subscription look free.
        trial_ends: isTrial ? trialEnds : null,
      };

      if (isNew) await createSubscription(body);
      else await updateSubscription(id, body);

      await refreshSubs();
      router.back();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    if (!existing) return;
    Alert.alert(
      `Delete ${existing.name}?`,
      'This removes it and its history from your account. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteSubscription(existing.id);
            await refreshSubs();
            router.back();
          },
        },
      ],
    );
  };

  const accent = CATEGORY_COLORS[category] ?? theme.color.brand;

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <IconButton icon="close" onPress={() => router.back()} size={40} testID="form-close" />
        <Text style={s.headerTitle}>{isNew ? 'New subscription' : 'Edit'}</Text>
        {existing ? (
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <IconButton
              icon={existing.status === 'active' ? 'pause' : 'play'}
              onPress={async () => {
                await toggleSubscription(existing.id, existing.status);
                await refreshSubs();
                router.back();
              }}
              size={40}
              tone="brand"
              testID="form-toggle-status"
            />
            <IconButton icon="trash-outline" onPress={confirmDelete} size={40} testID="form-delete" />
          </View>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 180 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Live preview. Everything below writes into it as you type, which is
              what turns a form into an object you are building. */}
          <Reveal>
            <View style={[s.preview, { borderColor: accent + '30' }]}>
              <BrandAvatar sub={{ name: name || 'New', domain: domain || undefined }} size={52} />
              <View style={{ flex: 1 }}>
                <Text style={s.previewName} numberOfLines={1}>
                  {name.trim() || 'Untitled subscription'}
                </Text>
                <View style={s.previewMeta}>
                  <View style={[s.dot, { backgroundColor: accent }]} />
                  <Text style={s.previewCat}>{category}</Text>
                  {isTrial && <Text style={s.previewTrial}>· on trial</Text>}
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.previewAmount}>
                  {valid ? fmtMoney(numeric, currency) : '—'}
                </Text>
                {/* The comparable figure, always. It is what every total in the
                    app is built from, so it should never be a surprise. */}
                {valid && cycle !== 'monthly' && (
                  <Animated.Text entering={FadeIn.duration(200)} style={s.previewMonthly}>
                    {fmtMoney(monthly, currency)}/mo
                  </Animated.Text>
                )}
              </View>
            </View>
          </Reveal>

          <Text style={s.label}>What it costs</Text>
          <View style={s.amountRow}>
            <Press
              onPress={() => {
                const idx = CURRENCIES.indexOf(currency as (typeof CURRENCIES)[number]);
                setCurrency(CURRENCIES[(idx + 1) % CURRENCIES.length]);
              }}
              scale={0.93}
              testID="form-currency"
            >
              <View style={s.currency}>
                <Text style={s.currencySymbol}>{symbolFor(currency)}</Text>
                <Text style={s.currencyCode}>{currency}</Text>
              </View>
            </Press>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              placeholderTextColor={theme.color.inkFaint}
              keyboardType="decimal-pad"
              style={s.amountInput}
              testID="form-amount"
            />
          </View>

          <Text style={s.label}>Billed</Text>
          <Segmented<Cycle>
            options={[
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
              { value: 'yearly', label: 'Yearly' },
            ]}
            value={cycle}
            onChange={setCycle}
            testID="form-cycle"
          />

          <View style={{ height: 20 }} />
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Netflix"
            autoCapitalize="words"
            testID="form-name"
          />

          <View style={{ height: 16 }} />
          <Field
            label="Website (for the logo)"
            value={domain ?? ''}
            onChangeText={setDomain}
            placeholder={name.trim() ? `${name.trim().toLowerCase().replace(/\s+/g, '')}.com` : 'netflix.com'}
            autoCapitalize="none"
            testID="form-domain"
          />

          <Text style={s.label}>Category</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingRight: 20 }}
            style={{ marginHorizontal: -2 }}
          >
            {CATEGORIES.map((c) => (
              <Chip
                key={c}
                label={c}
                active={category === c}
                onPress={() => setCategory(c)}
                testID={`form-cat-${c}`}
              />
            ))}
          </ScrollView>

          <Text style={s.label}>Free trial</Text>
          <Press onPress={toggleTrial} scale={0.99} testID="form-trial-toggle">
            <View style={[s.trial, isTrial && { borderColor: theme.color.brandSecondary }]}>
              <View style={[s.check, isTrial && s.checkOn]}>
                {isTrial && <Ionicons name="checkmark" size={15} color="#FFFFFF" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.trialTitle}>I am on a free trial</Text>
                <Text style={s.trialHint}>
                  {isTrial
                    ? 'Kept out of your monthly total until it converts'
                    : 'You get warned 7 days, 2 days and the morning it ends'}
                </Text>
              </View>
            </View>
          </Press>

          {isTrial && (
            <Animated.View layout={LinearTransition} entering={FadeIn.duration(220)}>
              <View style={s.bumps}>
                {[7, 14, 30].map((d) => (
                  <Chip
                    key={d}
                    label={`${d} days`}
                    active={trialEnds === addDaysISO(new Date(), d)}
                    onPress={() => setTrialLength(d)}
                    testID={`form-trial-${d}`}
                  />
                ))}
              </View>
              {trialEnds !== null && (
                <Text style={s.trialEnds}>
                  Ends {prettyDate(trialEnds)} — first charge lands that day
                </Text>
              )}
            </Animated.View>
          )}

          <Text style={s.label}>{isTrial ? 'First charge' : 'Next renewal'}</Text>
          <View style={s.dateBox}>
            <Ionicons name="calendar-outline" size={17} color={theme.color.inkMuted} />
            <Text style={s.dateText}>{prettyDate(date)}</Text>
          </View>
          <View style={s.bumps}>
            {[1, 7, 14, 30].map((d) => (
              <Chip
                key={d}
                label={`+${d}d`}
                onPress={() => setDate((prev) => shiftISODate(prev, d))}
                testID={`form-bump-${d}`}
              />
            ))}
            <Chip
              label="−1d"
              onPress={() => setDate((prev) => shiftISODate(prev, -1))}
              testID="form-bump--1"
            />
          </View>

          <Text style={s.label}>Remind me</Text>
          <View style={s.bumps}>
            {[1, 3, 7, 14].map((d) => (
              <Chip
                key={d}
                label={`${d} day${d === 1 ? '' : 's'} before`}
                active={reminderDays === d}
                onPress={() => setReminderDays(d)}
                testID={`form-remind-${d}`}
              />
            ))}
          </View>

          <View style={{ height: 20 }} />
          <Field
            label="Notes"
            value={notes ?? ''}
            onChangeText={setNotes}
            placeholder="Family plan, shared with…"
            multiline
            testID="form-notes"
          />

          {err !== null && (
            <Animated.View entering={FadeIn.duration(200)} style={s.error}>
              <Ionicons name="alert-circle" size={16} color={theme.color.error} />
              <Text style={s.errorText} testID="form-error">{err}</Text>
            </Animated.View>
          )}
        </ScrollView>

        <View style={[s.footer, { paddingBottom: insets.bottom + 14 }]}>
          <Button
            label={isNew ? 'Add subscription' : 'Save changes'}
            onPress={save}
            loading={busy}
            icon={isNew ? 'add-circle' : 'checkmark-circle'}
            testID="form-save"
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingBottom: 10,
  },
  headerTitle: { ...theme.type.bodyStrong, color: theme.color.ink },

  preview: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: theme.color.raised, borderRadius: theme.radius.lg,
    padding: 16, borderWidth: 1.5,
    ...theme.shadow.md,
  },
  previewName: { ...theme.type.title3, color: theme.color.ink },
  previewMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  previewCat: { ...theme.type.caption, color: theme.color.inkSoft },
  previewTrial: { ...theme.type.caption, color: theme.color.brandSecondary, fontWeight: '700' },
  previewAmount: { fontSize: 19, fontWeight: '800', color: theme.color.ink, letterSpacing: -0.6 },
  previewMonthly: { ...theme.type.caption, color: theme.color.brandSecondary, fontWeight: '700' },

  label: { ...theme.type.overline, color: theme.color.inkMuted, marginTop: 26, marginBottom: 10 },

  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  currency: {
    alignItems: 'center', justifyContent: 'center',
    width: 62, height: 62, borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceSecondary,
  },
  currencySymbol: { color: theme.color.ink, fontSize: 24, fontWeight: '800', lineHeight: 28 },
  currencyCode: { color: theme.color.inkMuted, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6 },
  amountInput: {
    flex: 1, fontSize: 46, fontWeight: '800', color: theme.color.ink,
    letterSpacing: -2, padding: 0, includeFontPadding: false,
  },

  trial: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: theme.color.raised, borderRadius: theme.radius.md,
    padding: 16, borderWidth: 1.5, borderColor: theme.color.border,
  },
  check: {
    width: 24, height: 24, borderRadius: 8,
    borderWidth: 2, borderColor: theme.color.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: theme.color.brandSecondary, borderColor: theme.color.brandSecondary },
  trialTitle: { ...theme.type.bodyStrong, color: theme.color.ink },
  trialHint: { ...theme.type.caption, color: theme.color.inkMuted, marginTop: 2 },
  trialEnds: {
    ...theme.type.small, color: theme.color.brandSecondary, fontWeight: '700', marginTop: 10,
  },

  dateBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    height: 54, borderRadius: theme.radius.md, paddingHorizontal: 16,
    backgroundColor: theme.color.raised,
    borderWidth: 1.5, borderColor: theme.color.border,
  },
  dateText: { ...theme.type.bodyStrong, color: theme.color.ink },
  bumps: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 },

  error: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20,
    backgroundColor: theme.color.errorTint, borderRadius: theme.radius.md, padding: 13,
  },
  errorText: { flex: 1, color: theme.color.error, ...theme.type.small },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 20, paddingTop: 14,
    backgroundColor: theme.color.surface,
    borderTopWidth: 1, borderTopColor: theme.color.border,
  },
});
