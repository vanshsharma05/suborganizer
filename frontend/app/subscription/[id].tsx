import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { theme, CATEGORIES } from '@/src/theme';
import { useAuth } from '@/src/auth-context';
import { api, Subscription } from '@/src/api';
import { GradientButton, Chip } from '@/src/ui';
import { format } from 'date-fns';

export default function SubscriptionForm() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const { subs, refreshSubs, refreshReminders } = useAuth();

  const existing = !isNew ? subs.find((s) => s.id === id) : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [amount, setAmount] = useState(existing?.amount ? String(existing.amount) : '');
  const [cycle, setCycle] = useState<'monthly' | 'yearly' | 'weekly'>((existing?.billing_cycle as any) ?? 'monthly');
  const [category, setCategory] = useState(existing?.category ?? 'Entertainment');
  const [domain, setDomain] = useState(existing?.domain ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [reminderDays, setReminderDays] = useState<number>(existing?.reminder_days_before ?? 3);
  const [date, setDate] = useState(() => {
    if (existing?.next_renewal) return existing.next_renewal;
    const d = new Date(); d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    if (!name.trim() || !amount) { setErr('Name and amount are required'); return; }
    const num = parseFloat(amount);
    if (isNaN(num) || num < 0) { setErr('Invalid amount'); return; }
    setBusy(true);
    try {
      const body = {
        name: name.trim(), amount: num, billing_cycle: cycle, category,
        next_renewal: date, domain: domain.trim() || null, notes: notes.trim() || null,
        status: existing?.status || 'active',
        reminder_days_before: reminderDays,
      };
      if (isNew) {
        await api<Subscription>('/subscriptions', { method: 'POST', body });
      } else {
        await api<Subscription>(`/subscriptions/${id}`, { method: 'PUT', body });
      }
      await Promise.all([refreshSubs(), refreshReminders()]);
      router.back();
    } catch (e: any) {
      setErr(e.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const bumpDate = (days: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().split('T')[0]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="form-close">
          <Ionicons name="close" size={22} color={theme.color.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>{isNew ? 'New subscription' : 'Edit'}</Text>
        {!isNew && existing ? (
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <Pressable
              onPress={async () => {
                await api(`/subscriptions/${existing.id}/toggle`, { method: 'POST' });
                await Promise.all([refreshSubs(), refreshReminders()]);
                router.back();
              }}
              style={styles.iconBtn}
              testID="form-toggle-status"
            >
              <Ionicons
                name={existing.status === 'active' ? 'pause-circle-outline' : 'play-circle-outline'}
                size={22} color={theme.color.brandSecondary}
              />
            </Pressable>
            <Pressable
              onPress={async () => {
                await api(`/subscriptions/${existing.id}`, { method: 'DELETE' });
                await Promise.all([refreshSubs(), refreshReminders()]);
                router.back();
              }}
              style={styles.iconBtn}
              testID="form-delete"
            >
              <Ionicons name="trash-outline" size={20} color={theme.color.error} />
            </Pressable>
          </View>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 200 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionLbl}>Amount</Text>
          <View style={styles.amountRow}>
            <Text style={styles.currency}>$</Text>
            <TextInput
              value={amount} onChangeText={setAmount}
              placeholder="0.00" placeholderTextColor={theme.color.inkMuted}
              keyboardType="decimal-pad" style={styles.amountInput}
              testID="form-amount"
            />
          </View>

          <Text style={styles.sectionLbl}>Billing cycle</Text>
          <View style={styles.cycleRow}>
            {(['weekly', 'monthly', 'yearly'] as const).map((c) => (
              <Pressable
                key={c} onPress={() => setCycle(c)}
                style={[styles.cycleBtn, cycle === c && styles.cycleBtnActive]}
                testID={`form-cycle-${c}`}
              >
                <Text style={[styles.cycleTxt, cycle === c && styles.cycleTxtActive]}>{c[0].toUpperCase() + c.slice(1)}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.sectionLbl}>Name</Text>
          <TextInput
            value={name} onChangeText={setName}
            placeholder="Netflix" placeholderTextColor={theme.color.inkMuted}
            style={styles.input} testID="form-name"
          />

          <Text style={styles.sectionLbl}>Domain (for brand logo)</Text>
          <TextInput
            value={domain || ''} onChangeText={setDomain}
            placeholder="netflix.com" placeholderTextColor={theme.color.inkMuted}
            style={styles.input} autoCapitalize="none" testID="form-domain"
          />

          <Text style={styles.sectionLbl}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {CATEGORIES.map((c) => (
              <Chip key={c} label={c} active={category === c} onPress={() => setCategory(c)} testID={`form-cat-${c}`} />
            ))}
          </ScrollView>

          <Text style={styles.sectionLbl}>Next renewal</Text>
          <View style={styles.dateRow}>
            <View style={styles.dateBox}>
              <Text style={styles.dateVal}>{format(new Date(date), 'EEE, MMM d, yyyy')}</Text>
            </View>
          </View>
          <View style={styles.dateBumps}>
            {[7, 14, 30].map((d) => (
              <Pressable key={d} onPress={() => bumpDate(d)} style={styles.bumpBtn} testID={`form-bump-${d}`}>
                <Text style={styles.bumpTxt}>+{d}d</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => bumpDate(-1)} style={styles.bumpBtn} testID="form-bump--1">
              <Text style={styles.bumpTxt}>-1d</Text>
            </Pressable>
          </View>

          <Text style={styles.sectionLbl}>Remind me before charge</Text>
          <View style={styles.reminderRow}>
            {[1, 3, 7, 14].map((d) => (
              <Pressable
                key={d}
                onPress={() => setReminderDays(d)}
                style={[styles.reminderBtn, reminderDays === d && styles.reminderBtnActive]}
                testID={`form-remind-${d}`}
              >
                <Text style={[styles.reminderTxt, reminderDays === d && styles.reminderTxtActive]}>
                  {d}d before
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.sectionLbl}>Notes</Text>
          <TextInput
            value={notes || ''} onChangeText={setNotes}
            placeholder="Family plan…" placeholderTextColor={theme.color.inkMuted}
            style={[styles.input, { height: 80, textAlignVertical: 'top', paddingTop: 14 }]}
            multiline testID="form-notes"
          />

          {err && <Text style={styles.err}>{err}</Text>}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          {busy ? (
            <View style={styles.busyBtn}><ActivityIndicator color="#fff" /></View>
          ) : (
            <GradientButton onPress={save} label={isNew ? 'Add subscription' : 'Save changes'} testID="form-save" />
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: theme.color.ink, fontSize: 16, fontWeight: '700' },
  sectionLbl: { color: theme.color.brandPrimary, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 20, marginBottom: 10 },
  amountRow: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 4 },
  currency: { color: theme.color.inkSoft, fontSize: 36, fontWeight: '700', marginRight: 4, marginBottom: 6 },
  amountInput: { flex: 1, fontSize: 48, fontWeight: '800', color: theme.color.ink, letterSpacing: -1.5, paddingVertical: 0 },
  cycleRow: { flexDirection: 'row', backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.pill, padding: 4 },
  cycleBtn: { flex: 1, height: 42, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center' },
  cycleBtnActive: { backgroundColor: '#FFFFFF' },
  cycleTxt: { color: theme.color.inkSoft, fontWeight: '600' },
  cycleTxtActive: { color: theme.color.ink, fontWeight: '700' },
  input: { height: 52, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: theme.color.border, paddingHorizontal: 16, color: theme.color.ink, fontSize: 16 },
  dateRow: { flexDirection: 'row', gap: 8 },
  dateBox: { flex: 1, height: 52, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: theme.color.border, paddingHorizontal: 16, justifyContent: 'center' },
  dateVal: { color: theme.color.ink, fontSize: 15, fontWeight: '600' },
  dateBumps: { flexDirection: 'row', gap: 8, marginTop: 8 },
  bumpBtn: { paddingHorizontal: 14, height: 36, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  bumpTxt: { color: theme.color.ink, fontWeight: '700', fontSize: 13 },
  reminderRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  reminderBtn: {
    paddingHorizontal: 14, height: 40, borderRadius: theme.radius.pill,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: theme.color.border,
    alignItems: 'center', justifyContent: 'center',
  },
  reminderBtnActive: { backgroundColor: theme.color.ink, borderColor: theme.color.ink },
  reminderTxt: { color: theme.color.inkSoft, fontSize: 13, fontWeight: '600' },
  reminderTxtActive: { color: '#FFFFFF', fontWeight: '700' },
  err: { color: theme.color.error, marginTop: 14, fontWeight: '600' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: theme.color.surface, borderTopWidth: 1, borderTopColor: theme.color.border },
  busyBtn: { height: 56, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandDeep, alignItems: 'center', justifyContent: 'center' },
});
