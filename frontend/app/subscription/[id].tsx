/**
 * Add or edit a subscription.
 *
 * Two rules, after the first version of this screen turned into a wall of pills:
 *
 *   One control per question, and the control matches the question. A date gets
 *   a calendar, a choice of three gets a segment, a choice of ten gets a grid.
 *   The version this replaced asked for a renewal date with "+7d / +14d / −1d"
 *   buttons, which is arithmetic homework dressed as an input.
 *
 *   Show the consequence next to the input. The card at the top is live — logo,
 *   name, and the *monthly equivalent* of whatever has been typed — so someone
 *   entering Rs 1,490 a year learns here that it is Rs 124 a month, rather than
 *   finding out three screens later that the app disagrees with their mental
 *   arithmetic.
 *
 * Order is by how sure the user is: the amount they came to type, then the name,
 * then everything optional.
 */

import React, { useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView, KeyboardAvoidingView, Platform, Alert,
  ActivityIndicator,
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
  type Subscription,
} from '@/src/api';
import { BrandAvatar, Button, Field, IconButton, Segmented } from '@/src/ui';
import { Press, Reveal } from '@/src/motion';
import { DateSheet } from '@/src/date-sheet';
import { CURRENCIES, fmtMoney, symbolFor } from '@/src/currency';
import { anchorDayOf, monthlyEquivalent } from '@/src/cycles';
import { addDaysISO, parseISODate, toISODate } from '@/src/dates';
import { chargeDates, spentSince, trackedDays } from '@/src/spend-history';
import {
  cancelledAtStore, describePaymentMethod, unpackPaymentMethod, type PaymentKind,
} from '@/src/gmail';

type Cycle = 'weekly' | 'monthly' | 'yearly';

/** One glyph per instrument, so the row reads before the text does. */
function payIcon(kind: PaymentKind): keyof typeof Ionicons.glyphMap {
  switch (kind) {
    case 'card': return 'card-outline';
    case 'upi': return 'phone-portrait-outline';
    case 'netbanking': return 'business-outline';
    case 'wallet': return 'wallet-outline';
    case 'appstore': return 'logo-apple';
    case 'playstore': return 'logo-google-playstore';
    case 'paypal': return 'logo-paypal';
  }
}

/** A `YYYY-MM-DD` column rendered for display, tolerating a malformed value. */
function prettyDate(iso: string): string {
  const d = parseISODate(iso);
  return d ? format(d, 'EEE, d MMM yyyy') : iso;
}

/** A labelled row that opens something. Used for both dates. */
function PickerRow({
  icon, label, value, onPress, tone, testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  onPress: () => void;
  tone?: 'teal';
  testID?: string;
}) {
  const fg = tone === 'teal' ? theme.color.brandSecondary : theme.color.brandPrimary;
  const bg = tone === 'teal' ? theme.color.brandSecondaryTint : theme.color.brandTint;

  return (
    <Press onPress={onPress} scale={0.985} testID={testID}>
      <View style={s.picker}>
        <View style={[s.pickerIcon, { backgroundColor: bg }]}>
          <Ionicons name={icon} size={17} color={fg} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.pickerLabel}>{label}</Text>
          <Text style={s.pickerValue}>{value}</Text>
        </View>
        <Ionicons name="chevron-forward" size={17} color={theme.color.inkFaint} />
      </View>
    </Press>
  );
}

/**
 * Works out which subscription is being edited before the form exists.
 *
 * The form seeds every field from `existing` in `useState` initialisers, and
 * those run once. If the list had not arrived yet, `existing` was undefined and
 * the whole form initialised blank — while the header still said "Edit" and the
 * id in the URL still pointed at a real subscription. Saving from there wrote
 * those blanks over the record, losing its notes, logo, trial dates and paused
 * state.
 *
 * That is reachable without any deep linking: Android may kill and restore a
 * screen, and expo-router restores the route while the list starts empty.
 *
 * So the form is not mounted until there is something to seed it with, and the
 * key makes it remount if the identity ever changes underneath it.
 */
export default function SubscriptionForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const { subs, subsLoading } = useAuth();

  const existing = !isNew ? subs.find((x) => x.id === id) : undefined;

  if (!isNew && !existing) return <Resolving loading={subsLoading} />;

  return <Form key={existing?.id ?? 'new'} id={id} isNew={isNew} existing={existing} />;
}

