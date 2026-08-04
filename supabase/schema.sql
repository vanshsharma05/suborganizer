-- ============================================================================
-- SubOrganizer — Supabase schema
--
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to run more than once.
--
-- Replaces the deleted FastAPI + MongoDB backend. The important difference is
-- Row Level Security: the old server filtered by user_id by hand in every
-- query, so one forgotten filter would have leaked another user's data. Here
-- Postgres enforces ownership, so that class of bug cannot happen.
-- ============================================================================


-- ---------------------------------------------------------------- profiles --
-- One row per user, created automatically on signup by the trigger at the
-- bottom of this file. Holds the fields Supabase's own auth.users table does
-- not: plan status and the user's preferred display currency.

create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  name             text,
  is_pro           boolean     not null default false,
  primary_currency text        not null default 'INR',
  created_at       timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own"   on public.profiles;
drop policy if exists "profiles: update own" on public.profiles;

create policy "profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id);


-- ----------------------------------------------------------- subscriptions --

create table if not exists public.subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid          not null references auth.users(id) on delete cascade,
  name                 text          not null,
  amount               numeric(12,2) not null check (amount >= 0),
  currency             text          not null default 'INR',
  billing_cycle        text          not null check (billing_cycle in ('weekly', 'monthly', 'yearly')),
  category             text          not null,
  next_renewal         date          not null,
  domain               text,
  brand_color          text,
  notes                text,
  status               text          not null default 'active'
                         check (status in ('active', 'paused', 'cancelled')),
  reminder_days_before integer       not null default 3 check (reminder_days_before >= 0),
  snoozed_until        date,
  -- A free trial. `is_trial` records that it *started* as one; whether the user
  -- is still inside it is derived from trial_ends against today, so a trial
  -- converts on its own without anything server-side having to run.
  is_trial             boolean       not null default false,
  trial_ends           date,
  created_at           timestamptz   not null default now()
);

-- Added after the first release, so existing tables need them too.
alter table public.subscriptions
  add column if not exists is_trial   boolean not null default false,
  add column if not exists trial_ends date;

-- The day of the month the merchant actually bills on.
--
-- It cannot be read back off next_renewal, because clamping is lossy. A
-- subscription billed on the 31st has to land on 28 February, and once that
-- date is stored the 31st is gone: the next advance starts from the 28th and
-- gives 28 March, so the renewal slides three days early and stays there
-- forever. Keeping the anchor separately is the only way 31 -> 28 Feb -> 31 Mar
-- survives a February.
--
-- Nullable on purpose. The client falls back to the day in next_renewal when it
-- is absent, which is exactly the old behaviour, so the app keeps working
-- against a database where this has not been run yet.
alter table public.subscriptions
  add column if not exists anchor_day integer
    check (anchor_day is null or (anchor_day between 1 and 31));

-- Backfill. The best available answer, not a perfect one: a row already sitting
-- on a clamped 28 February backfills as 28, and nothing anywhere still knows it
-- was once the 31st. No worse than the current behaviour, and right from here on.
update public.subscriptions
   set anchor_day = extract(day from next_renewal)::int
 where anchor_day is null;

-- The app's hottest read is "my subs, soonest renewal first" (dashboard,
-- calendar, reminders all sort by it), so index the pair.
create index if not exists subscriptions_user_renewal_idx
  on public.subscriptions (user_id, next_renewal);

alter table public.subscriptions enable row level security;

drop policy if exists "subs: read own"   on public.subscriptions;
drop policy if exists "subs: insert own" on public.subscriptions;
drop policy if exists "subs: update own" on public.subscriptions;
drop policy if exists "subs: delete own" on public.subscriptions;

create policy "subs: read own"
  on public.subscriptions for select
  using (auth.uid() = user_id);

create policy "subs: insert own"
  on public.subscriptions for insert
  with check (auth.uid() = user_id);

create policy "subs: update own"
  on public.subscriptions for update
  using (auth.uid() = user_id);

create policy "subs: delete own"
  on public.subscriptions for delete
  using (auth.uid() = user_id);


-- ----------------------------------------------------------- price changes --
-- Every amount change, so the app can say "Netflix went from ₹649 to ₹799 —
-- that is ₹1,800 a year" instead of silently showing the new figure.
--
-- Written by a trigger rather than by the app: the amount is edited from the
-- form, from the Gmail scan's reconcile step, and potentially from anywhere
-- else later. A trigger cannot be forgotten by a caller.

create table if not exists public.price_changes (
  id              uuid          primary key default gen_random_uuid(),
  subscription_id uuid          not null references public.subscriptions(id) on delete cascade,
  user_id         uuid          not null references auth.users(id) on delete cascade,
  old_amount      numeric(12,2) not null,
  new_amount      numeric(12,2) not null,
  currency        text          not null,
  changed_at      timestamptz   not null default now()
);

create index if not exists price_changes_sub_idx
  on public.price_changes (subscription_id, changed_at desc);

alter table public.price_changes enable row level security;

drop policy if exists "price_changes: read own"   on public.price_changes;
drop policy if exists "price_changes: delete own" on public.price_changes;

create policy "price_changes: read own"
  on public.price_changes for select
  using (auth.uid() = user_id);

-- Users may clear their own history; there is deliberately no insert or update
-- policy, so the only thing that can write a row is the trigger below.
create policy "price_changes: delete own"
  on public.price_changes for delete
  using (auth.uid() = user_id);

create or replace function public.log_price_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- `is distinct from` rather than <> so a null on either side still compares.
  if new.amount is distinct from old.amount then
    insert into public.price_changes
      (subscription_id, user_id, old_amount, new_amount, currency)
    values
      (new.id, new.user_id, old.amount, new.amount, new.currency);
  end if;

  return new;
end;
$$;

drop trigger if exists subscriptions_log_price_change on public.subscriptions;

create trigger subscriptions_log_price_change
  after update of amount on public.subscriptions
  for each row execute function public.log_price_change();


-- ------------------------------------------- create a profile on every signup --
-- security definer so the insert bypasses RLS: at this instant the new user has
-- no session yet, so auth.uid() would be null and the policy would reject it.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',  -- supplied by Google sign-in
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)            -- fallback for email/password
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ------------------------------------------------ delete your own account --
-- Both stores require deletion to be startable from inside the app. Apple is
-- explicit about it (5.1.1(v)) and rejects apps that only offer a support
-- address; Play requires an in-app route as well as a web one.
--
-- It has to live here rather than in the client because removing a row from
-- auth.users needs privileges the anon key does not have — and the alternative,
-- shipping a service_role key in the app, would hand every install the ability
-- to delete anybody.
--
-- security definer runs it as the owner, and auth.uid() still resolves to the
-- caller, so a signed-in user can only ever delete themselves. profiles,
-- subscriptions and price_changes all cascade from auth.users, so this one
-- statement takes the lot.

create or replace function public.delete_me()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  -- Refuse rather than delete nothing, so a caller without a session gets an
  -- error instead of a silent success.
  if caller is null then
    raise exception 'not signed in';
  end if;

  delete from auth.users where id = caller;
end;
$$;

revoke all on function public.delete_me() from public, anon;
grant execute on function public.delete_me() to authenticated;
