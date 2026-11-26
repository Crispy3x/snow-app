-- Admin area: manual plan override, admin audit log, reporting functions and
-- indexes for the proof queue and AI usage reports. Additive only.

-- ---------------------------------------------------------------------------
-- Manual plan override (set from /admin/users). The Stripe webhook should skip
-- writing organizations.plan while plan_manual_override is true.
-- ---------------------------------------------------------------------------
alter table organizations
  add column if not exists plan_manual_override boolean not null default false,
  add column if not exists plan_override_note text,
  add column if not exists plan_override_at timestamptz,
  add column if not exists plan_override_by uuid references auth.users (id) on delete set null;

-- 0001's "owner updates org name" policy has no column limit, so an owner could
-- otherwise set their own plan, credit override or the override flag with the
-- browser client. Restrict client updates to the name column.
revoke update on organizations from anon, authenticated;
grant update (name) on organizations to authenticated;

-- ---------------------------------------------------------------------------
-- Admin audit log: every change made from the admin area. Written by the
-- service role only; admins can read it.
-- ---------------------------------------------------------------------------
create table if not exists admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users (id) on delete set null,
  action text not null,                              -- set_plan, grant_credits, set_credit_override, set_admin, flag_*, proof_*
  org_id uuid references organizations (id) on delete set null,
  target_user_id uuid references auth.users (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_org_time on admin_audit_log (org_id, created_at desc);
create index if not exists admin_audit_log_time on admin_audit_log (created_at desc);

alter table admin_audit_log enable row level security;
alter table admin_audit_log force row level security;
create policy "admin reads audit log" on admin_audit_log for select using (is_admin());

-- ---------------------------------------------------------------------------
-- Indexes for admin reports and the proof queue
-- ---------------------------------------------------------------------------
create index if not exists ai_requests_time on ai_requests (created_at desc);
create index if not exists ai_requests_user_time on ai_requests (user_id, created_at desc);
create index if not exists ai_credit_ledger_org_period on ai_credit_ledger (org_id, period_start);
create index if not exists proof_screenshots_status_sort on proof_screenshots (status, sort_order);
create index if not exists testimonials_status_sort on testimonials (status, sort_order);
create index if not exists testimonials_submitted_by on testimonials (submitted_by);
create index if not exists subscriptions_org on subscriptions (org_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Reporting functions. Callable only by the service role (admin server code
-- after requireAdmin()) or a platform admin; never by other users.
-- ---------------------------------------------------------------------------
create or replace function admin_caller_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin()
      or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role';
$$;

-- Org list for /admin/users. Reads auth.users for the owner email, so it is
-- security definer; the guard and the grants below keep it admin-only.
create or replace function admin_org_list(
  p_search text default null,
  p_period_start date default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  name text,
  plan plan_key,
  plan_manual_override boolean,
  ai_credits_override int,
  created_at timestamptz,
  owner_id uuid,
  owner_email text,
  subscription_status sub_status,
  member_count bigint,
  store_count bigint,
  credits_used bigint,
  total_count bigint
)
language sql stable security definer set search_path = public as $$
  with base as (
    select o.id, o.name, o.plan, o.plan_manual_override, o.ai_credits_override, o.created_at, o.owner_id,
           u.email::text as owner_email
    from organizations o
    left join auth.users u on u.id = o.owner_id
    where admin_caller_ok()
      and (
        coalesce(p_search, '') = ''
        or o.name ilike '%' || p_search || '%'
        or u.email ilike '%' || p_search || '%'
        or o.id::text = p_search
      )
  )
  select b.id, b.name, b.plan, b.plan_manual_override, b.ai_credits_override, b.created_at, b.owner_id, b.owner_email,
    (select s.status from subscriptions s where s.org_id = b.id order by s.updated_at desc limit 1),
    (select count(*) from memberships m where m.org_id = b.id),
    (select count(*) from ebay_stores e where e.org_id = b.id and e.status <> 'disconnected'),
    coalesce((
      select -sum(l.delta) from ai_credit_ledger l
      where l.org_id = b.id and l.delta < 0
        and l.period_start = coalesce(p_period_start, date_trunc('month', now() at time zone 'utc')::date)
    ), 0)::bigint,
    count(*) over ()
  from base b
  order by b.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- AI usage for a time window, grouped finely; the app rolls it up by org,
-- user, tool and model.
create or replace function admin_ai_usage(p_from timestamptz, p_to timestamptz)
returns table (
  org_id uuid,
  user_id uuid,
  tool ai_tool,
  model text,
  status text,
  requests bigint,
  input_tokens bigint,
  output_tokens bigint,
  cache_read_tokens bigint,
  cost_usd numeric,
  credits bigint
)
language sql stable security definer set search_path = public as $$
  select r.org_id, r.user_id, r.tool, r.model, r.status,
         count(*),
         coalesce(sum(r.input_tokens), 0)::bigint,
         coalesce(sum(r.output_tokens), 0)::bigint,
         coalesce(sum(r.cache_read_tokens), 0)::bigint,
         coalesce(sum(r.cost_usd), 0),
         coalesce(sum(r.credits), 0)::bigint
  from ai_requests r
  where admin_caller_ok() and r.created_at >= p_from and r.created_at < p_to
  group by r.org_id, r.user_id, r.tool, r.model, r.status;
$$;

revoke all on function admin_caller_ok() from public;
revoke all on function admin_org_list(text, date, int, int) from public;
revoke all on function admin_ai_usage(timestamptz, timestamptz) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function admin_org_list(text, date, int, int) from anon, authenticated';
    execute 'revoke all on function admin_ai_usage(timestamptz, timestamptz) from anon, authenticated';
    execute 'grant execute on function admin_caller_ok() to anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function admin_caller_ok() to service_role';
    execute 'grant execute on function admin_org_list(text, date, int, int) to service_role';
    execute 'grant execute on function admin_ai_usage(timestamptz, timestamptz) to service_role';
  end if;
end $$;