/** Holds the screen while the list loads, and admits it when the id is gone. */
function Resolving({ loading }: { loading: boolean }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[s.resolving, { paddingTop: insets.top + 8 }]}>
      <View style={s.resolvingHead}>
        <IconButton icon="close" onPress={() => router.back()} size={40} testID="form-close" />
      </View>
      <View style={s.resolvingBody}>
        {loading ? (
          <>
            <ActivityIndicator color={theme.color.brand} />
            <Text style={s.resolvingText}>Loading this subscription</Text>
          </>
        ) : (
          <>
            <Ionicons name="help-circle-outline" size={34} color={theme.color.inkMuted} />
            <Text style={s.resolvingText}>That subscription is no longer here</Text>
            <Button
              label="Go back"
              variant="ghost"
              size="md"
              onPress={() => router.back()}
              testID="form-not-found-back"
            />
          </>
        )}
      </View>
    </View>
  );
}

function Form({
  id, isNew, existing,
}: {
  id: string;
  isNew: boolean;
  existing?: Subscription;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { refreshSubs, priceChanges } = useAuth();

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

  const [pickingRenewal, setPickingRenewal] = useState(false);
  const [pickingTrialEnd, setPickingTrialEnd] = useState(false);
  const [showMore, setShowMore] = useState(!isNew);

  /**
   * What the form looked like when it opened.
   *
   * Captured on the first render, when every piece of state still holds its
   * seeded value, so comparing against it says whether anything has been
   * touched. Closing used to throw the lot away silently — on a form with
   * eleven inputs, one mis-tap on an unlabelled X.
   */
  const opened = useRef({
    name, amount, currency, cycle, category, domain, notes,
    reminderDays, date, isTrial, trialEnds,
  }).current;

  const dirty =
    name !== opened.name ||
    amount !== opened.amount ||
    currency !== opened.currency ||
    cycle !== opened.cycle ||
    category !== opened.category ||
    domain !== opened.domain ||
    notes !== opened.notes ||
    reminderDays !== opened.reminderDays ||
    date !== opened.date ||
    isTrial !== opened.isTrial ||
    trialEnds !== opened.trialEnds;

  const close = () => {
    if (!dirty) return router.back();
    Alert.alert(
      'Discard your changes?',
      isNew ? 'This subscription will not be added.' : 'Your edits will not be saved.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => router.back() },
      ],
    );
  };

  const numeric = Number.parseFloat(amount);
  const valid = Number.isFinite(numeric) && numeric >= 0;
  const monthly = useMemo(
    () => (valid ? monthlyEquivalent(numeric, cycle) : 0),
    [valid, numeric, cycle],
  );

  /**
   * What this has already cost, reconstructed from the billing grid.
   *
   * Read from `existing` rather than from the form: the form is whatever is
   * being typed right now, and history is a fact about what was. Changing the
   * amount in the box must not rewrite what was paid last March.
   *
   * Null for anything paused or cancelled — those stopped being charged on a
   * day nothing recorded, so there is no honest figure to show. See
   * src/spend-history.ts.
   */
  /**
   * What the scan learned about how this is paid for.
   *
   * From the stored row, not the form: nobody types this, so there is nothing
   * being edited that it should reflect.
   */
  const payment = useMemo(
    () => unpackPaymentMethod(existing?.payment_method),
    [existing?.payment_method],
  );

  const paid = useMemo(() => {
    if (!existing) return null;

    const todayISO = toISODate(new Date());
    const changes = priceChanges.filter((c) => c.subscription_id === existing.id);
    const total = spentSince({
      nextRenewalISO: existing.next_renewal,
      cycle: existing.billing_cycle,
      anchorDay: existing.anchor_day,
      amount: existing.amount,
      status: existing.status,
      createdAtISO: existing.created_at,
      changes,
      todayISO,
    });
    if (total === null || total <= 0) return null;

    return {
      total,
      charges: chargeDates({
        nextRenewalISO: existing.next_renewal,
        cycle: existing.billing_cycle,
        anchorDay: existing.anchor_day,
        fromISO: (existing.created_at ?? '').slice(0, 10),
        todayISO,
      }).length,
      days: trackedDays(existing.created_at, todayISO),
    };
  }, [existing, priceChanges]);

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

  const save = async () => {
    setErr(null);
    if (!name.trim()) return setErr('Give it a name.');
    if (!amount.trim()) return setErr('Enter what it costs.');
    if (!valid) return setErr('That amount does not look right.');
    // is_trial with no end date leaves trialDaysLeft with nothing to read, so
    // the row renders as a trial that never ends and never warns.
    if (isTrial && trialEnds === null) return setErr('Pick the day the trial ends.');

    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        amount: numeric,
        billing_cycle: cycle,
        category,
        currency,
        next_renewal: date,
        // The billing day only moves when the user actually moves the date.
        //
        // Deriving it from `date` unconditionally would be wrong for one month
        // a year: a subscription billed on the 31st sits on 28 February for
        // that month, and someone correcting a typo in the name would silently
        // rewrite the anchor to 28 — losing the 31st for good, which is the
        // exact bug the column exists to prevent.
        anchor_day: date === existing?.next_renewal
          ? existing?.anchor_day ?? anchorDayOf(date)
          : anchorDayOf(date),
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
            // Unguarded, a failed delete closed the alert and did nothing else:
            // no error, no navigation, the subscription still listed. The user
            // has just confirmed "cannot be undone" and is entitled to know
            // whether it happened.
            try {
              await deleteSubscription(existing.id);
            } catch (e) {
              setErr(e instanceof Error ? e.message : 'Could not delete that.');
              return;
            }
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
        <IconButton icon="close" onPress={close} size={40} testID="form-close" />
        <Text style={s.headerTitle}>{isNew ? 'New subscription' : 'Edit'}</Text>
        {existing ? (
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <IconButton
              icon={existing.status === 'active' ? 'pause' : 'play'}
              onPress={async () => {
                // Same as delete: without this, pausing while offline simply
                // did nothing and the button read as broken.
                try {
                  await toggleSubscription(existing.id, existing.status);
                } catch (e) {
                  setErr(e instanceof Error ? e.message : 'Could not change that.');
                  return;
                }
                await refreshSubs();
                router.back();
              }}
              accessibilityLabel={existing.status === 'active' ? 'Pause this subscription' : 'Resume this subscription'}
              size={40}
              tone="brand"
              testID="form-toggle-status"
            />
            <IconButton
              icon="trash-outline"
              onPress={confirmDelete}
              size={40}
              accessibilityLabel="Delete this subscription"
              testID="form-delete"
            />
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
          contentContainerStyle={{ padding: 20, paddingBottom: 190 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Live preview. Everything below writes into it, which is what turns
              a form into an object you are building. */}
          <Reveal>
            <View style={[s.preview, { borderColor: accent + '33' }]}>
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
                <Text style={s.previewAmount}>{valid ? fmtMoney(numeric, currency) : '—'}</Text>
                {/* The comparable number. It is what every total in the app is
                    built from, so it should never be a surprise. */}
                {valid && cycle !== 'monthly' && (
                  <Animated.Text entering={FadeIn.duration(200)} style={s.previewMonthly}>
                    {fmtMoney(monthly, currency)}/mo
                  </Animated.Text>
                )}
              </View>
            </View>
          </Reveal>

          {/* The one number here that already happened.
              Everything else on this screen is a projection — what it costs a
              month, what renews next — and a projection is easy to shrug at.
              Worded "since you added this" because that is genuinely all the app
              knows: it has never been told when the subscription actually
              started, and "total paid" would be a smaller number than the truth
              wearing the truth's clothes. */}
          {paid !== null && (
            <Reveal delay={60}>
              <View style={s.paid} testID="form-paid">
                <Ionicons name="receipt-outline" size={15} color={theme.color.inkMuted} />
                <Text style={s.paidText}>
                  <Text style={s.paidAmount}>
                    {fmtMoney(paid.total, existing?.currency ?? currency)}
                  </Text>
                  {' since you added this — '}
                  {paid.charges} {paid.charges === 1 ? 'charge' : 'charges'}
                  {paid.days >= 30 && ` over ${Math.round(paid.days / 30)} months`}
                </Text>
              </View>
            </Reveal>
          )}

          {/* How the money leaves.
              Read-only and only shown when a receipt actually said so — this is
              something the scan learned, not a field anyone fills in, and an
              empty row inviting input would be a promise the app cannot keep.
              The store case earns its own line because it changes what
              cancelling even means: an App Store subscription cannot be stopped
              on the merchant's website at all. */}
          {payment !== null && (
            <Reveal delay={90}>
              <View style={s.paid} testID="form-payment">
                <Ionicons name={payIcon(payment.kind)} size={15} color={theme.color.inkMuted} />
                <Text style={s.paidText}>
                  <Text style={s.paidAmount}>{describePaymentMethod(payment)}</Text>
                  {payment.autopay && ' · renews automatically'}
                  {cancelledAtStore(payment) && (
                    <Text style={s.payStore}>
                      {`\nCancel this in ${payment.kind === 'appstore' ? 'the App Store' : 'Google Play'}, not on their website.`}
                    </Text>
                  )}
                </Text>
              </View>
            </Reveal>
          )}

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
                {/* Says what tapping does. Without it this looked like a label. */}
                <View style={s.currencySwap}>
                  <Ionicons name="swap-horizontal" size={9} color={theme.color.inkMuted} />
                  <Text style={s.currencyCode}>{currency}</Text>
                </View>
              </View>
            </Press>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              // inkFaint is 2.05:1 — decoration weight, and a placeholder is
              // text. inkMuted is the quietest token that still clears 4.5:1.
              placeholderTextColor={theme.color.inkMuted}
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

          <View style={{ height: 22 }} />
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Netflix"
            autoCapitalize="words"
            testID="form-name"
          />

          <Text style={s.label}>Category</Text>
          {/* A wrapped grid, not a horizontal scroller. Ten options that scroll
              sideways hide half of themselves and make you swipe to find out
              what you were not offered. */}
          <View style={s.catGrid}>
            {CATEGORIES.map((c) => {
              const on = category === c;
              const colour = CATEGORY_COLORS[c] ?? theme.color.brand;
              return (
                <Press
                  key={c}
                  onPress={() => setCategory(c)}
                  scale={0.94}
                  testID={`form-cat-${c}`}
                >
                  <View style={[s.cat, on && { backgroundColor: colour, borderColor: colour }]}>
                    {!on && <View style={[s.catDot, { backgroundColor: colour }]} />}
                    <Text style={[s.catText, on && s.catTextOn]}>{c}</Text>
                  </View>
                </Press>
              );
            })}
          </View>

          <Text style={s.label}>When</Text>
          <View style={{ gap: 10 }}>
            <Press onPress={toggleTrial} scale={0.985} testID="form-trial-toggle">
              <View style={[s.trial, isTrial && s.trialOn]}>
                <View style={[s.check, isTrial && s.checkOn]}>
                  {isTrial && <Ionicons name="checkmark" size={15} color="#FFFFFF" />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.trialTitle}>This is a free trial</Text>
                  <Text style={s.trialHint}>
                    {isTrial
                      ? 'Kept out of your monthly total until it converts'
                      : 'Warned 7 days, 2 days and the morning it ends'}
                  </Text>
                </View>
              </View>
            </Press>

            {isTrial && (
              <Animated.View layout={LinearTransition} entering={FadeIn.duration(200)}>
                <PickerRow
                  icon="hourglass"
                  label="Trial ends"
                  value={trialEnds !== null ? prettyDate(trialEnds) : 'Pick a date'}
                  onPress={() => setPickingTrialEnd(true)}
                  tone="teal"
                  testID="form-trial-date"
                />
              </Animated.View>
            )}

            <PickerRow
              icon="calendar"
              label={isTrial ? 'First charge' : 'Next renewal'}
              value={prettyDate(date)}
              onPress={() => setPickingRenewal(true)}
              testID="form-date"
            />
          </View>

          <Text style={s.label}>Remind me before it charges</Text>
          <Segmented<string>
            options={[
              { value: '1', label: '1 day' },
              { value: '3', label: '3 days' },
              { value: '7', label: '1 week' },
              { value: '14', label: '2 weeks' },
            ]}
            value={String(reminderDays)}
            onChange={(v) => setReminderDays(Number(v))}
            testID="form-remind"
          />

          {/* Folded away for new subscriptions. Neither of these is needed to
              save one, and a shorter form is a form people finish. */}
          {!showMore ? (
            <Press onPress={() => setShowMore(true)} scale={0.97} testID="form-more">
              <View style={s.more}>
                <Ionicons name="add-circle-outline" size={17} color={theme.color.inkSoft} />
                <Text style={s.moreText}>Add a logo or a note</Text>
              </View>
            </Press>
          ) : (
            <Animated.View entering={FadeIn.duration(200)} layout={LinearTransition}>
              <View style={{ height: 22 }} />
              <Field
                label="Website (for the logo)"
                value={domain ?? ''}
                onChangeText={setDomain}
                placeholder={
                  name.trim() ? `${name.trim().toLowerCase().replace(/\s+/g, '')}.com` : 'netflix.com'
                }
                autoCapitalize="none"
                testID="form-domain"
              />
              <View style={{ height: 16 }} />
              <Field
                label="Notes"
                value={notes ?? ''}
                onChangeText={setNotes}
                placeholder="Family plan, shared with…"
                multiline
                testID="form-notes"
              />
            </Animated.View>
          )}

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

      <DateSheet
        visible={pickingRenewal}
        value={date}
        title={isTrial ? 'First charge' : 'Next renewal'}
        onClose={() => setPickingRenewal(false)}
        onPick={setDate}
      />
      <DateSheet
        visible={pickingTrialEnd}
        value={trialEnds ?? date}
        title="Trial ends"
        onClose={() => setPickingTrialEnd(false)}
        onPick={(iso) => {
          setTrialEnds(iso);
          // The first charge is the day the trial converts. Keeping them in step
          // is the whole reason the trial flag exists.
          setDate(iso);
        }}
      />
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

  paid: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 10, paddingHorizontal: 4,
  },
  paidText: { flex: 1, ...theme.type.caption, color: theme.color.inkMuted },
  paidAmount: { fontWeight: '800', color: theme.color.inkSoft },
  payStore: { color: theme.color.brandSecondary, fontWeight: '700' },

  label: { ...theme.type.overline, color: theme.color.inkMuted, marginTop: 26, marginBottom: 10 },

  // One field, not a tile and a floating number. The currency swatch is the
  // left end of the same control, divided by a hairline rather than a gap, so
  // the amount reads as being inside something rather than adrift beside it.
  amountRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.lg,
    paddingRight: 20,
  },
  currency: {
    alignItems: 'center', justifyContent: 'center', gap: 1,
    width: 66, height: 72,
    borderRightWidth: 1, borderRightColor: theme.color.border,
  },
  currencySymbol: { color: theme.color.ink, fontSize: 24, fontWeight: '800', lineHeight: 28 },
  currencySwap: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  currencyCode: { color: theme.color.inkMuted, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.4 },
  amountInput: {
    flex: 1, height: 72, fontSize: 40, fontWeight: '800', color: theme.color.ink,
    letterSpacing: -1.6, paddingHorizontal: 18, paddingVertical: 0,
    includeFontPadding: false, textAlignVertical: 'center',
  },

  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cat: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 38, paddingHorizontal: 14, borderRadius: theme.radius.pill,
    backgroundColor: theme.color.raised,
    borderWidth: 1, borderColor: theme.color.border,
  },
  catDot: { width: 7, height: 7, borderRadius: 4 },
  catText: { ...theme.type.small, color: theme.color.inkSoft, fontWeight: '700' },
  catTextOn: { color: '#FFFFFF' },

  picker: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    backgroundColor: theme.color.raised, borderRadius: theme.radius.md,
    padding: 14, ...theme.shadow.sm,
  },
  pickerIcon: {
    width: 38, height: 38, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  pickerLabel: { ...theme.type.caption, color: theme.color.inkMuted },
  pickerValue: { ...theme.type.bodyStrong, color: theme.color.ink, marginTop: 2 },

  trial: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: theme.color.raised, borderRadius: theme.radius.md,
    padding: 14, borderWidth: 1.5, borderColor: 'transparent',
    ...theme.shadow.sm,
  },
  trialOn: { borderColor: theme.color.brandSecondary },
  check: {
    width: 24, height: 24, borderRadius: 8,
    borderWidth: 2, borderColor: theme.color.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: theme.color.brandSecondary, borderColor: theme.color.brandSecondary },
  trialTitle: { ...theme.type.bodyStrong, color: theme.color.ink },
  trialHint: { ...theme.type.caption, color: theme.color.inkMuted, marginTop: 2 },

  more: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 26, paddingVertical: 15, borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceSecondary,
  },
  moreText: { ...theme.type.small, color: theme.color.inkSoft, fontWeight: '700' },

  error: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20,
    backgroundColor: theme.color.errorTint, borderRadius: theme.radius.md, padding: 13,
  },
  errorText: { flex: 1, color: theme.color.error, ...theme.type.small },

  resolving: { flex: 1, backgroundColor: theme.color.surface },
  resolvingHead: { paddingHorizontal: 14, paddingBottom: 10 },
  resolvingBody: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 14, paddingHorizontal: 40, paddingBottom: 80,
  },
  resolvingText: { ...theme.type.body, color: theme.color.inkSoft, textAlign: 'center' },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 20, paddingTop: 14,
    backgroundColor: theme.color.surface,
    borderTopWidth: 1, borderTopColor: theme.color.border,
  },
});
