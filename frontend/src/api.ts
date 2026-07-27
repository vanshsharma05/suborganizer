import { supabase } from './supabase';

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
  created_at?: string;
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

export async function upgradeToPro(): Promise<void> {
  const id = await currentUserId();
  const { error } = await supabase.from('profiles').update({ is_pro: true }).eq('id', id);
  if (error) throw new Error(error.message);
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
  const until = new Date();
  until.setDate(until.getDate() + Math.max(1, days));

  const { data, error } = await supabase
    .from('subscriptions')
    .update({ snoozed_until: until.toISOString().split('T')[0] })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return toSub(data);
}

/**
 * Advance a renewal by one billing cycle — the "Keep it" reminder action.
 * Ported from the old backend's advance_renewal(), including the month-end
 * clamp so 31 Jan on a monthly cycle lands on 28/29 Feb rather than overflowing
 * into March.
 */
export function advanceRenewal(nextRenewalISO: string, cycle: string): string {
  const [y, m, d] = nextRenewalISO.split('-').map(Number);

  if (cycle === 'weekly') {
    const dt = new Date(Date.UTC(y, m - 1, d + 7));
    return dt.toISOString().split('T')[0];
  }

  if (cycle === 'yearly') {
    const lastDay = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
    const dt = new Date(Date.UTC(y + 1, m - 1, Math.min(d, lastDay)));
    return dt.toISOString().split('T')[0];
  }

  // monthly
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const dt = new Date(Date.UTC(ny, nm - 1, Math.min(d, lastDay)));
  return dt.toISOString().split('T')[0];
}

export async function keepSubscription(sub: Subscription): Promise<Subscription> {
  const { data, error } = await supabase
    .from('subscriptions')
    .update({
      next_renewal: advanceRenewal(sub.next_renewal, sub.billing_cycle),
      snoozed_until: null,
    })
    .eq('id', sub.id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return toSub(data);
}

// ----------------------------------------------------------------- reminders --

/**
 * Active subs inside their reminder window, soonest first, excluding snoozed
 * ones. The old backend computed this in GET /reminders; with the whole list
 * already in memory it is cheaper to derive it on the client.
 */
export function deriveReminders(subs: Subscription[]): ReminderItem[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const items: ReminderItem[] = [];

  for (const s of subs) {
    if (s.status !== 'active') continue;

    if (s.snoozed_until) {
      const snoozed = new Date(s.snoozed_until);
      snoozed.setHours(0, 0, 0, 0);
      if (snoozed > today) continue;
    }

    const renew = new Date(s.next_renewal);
    renew.setHours(0, 0, 0, 0);
    const daysLeft = Math.round((renew.getTime() - today.getTime()) / 86_400_000);

    const window = s.reminder_days_before ?? 3;
    if (daysLeft > window) continue;

    items.push({
      ...s,
      days_left: daysLeft,
      urgency:
        daysLeft < 0 ? 'overdue' : daysLeft === 0 ? 'today' : daysLeft <= 2 ? 'soon' : 'upcoming',
    });
  }

  return items.sort((a, b) => a.days_left - b.days_left);
}
