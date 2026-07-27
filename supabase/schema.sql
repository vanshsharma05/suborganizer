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
  created_at           timestamptz   not null default now()
);

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
