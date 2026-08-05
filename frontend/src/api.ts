import { greetingName } from './apple';
import { advanceRenewal, anchorDayOf, currentRenewal } from './cycles';
import type { Database } from './database.types';
import { addDaysISO, daysUntilISO, toISODate } from './dates';
import { describeError, supabase } from './supabase';

/** What the table itself accepts, as opposed to what callers hand us. */
type SubInsert = Database['public']['Tables']['subscriptions']['Insert'];
type SubUpdate = Database['public']['Tables']['subscriptions']['Update'];

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
  /**
   * The day of the month the merchant bills on, when it is known.
   *
   * Not derivable from `next_renewal`: a subscription billed on the 31st is
   * stored as 28 February for one month a year, and stepping from that date
   * loses the 31st permanently. Absent on rows written before the column
   * existed, and on any database where the migration has not been run — every
   * caller falls back to the day in `next_renewal`, which is the old behaviour.
   */
  anchor_day?: number | null;
  /**
   * How this is paid for, packed as `kind|brand|last4|autopay`.
   *
   * Filled in by the Gmail scan when a receipt says. Absent on anything added
   * by hand, and on rows written before the column existed — every reader
   * copes, because unpackPaymentMethod returns null for anything it cannot
   * read. See src/gmail/payment-method.ts.
   */
  payment_method?: string | null;
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
    // Not `profile.name ?? localPart`: for anyone who signed in with Apple and
    // chose "Hide My Email", the local part is ten characters of hex, and the
    // signup trigger has already stored it *as* their name. greetingName knows
    // what that looks like. See apple.ts.
    name: greetingName({ storedName: profile?.name, email: auth.user.email }),
    is_pro: profile?.is_pro ?? false,
    primary_currency: profile?.primary_currency ?? 'INR',
  };
}

/**
 * Sets the name shown in the greeting.
 *
 * Written to the profile row rather than auth metadata because that row is what
 * fetchProfile reads; the metadata is updated alongside it so a fresh session
 * derived from the token alone says the same thing before any request lands.
 */
export async function setDisplayName(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;

  const id = await currentUserId();
  const { error } = await supabase.from('profiles').update({ name: trimmed }).eq('id', id);
  if (error) throw new Error(error.message);

  await supabase.auth.updateUser({ data: { full_name: trimmed } });
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
 * Deletes the signed-in account and everything hanging off it.
 *
 * Goes through a `security definer` function rather than the client, because
 * removing a row from auth.users needs privileges the anon key does not have —
 * and the alternative, putting a service_role key in the app, would hand every
 * install the ability to delete anybody. The function reads auth.uid() itself,
 * so it can only ever delete its own caller. See supabase/schema.sql.
 *
 * Profiles, subscriptions and price changes all cascade, so there is nothing to
 * tidy up afterwards beyond signing out locally.
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_me');
  if (error) throw new Error(describeError(error, 'Could not delete your account.'));
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

/**
 * Columns added after the first release, whose migrations are run by hand.
 *
 * Both are optional everywhere they are read, so the app behaves exactly as it
 * did before against a database where the SQL has not been run. What it must not
 * do is *assume* them: if it did, the first thing anyone did on an un-migrated
 * database — add a subscription — would fail outright, which is a far worse
 * failure than the things these columns fix.
 */
const LATE_COLUMNS = ['anchor_day', 'payment_method'] as const;

/** Whether the database is telling us one of those columns is not there. */
function missingLateColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // 42703 is Postgres' undefined_column. PGRST204 is PostgREST failing to find
  // it in its cached schema, which is what actually comes back through the
  // client. The message check is the backstop for either wording changing.
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  return (
    typeof error.message === 'string' && LATE_COLUMNS.some((c) => error.message?.includes(c))
  );
}

/**
 * The same body with those columns dropped outright, for the second attempt.
 *
 * Removed rather than set to `undefined`: both end up sending no such key, but
 * only one of them says so without the reader having to know that JSON.stringify
 * discards undefined values.
 */
function withoutLateColumns<T extends object>(body: T): T {
  const copy = { ...body };
  for (const name of LATE_COLUMNS) delete (copy as Record<string, unknown>)[name];
  return copy;
}

/**
 * Every subscription write goes through insertSub or updateSub, so the retry
 * above is not something each call site has to remember.
 *
 * patchSubscription used to do its own update and so had no retry — meaning a
 * Gmail reconcile writing payment_method failed on a database missing that
 * column, while the edit form writing the very same column succeeded.
 */
async function insertSub(body: SubInsert): Promise<Subscription> {
  const send = (b: SubInsert) => supabase.from('subscriptions').insert(b).select('*').single();

  let res = await send(body);
  if (missingLateColumn(res.error)) res = await send(withoutLateColumns(body));

  if (res.error) throw new Error(res.error.message);
  return toSub(res.data);
}

async function updateSub(id: string, patch: SubUpdate): Promise<Subscription> {
  const send = (p: SubUpdate) =>
    supabase.from('subscriptions').update(p).eq('id', id).select('*').single();

  let res = await send(patch);
  if (missingLateColumn(res.error)) res = await send(withoutLateColumns(patch));

  if (res.error) throw new Error(res.error.message);
  return toSub(res.data);
}

export async function createSubscription(input: SubscriptionInput): Promise<Subscription> {
  // user_id must be set explicitly — the INSERT policy checks it matches
  // auth.uid(), and the column has no default.
  const user_id = await currentUserId();

  return insertSub({
    ...input,
    user_id,
    // The date they picked is the billing day, by definition.
    anchor_day: input.anchor_day ?? anchorDayOf(input.next_renewal),
  });
}

export async function updateSubscription(
  id: string,
  input: SubscriptionInput,
): Promise<Subscription> {
  return updateSub(id, input);
}

/** Update only the named columns — used by the Gmail scan to reconcile drift. */
export async function patchSubscription(
  id: string,
  patch: Partial<SubscriptionInput>,
): Promise<Subscription> {
  return updateSub(id, patch);
}

export async function deleteSubscription(id: string): Promise<void> {
  const { error } = await supabase.from('subscriptions').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function toggleSubscription(id: string, current: string): Promise<Subscription> {
  return updateSub(id, { status: current === 'active' ? 'paused' : 'active' });
}

export async function cancelSubscription(id: string): Promise<Subscription> {
  return updateSub(id, { status: 'cancelled' });
}

export async function snoozeSubscription(id: string, days: number): Promise<Subscription> {
  return updateSub(id, { snoozed_until: addDaysISO(new Date(), Math.max(1, days)) });
}

export async function keepSubscription(sub: Subscription): Promise<Subscription> {
  return updateSub(sub.id, {
    // Rolled to the present before being advanced. Advancing the stored date
    // alone moved a three-month-stale subscription to two months stale, so
    // the reminder came straight back and "Keep it" looked like a dead button.
    // The anchor is what stops this drifting. Advancing from the stored date
    // alone loses the billing day the first time it crosses a February: 31
    // January is stored as 28 February, the next advance gives 28 March, and
    // every renewal after that is three days early forever. Passing the
    // anchor through both steps keeps 31 -> 28 Feb -> 31 Mar.
    next_renewal: advanceRenewal(
      currentRenewal(sub.next_renewal, sub.billing_cycle, toISODate(new Date()), sub.anchor_day),
      sub.billing_cycle,
      sub.anchor_day,
    ),
    snoozed_until: null,
  });
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
    const renewal = currentRenewal(s.next_renewal, s.billing_cycle, todayISO, s.anchor_day);
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
