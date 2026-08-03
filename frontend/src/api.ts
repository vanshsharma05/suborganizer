import { advanceRenewal, currentRenewal } from './cycles';
import { addDaysISO, daysUntilISO, toISODate } from './dates';
import { supabase } from './supabase';

// Re-exported because callers reach for it alongside the queries here, but it
// lives in cycles.ts so it can be unit-tested without a Supabase client.
export { advanceRenewal };

export type Subscription = {
  id: string;
  name: string;
  amount: number;
  currency?: string; // 'INR' | 'USD' | 'EUR' etc.
  billing_cycle: 'monthly' | 'yearly' | 'weekly';
  category: string;
  next_renewal: string;
  domain?: string | null;
  brand_color?: string | null;
  notes?: string | null;
  status: 'active' | 'paused' | 'cancelled';
  reminder_days_before?: number;
  snoozed_until?: string | null;
  /** Started as a free trial. Whether it still *is* one comes from src/trials.ts. */
  is_trial?: boolean;
  trial_ends?: string | null;
  created_at?: string;
};

/** One logged amount change, newest first. Written by a trigger, never by us. */
export type PriceChange = {
  id: string;
  subscription_id: string;
  old_amount: number;
  new_amount: number;
  currency: string;
  changed_at: string;
};

export type ReminderItem = Subscription & {
  days_left: number;
  urgency: 'overdue' | 'today' | 'soon' | 'upcoming';
};

export type User = {
  id: string;
  email: string;
  name: string;
  is_pro: boolean;
  primary_currency?: string;
};

/** Payload accepted when creating or updating a subscription. */
export type SubscriptionInput = Omit<Subscription, 'id' | 'created_at'>;

// Numeric columns can arrive as strings from PostgREST depending on precision,
// so coerce once here rather than guarding at every call site.
function toSub(row: Record<string, any>): Subscription {
  return { ...row, amount: Number(row.amount) } as Subscription;
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Not signed in');
  return data.user.id;
}

// ------------------------------------------------------------------ profile --

export async function fetchProfile(): Promise<User | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('name, is_pro, primary_currency')
    .eq('id', auth.user.id)
    .single();

  // The row is created by a trigger on signup. If it is somehow missing, fall
  // back to auth metadata rather than blocking the user out of the app.
  if (error && error.code !== 'PGRST116') throw new Error(error.message);

  return {
    id: auth.user.id,
    email: auth.user.email ?? '',
    name: profile?.name ?? auth.user.email?.split('@')[0] ?? 'there',
    is_pro: profile?.is_pro ?? false,
    primary_currency: profile?.primary_currency ?? 'INR',
  };
}

