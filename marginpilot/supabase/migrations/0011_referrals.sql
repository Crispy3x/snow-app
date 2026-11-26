-- 0011_referrals.sql: referral program. Additive only.
--
-- referral_codes: one short code per user (created on first visit to /app/referrals).
-- referrals: one row per referred user (signed_up -> converted -> paid, or void).
-- referral_clicks: unique visits per code per day (counted from proxy.ts).
--
-- All writes go through the service role (signup action, Stripe webhook, admin
-- actions). Users can read their own code, clicks and referrals; a referrer
-- sees only a masked label (first initial) for the people they referred,
-- never their email, user id, workspace or admin notes (column grants below).

create table if not exists referral_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code text not null unique check (code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6,12}$'),
  created_at timestamptz not null default now()
);

create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  code text not null,                                   -- code used at sign-up (kept if the referrer leaves)
  referrer_user_id uuid references auth.users (id) on delete set null,
  referred_user_id uuid unique references auth.users (id) on delete set null,
  referred_org_id uuid references organizations (id) on delete set null,
  referred_label text not null default 'Someone',       -- first initial only, shown to the referrer
  status text not null default 'signed_up' check (status in ('signed_up', 'converted', 'paid', 'void')),
  first_paid_at timestamptz,
  first_invoice_id text,
  first_payment_intent_id text,
  first_invoice_amount_cents int check (first_invoice_amount_cents is null or first_invoice_amount_cents >= 0),
  currency text not null default 'usd',
  commission_pct numeric(5,2),
  commission_cents int not null default 0 check (commission_cents >= 0),
  commission_status text check (commission_status in ('pending', 'approved', 'paid', 'void')), -- null until converted
  commission_decided_at timestamptz,
  commission_decided_by uuid references auth.users (id) on delete set null,
  commission_paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists referrals_referrer_idx on referrals (referrer_user_id, created_at desc);
create index if not exists referrals_org_idx on referrals (referred_org_id);
create index if not exists referrals_pi_idx on referrals (first_payment_intent_id) where first_payment_intent_id is not null;
create index if not exists referrals_commission_idx on referrals (commission_status);

create table if not exists referral_clicks (
  code text not null,
  day date not null default (now() at time zone 'utc')::date,
  count int not null default 0 check (count >= 0),
  primary key (code, day)
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table referral_codes enable row level security;
alter table referral_codes force row level security;
alter table referrals enable row level security;
alter table referrals force row level security;
alter table referral_clicks enable row level security;
alter table referral_clicks force row level security;

create policy "own referral code" on referral_codes for select using (user_id = auth.uid() or is_admin());
create policy "own referrals" on referrals for select using (referrer_user_id = auth.uid() or is_admin());
create policy "own referral clicks" on referral_clicks for select
  using (is_admin() or exists (select 1 from referral_codes c where c.code = referral_clicks.code and c.user_id = auth.uid()));

-- No insert/update/delete policies: writes are service-role only.
-- Referrers read a limited set of columns (no referred user/workspace ids, invoice ids or notes).
-- referrer_user_id is included so pages can filter to "mine" (admins otherwise see every row).
revoke all on referral_codes, referrals, referral_clicks from anon;
revoke insert, update, delete on referral_codes, referrals, referral_clicks from authenticated;
revoke select on referrals from authenticated;
grant select (id, code, referrer_user_id, referred_label, status, first_paid_at, currency, commission_cents, commission_status, commission_paid_at, created_at)
  on referrals to authenticated;
grant select on referral_codes, referral_clicks to authenticated;

-- ---------------------------------------------------------------------------
-- Click counter (called by proxy.ts with the service role; ignores unknown codes)
-- ---------------------------------------------------------------------------
create or replace function record_referral_click(p_code text) returns void
language sql security definer set search_path = public as $$
  insert into referral_clicks (code, day, count)
  select c.code, (now() at time zone 'utc')::date, 1 from referral_codes c where c.code = upper(p_code)
  on conflict (code, day) do update set count = referral_clicks.count + 1;
$$;

revoke all on function record_referral_click(text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function record_referral_click(text) from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function record_referral_click(text) to service_role';
  end if;
end $$;