export async function updatePrimaryCurrency(currency: string): Promise<void> {
  const id = await currentUserId();
  const { error } = await supabase
    .from('profiles')
    .update({ primary_currency: currency.toUpperCase() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Mirrors the store's answer onto the profile row.
 *
 * The durable record of a one-time purchase is Play's, not ours — this exists so
 * a fresh install is Pro before Play has been asked, and so Pro can be granted
 * by hand for a refund gone wrong. `false` is only ever used by the dev reset in
 * profile.tsx; nothing in the paid flow revokes anything.
 */
export async function setProFlag(is_pro: boolean): Promise<void> {
  const id = await currentUserId();
  const { error } = await supabase.from('profiles').update({ is_pro }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function upgradeToPro(): Promise<void> {
  return setProFlag(true);
}

// ------------------------------------------------------------ subscriptions --
// No user_id filter is needed on reads: the RLS policies in
// supabase/schema.sql scope every row to auth.uid() inside Postgres.

export async function listSubscriptions(): Promise<Subscription[]> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .order('next_renewal', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toSub);
}

export async function createSubscription(input: SubscriptionInput): Promise<Subscription> {
  const user_id = await currentUserId();

  // user_id must be set explicitly — the INSERT policy checks it matches
  // auth.uid(), and the column has no default.
  const { data, error } = await supabase
    .from('subscriptions')
    .insert({ ...input, user_id })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return toSub(data);
}

export async function updateSubscription(
  id: string,
  input: SubscriptionInput,
): Promise<Subscription> {
  const { data, error } = await supabase
    .from('subscriptions')
    .update(input)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return toSub(data);
}

/** Update only the named columns — used by the Gmail scan to reconcile drift. */
export async function patchSubscription(
  id: string,
  patch: Partial<SubscriptionInput>,
): Promise<Subscription> {
  const { data, error } = await supabase
    .from('subscriptions')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return toSub(data);
}

export async function deleteSubscription(id: string): Promise<void> {
  const { error } = await supabase.from('subscriptions').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function toggleSubscription(id: string, current: string): Promise<Subscription> {
  const { data, error } = await supabase
    .from('subscriptions')
    .update({ status: current === 'active' ? 'paused' : 'active' })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return toSub(data);
}

export async function cancelSubscription(id: string): Promise<Subscription> {
  const { data, error } = await supabase
    .from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return toSub(data);
}

export async function snoozeSubscription(id: string, days: number): Promise<Subscription> {
  const { data, error } = await supabase
    .from('subscriptions')
    .update({ snoozed_until: addDaysISO(new Date(), Math.max(1, days)) })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return toSub(data);
}

export async function keepSubscription(sub: Subscription): Promise<Subscription> {
  const { data, error } = await supabase
    .from('subscriptions')
    .update({
      // Rolled to the present before being advanced. Advancing the stored date
      // alone moved a three-month-stale subscription to two months stale, so
      // the reminder came straight back and "Keep it" looked like a dead button.
      next_renewal: advanceRenewal(
        currentRenewal(sub.next_renewal, sub.billing_cycle, toISODate(new Date())),
        sub.billing_cycle,
      ),
      snoozed_until: null,
    })
    .eq('id', sub.id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return toSub(data);
}

// ------------------------------------------------------------ price changes --

/**
 * Amount changes for the signed-in user, newest first.
 *
 * Rows are inserted by the `subscriptions_log_price_change` trigger, so this
 * catches an edit from the form and a reconcile from the Gmail scan alike.
 */
export async function listPriceChanges(limit = 50): Promise<PriceChange[]> {
  const { data, error } = await supabase
    .from('price_changes')
    .select('id, subscription_id, old_amount, new_amount, currency, changed_at')
    .order('changed_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    ...r,
    old_amount: Number(r.old_amount),
    new_amount: Number(r.new_amount),
  }));
}

/** Forget a logged change — the "dismiss" action on a price-rise card. */
export async function dismissPriceChange(id: string): Promise<void> {
  const { error } = await supabase.from('price_changes').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ----------------------------------------------------------------- reminders --

/**
 * Active subs inside their reminder window, soonest first, excluding snoozed
 * ones. The old backend computed this in GET /reminders; with the whole list
 * already in memory it is cheaper to derive it on the client.
 */
export function deriveReminders(subs: Subscription[], today: Date = new Date()): ReminderItem[] {
  const items: ReminderItem[] = [];
  const todayISO = toISODate(today);

  for (const s of subs) {
    if (s.status !== 'active') continue;

    // Still snoozed if the snooze date has not arrived yet.
    const snoozeIn = daysUntilISO(s.snoozed_until, today);
    if (snoozeIn !== null && snoozeIn > 0) continue;

    /*
     * Where the renewal has actually got to, not where it was last written.
     *
     * A stored date drifts into the past for anyone who does not open the app
     * every month, and a date in the past is inside every reminder window
     * forever. That is what pinned a badge to the Home tab that no amount of
     * reviewing would clear.
     *
     * `next_renewal` is replaced on the item too, so every screen reading this
     * list agrees with the day count beside it.
     */
    const renewal = currentRenewal(s.next_renewal, s.billing_cycle, todayISO);
    const daysLeft = daysUntilISO(renewal, today);
    if (daysLeft === null) continue;

    const window = s.reminder_days_before ?? 3;
    if (daysLeft > window) continue;

    items.push({
      ...s,
      next_renewal: renewal,
      days_left: daysLeft,
      // `overdue` is unreachable while currentRenewal is doing its job, and is
      // kept as the honest answer for a date it could not parse.
      urgency:
        daysLeft < 0 ? 'overdue' : daysLeft === 0 ? 'today' : daysLeft <= 2 ? 'soon' : 'upcoming',
    });
  }

  return items.sort((a, b) => a.days_left - b.days_left);
}
