-- MarginPilot initial schema
-- Every table has row-level security enabled. The service role (server-only key)
-- bypasses RLS and is used by webhooks, background jobs and admin server actions.
--
-- Tenancy: a user belongs to one or more organizations (workspaces). Plans,
-- stores, listings and AI credits belong to the organization. Team seats are
-- memberships. Course access belongs to the user.

-- gen_random_uuid() is built into Postgres 13+; no extension needed.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type plan_key as enum ('none', 'starter', 'professional', 'mentorship');
create type member_role as enum ('owner', 'admin', 'member');
create type sub_status as enum ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused');
create type store_status as enum ('active', 'needs_reauth', 'disconnected');
create type listing_status as enum ('draft', 'queued', 'publishing', 'active', 'out_of_stock', 'ended', 'blocked_margin', 'error');
create type monitor_action as enum ('reprice', 'out_of_stock', 'flag');
create type proposal_status as enum ('pending', 'approved', 'applied', 'dismissed', 'failed');
create type order_status as enum ('new', 'ordered_from_supplier', 'shipped', 'tracking_posted', 'cancelled', 'returned');
create type review_status as enum ('pending', 'approved', 'rejected');
create type ai_tool as enum ('listing_writer', 'title_optimizer', 'research', 'pricing_advisor', 'image_cleaner', 'buyer_message', 'listing_audit', 'store_chat');
create type draft_status as enum ('draft', 'approved', 'rejected', 'applied');
create type job_status as enum ('queued', 'running', 'done', 'failed', 'cancelled');

-- ---------------------------------------------------------------------------
-- Users, organizations, membership
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  is_admin boolean not null default false,          -- platform admin (you)
  current_org_id uuid,
  current_store_id uuid,                            -- store switcher
  onboarding jsonb not null default '{}'::jsonb,    -- {connected_ebay, set_rules, first_batch}
  created_at timestamptz not null default now()
);

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users (id),
  plan plan_key not null default 'none',
  stripe_customer_id text unique,
  ai_credits_override int,                          -- admin can grant extra
  created_at timestamptz not null default now()
);

create table memberships (
  org_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  email text not null,
  role member_role not null default 'member',
  token_hash text not null unique,
  invited_by uuid references auth.users (id),
  expires_at timestamptz not null,
  accepted_at timestamptz
);

alter table profiles
  add constraint profiles_current_org_fk foreign key (current_org_id) references organizations (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Billing (written only by the Stripe webhook via the service role)
-- ---------------------------------------------------------------------------
create table subscriptions (
  id text primary key,                              -- Stripe subscription id
  org_id uuid not null references organizations (id) on delete cascade,
  plan plan_key not null,
  status sub_status not null,
  price_id text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  trial_end timestamptz,
  updated_at timestamptz not null default now()
);

create table course_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_checkout_session_id text unique not null,
  stripe_payment_intent_id text,
  amount_cents int not null,
  currency text not null default 'usd',
  refunded_at timestamptz,
  created_at timestamptz not null default now()
);

create table stripe_events (                        -- webhook idempotency
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

create table feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  org_allowlist uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- eBay stores and rules
-- ---------------------------------------------------------------------------
create table ebay_oauth_states (                    -- CSRF state for the consent flow
  state text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references organizations (id) on delete cascade,
  expires_at timestamptz not null
);

create table ebay_stores (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  ebay_user_id text not null,                       -- immutable eBay user id (for deletion notices)
  ebay_username text,
  marketplace_id text not null default 'EBAY_US',
  label text,
  status store_status not null default 'active',
  -- AES-256-GCM ciphertext (base64), key in TOKEN_ENCRYPTION_KEY. Never readable by clients (column grants below).
  access_token_enc text,
  refresh_token_enc text,
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  scopes text[] not null default '{}',
  selling_limit_amount numeric(12,2),
  selling_limit_quantity int,
  connected_at timestamptz not null default now(),
  unique (org_id, ebay_user_id)
);

create table store_rules (
  store_id uuid primary key references ebay_stores (id) on delete cascade,
  min_net_margin_pct numeric(5,2) not null default 20,
  final_value_fee_pct numeric(5,2) not null default 13.6,
  per_order_fee numeric(8,2) not null default 0.40,
  tax_on_cost_pct numeric(5,2) not null default 0,  -- optional sales tax paid on supplier cost
  sale_discount_pct numeric(5,2) not null default 0,
  min_price numeric(10,2) not null default 0,
  handling_days int not null default 2,
  shipping_regions text[] not null default '{US}',
  -- [{"min_price":0,"max_price":20,"min_rate":2,"max_rate":4}, ...]
  ad_rate_tiers jsonb not null default '[]'::jsonb,
  monitor_action monitor_action not null default 'flag',
  monitor_interval_hours int not null default 12,
  reprice_requires_approval boolean not null default true,
  offer_margin_pct numeric(5,2),
  cleanup_after_days int,                           -- null = cleanup off
  cleanup_queue_replacements boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Suppliers (pluggable; 'mock' first)
-- ---------------------------------------------------------------------------
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  adapter text not null,                            -- 'mock', later 'csv_feed', '<wholesaler>'
  name text not null,
  wholesale_attested boolean not null default false,-- seller confirms a wholesale relationship
  config jsonb not null default '{}'::jsonb,        -- non-secret adapter config
  created_at timestamptz not null default now()
);

create table supplier_products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  supplier_id uuid not null references suppliers (id) on delete cascade,
  external_id text not null,
  source_url text,
  title text,
  cost numeric(10,2),
  shipping_cost numeric(10,2) not null default 0,
  stock int,
  images jsonb not null default '[]'::jsonb,
  raw jsonb,
  last_checked_at timestamptz,
  unique (supplier_id, external_id)
);

-- ---------------------------------------------------------------------------
-- Listings and bulk jobs
-- ---------------------------------------------------------------------------
create table listings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  store_id uuid not null references ebay_stores (id) on delete cascade,
  supplier_product_id uuid references supplier_products (id) on delete set null,
  sku text not null,
  ebay_offer_id text,
  ebay_listing_id text,
  category_id text,
  title text not null,
  description text,
  item_specifics jsonb not null default '{}'::jsonb,
  images jsonb not null default '[]'::jsonb,
  price numeric(10,2) not null,
  quantity int not null default 0,
  status listing_status not null default 'draft',
  net_margin_pct numeric(6,2),                      -- last computed by the margin engine
  ad_rate_pct numeric(5,2),
  sale_promotion_id text,                           -- one sale event per listing
  views int not null default 0,
  sold int not null default 0,
  watchers int not null default 0,
  listed_at timestamptz,
  ended_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, sku)
);
create index listings_store_status on listings (store_id, status);

create table bulk_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  store_id uuid not null references ebay_stores (id) on delete cascade,
  created_by uuid references auth.users (id),
  mode text not null check (mode in ('draft', 'publish')),
  source text not null check (source in ('links', 'csv')),
  status job_status not null default 'queued',
  total int not null default 0,
  succeeded int not null default 0,
  failed int not null default 0,
  created_at timestamptz not null default now()
);

create table bulk_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references bulk_jobs (id) on delete cascade,
  org_id uuid not null references organizations (id) on delete cascade,
  input jsonb not null,
  listing_id uuid references listings (id) on delete set null,
  status job_status not null default 'queued',
  error text
);

-- ---------------------------------------------------------------------------
-- Monitor, orders, offers, promotions, cleanup
-- ---------------------------------------------------------------------------
create table monitor_proposals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  listing_id uuid not null references listings (id) on delete cascade,
  action monitor_action not null,
  old_cost numeric(10,2), new_cost numeric(10,2),
  old_stock int, new_stock int,
  old_price numeric(10,2), proposed_price numeric(10,2),
  reason text,
  status proposal_status not null default 'pending',
  decided_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  store_id uuid not null references ebay_stores (id) on delete cascade,
  ebay_order_id text not null,
  status order_status not null default 'new',
  order_total numeric(10,2),
  ebay_fees numeric(10,2),
  buyer_username text,
  ship_to_enc text,                                 -- encrypted JSON (name, address); purged after pii_purge_after
  ship_by timestamptz,
  pii_purge_after timestamptz,
  created_on_ebay timestamptz,
  created_at timestamptz not null default now(),
  unique (store_id, ebay_order_id)
);

create table order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  org_id uuid not null references organizations (id) on delete cascade,
  ebay_line_item_id text not null,
  listing_id uuid references listings (id) on delete set null,
  sku text,
  quantity int not null,
  sale_price numeric(10,2) not null,
  supplier_cost numeric(10,2)
);

create table fulfillments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  org_id uuid not null references organizations (id) on delete cascade,
  carrier text not null,
  tracking_number text not null,
  ebay_fulfillment_id text,
  posted_at timestamptz,
  error text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table watcher_offers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  listing_id uuid not null references listings (id) on delete cascade,
  offer_price numeric(10,2) not null,
  net_margin_pct numeric(6,2) not null,
  message text,
  ebay_offer_ids text[],
  status job_status not null default 'queued',
  error text,
  created_at timestamptz not null default now()
);

create table promotions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  store_id uuid not null references ebay_stores (id) on delete cascade,
  kind text not null check (kind in ('sale_event', 'promoted_listings')),
  ebay_id text,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  starts_at timestamptz, ends_at timestamptz,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create table cleanup_candidates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  listing_id uuid not null references listings (id) on delete cascade,
  reason text not null,
  replacement_supplier_product_id uuid references supplier_products (id),
  status proposal_status not null default 'pending',
  created_at timestamptz not null default now()
);

-- Daily metrics snapshot for dashboard charts (from Analytics + Fulfillment APIs)
create table store_daily_metrics (
  store_id uuid not null references ebay_stores (id) on delete cascade,
  org_id uuid not null references organizations (id) on delete cascade,
  day date not null,
  sales numeric(12,2) not null default 0,
  orders int not null default 0,
  net_profit numeric(12,2) not null default 0,
  avg_margin_pct numeric(6,2),
  active_listings int not null default 0,
  views int not null default 0,
  primary key (store_id, day)
);

-- Everything automation (or a user via automation) changed. Undo where eBay allows.
create table activity_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations (id) on delete cascade,
  store_id uuid references ebay_stores (id) on delete cascade,
  actor text not null check (actor in ('automation', 'user', 'system')),
  user_id uuid references auth.users (id),
  entity_type text not null,
  entity_id text,
  action text not null,
  before jsonb,
  after jsonb,
  undoable boolean not null default false,
  undone_at timestamptz,
  undo_of bigint references activity_log (id),
  created_at timestamptz not null default now()
);
create index activity_log_org_time on activity_log (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- AI usage, drafts and messages
-- ---------------------------------------------------------------------------
create table ai_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  store_id uuid references ebay_stores (id) on delete set null,
  tool ai_tool not null,
  model text not null,
  prompt jsonb not null,                            -- PII-minimised prompt as sent
  output jsonb,
  draft_status draft_status not null default 'draft',
  input_tokens int, output_tokens int, cache_read_tokens int,
  cost_usd numeric(10,5),
  credits int not null default 0,
  status text not null default 'ok' check (status in ('ok', 'error', 'rate_limited', 'refused')),
  error text,
  created_at timestamptz not null default now()
);
create index ai_requests_org_time on ai_requests (org_id, created_at desc);

create table ai_credit_ledger (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations (id) on delete cascade,
  period_start date not null,
  delta int not null,                               -- negative = spend, positive = grant
  reason text not null,
  ai_request_id uuid references ai_requests (id) on delete set null,
  created_at timestamptz not null default now()
);

create table chat_threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  store_id uuid references ebay_stores (id) on delete set null,
  title text,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table message_drafts (                       -- buyer replies: never auto-sent
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  store_id uuid not null references ebay_stores (id) on delete cascade,
  ebay_conversation_id text not null,
  buyer_message text not null,
  draft text not null,
  status draft_status not null default 'draft',
  approved_by uuid references auth.users (id),
  sent_at timestamptz,
  ai_request_id uuid references ai_requests (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Proof (screenshots and testimonials). Never seeded.
-- ---------------------------------------------------------------------------
create table proof_screenshots (
  id uuid primary key default gen_random_uuid(),
  original_path text not null,                      -- private bucket proof-originals
  public_image_path text,                           -- redacted copy in public bucket proof-public, set on approval
  redactions jsonb not null default '[]'::jsonb,    -- [{x,y,w,h}] in image pixels
  caption text not null,
  store_label text not null,
  range_start date not null,
  range_end date not null,
  captured_on date not null,
  image_width int, image_height int,
  status review_status not null default 'pending',
  sort_order int not null default 0,
  uploaded_by uuid references auth.users (id),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (range_end >= range_start)
);

create table testimonials (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  quote text not null,
  store_type text not null,
  photo_path text,                                  -- private until approved
  photo_public_path text,
  permission_given boolean not null default false,
  given_on date not null,
  source text not null check (source in ('admin', 'customer')),
  submitted_by uuid references auth.users (id) on delete set null,
  status review_status not null default 'pending',
  sort_order int not null default 0,
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  -- cannot be approved without permission
  check (status <> 'approved' or permission_given)
);

-- ---------------------------------------------------------------------------
-- Course
-- ---------------------------------------------------------------------------
create table course_modules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text,
  position int not null,
  created_at timestamptz not null default now()
);

create table course_lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references course_modules (id) on delete cascade,
  title text not null,
  slug text not null unique,
  summary text,
  body text,
  video_provider text check (video_provider in ('mux', 'vimeo', 'youtube', 'storage')),
  video_ref text,                                   -- playback id / video id / storage path
  duration_seconds int,
  position int not null,
  is_published boolean not null default false,
  is_preview boolean not null default false,        -- free preview lesson
  created_at timestamptz not null default now()
);

create table course_resources (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references course_lessons (id) on delete cascade,
  title text not null,
  storage_path text not null,                       -- private bucket course-resources; served by signed URL
  position int not null default 0
);

create table lesson_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_id uuid not null references course_lessons (id) on delete cascade,
  last_position_seconds int not null default 0,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

-- ---------------------------------------------------------------------------
-- eBay notifications (marketplace account deletion is mandatory)
-- ---------------------------------------------------------------------------
create table ebay_notifications (
  id text primary key,                              -- eBay notificationId (idempotency)
  topic text not null,
  ebay_user_id text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

-- ---------------------------------------------------------------------------
-- Helper functions for RLS (security definer, fixed search_path)
-- ---------------------------------------------------------------------------
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

create or replace function is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where org_id = p_org and user_id = auth.uid());
$$;

create or replace function has_role(p_org uuid, p_roles member_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where org_id = p_org and user_id = auth.uid() and role = any (p_roles));
$$;

create or replace function has_course_access(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from course_purchases where user_id = p_user and refunded_at is null)
      or exists (
        select 1 from memberships m
        join subscriptions s on s.org_id = m.org_id
        where m.user_id = p_user and s.plan in ('professional', 'mentorship') and s.status in ('active', 'trialing')
      );
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','organizations','memberships','invitations','subscriptions','course_purchases',
    'stripe_events','feature_flags','ebay_oauth_states','ebay_stores','store_rules','suppliers',
    'supplier_products','listings','bulk_jobs','bulk_job_items','monitor_proposals','orders',
    'order_lines','fulfillments','watcher_offers','promotions','cleanup_candidates',
    'store_daily_metrics','activity_log','ai_requests','ai_credit_ledger','chat_threads',
    'message_drafts','proof_screenshots','testimonials','course_modules','course_lessons',
    'course_resources','lesson_progress','ebay_notifications'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- profiles
create policy "own profile read" on profiles for select using (id = auth.uid() or is_admin());
create policy "own profile update" on profiles for update using (id = auth.uid())
  with check (id = auth.uid() and is_admin = (select p.is_admin from profiles p where p.id = auth.uid()));

-- organizations / memberships / invitations
create policy "members read org" on organizations for select using (is_member(id) or is_admin());
create policy "owner updates org name" on organizations for update using (has_role(id, '{owner}'));
create policy "members read memberships" on memberships for select using (is_member(org_id) or is_admin());
create policy "owners manage memberships" on memberships for delete using (has_role(org_id, '{owner,admin}'));
create policy "admins read invitations" on invitations for select using (has_role(org_id, '{owner,admin}'));
create policy "admins create invitations" on invitations for insert with check (has_role(org_id, '{owner,admin}'));
create policy "admins delete invitations" on invitations for delete using (has_role(org_id, '{owner,admin}'));

-- billing: read-only to members, written by service role
create policy "members read subscriptions" on subscriptions for select using (is_member(org_id) or is_admin());
create policy "own course purchases" on course_purchases for select using (user_id = auth.uid() or is_admin());
create policy "admin reads stripe events" on stripe_events for select using (is_admin());

-- feature flags: readable by signed-in users, admin writes
create policy "signed-in read flags" on feature_flags for select using (auth.uid() is not null);
create policy "admin writes flags" on feature_flags for all using (is_admin()) with check (is_admin());

-- oauth states: service role only (no policies)

-- org-scoped operational tables: members read and write, admins read
do $$
declare t text;
begin
  foreach t in array array[
    'suppliers','supplier_products','listings','bulk_jobs','bulk_job_items','monitor_proposals',
    'orders','order_lines','fulfillments','watcher_offers','promotions','cleanup_candidates',
    'message_drafts'
  ] loop
    execute format('create policy "members read %1$s" on %1$I for select using (is_member(org_id) or is_admin())', t);
    execute format('create policy "members insert %1$s" on %1$I for insert with check (is_member(org_id))', t);
    execute format('create policy "members update %1$s" on %1$I for update using (is_member(org_id)) with check (is_member(org_id))', t);
    execute format('create policy "members delete %1$s" on %1$I for delete using (has_role(org_id, ''{owner,admin}''))', t);
  end loop;
end $$;

-- read-only to members (written by jobs / server)
create policy "members read metrics" on store_daily_metrics for select using (is_member(org_id) or is_admin());
create policy "members read activity" on activity_log for select using (is_member(org_id) or is_admin());
create policy "members read ai requests" on ai_requests for select using (is_member(org_id) or is_admin());
create policy "members update ai draft status" on ai_requests for update using (is_member(org_id)) with check (is_member(org_id));
create policy "members read credit ledger" on ai_credit_ledger for select using (is_member(org_id) or is_admin());
create policy "own chat threads" on chat_threads for all using (user_id = auth.uid() and is_member(org_id))
  with check (user_id = auth.uid() and is_member(org_id));

-- stores: members read non-secret columns; tokens never leave the server
create policy "members read stores" on ebay_stores for select using (is_member(org_id) or is_admin());
create policy "owners update store label" on ebay_stores for update using (has_role(org_id, '{owner,admin}'));
revoke select, update on ebay_stores from anon, authenticated;
grant select (id, org_id, ebay_user_id, ebay_username, marketplace_id, label, status, access_expires_at,
              refresh_expires_at, scopes, selling_limit_amount, selling_limit_quantity, connected_at)
  on ebay_stores to authenticated;
grant update (label) on ebay_stores to authenticated;

-- orders: encrypted ship-to is server-only
revoke select on orders from anon, authenticated;
grant select (id, org_id, store_id, ebay_order_id, status, order_total, ebay_fees, buyer_username, ship_by,
              pii_purge_after, created_on_ebay, created_at)
  on orders to authenticated;

create policy "members read rules" on store_rules for select
  using (exists (select 1 from ebay_stores s where s.id = store_id and (is_member(s.org_id) or is_admin())));
create policy "admins write rules" on store_rules for all
  using (exists (select 1 from ebay_stores s where s.id = store_id and has_role(s.org_id, '{owner,admin}')))
  with check (exists (select 1 from ebay_stores s where s.id = store_id and has_role(s.org_id, '{owner,admin}')));

-- proof: public sees approved only; customers submit testimonials; admin does everything
create policy "public reads approved screenshots" on proof_screenshots for select
  using (status = 'approved' and public_image_path is not null);
create policy "admin manages screenshots" on proof_screenshots for all using (is_admin()) with check (is_admin());
create policy "public reads approved testimonials" on testimonials for select
  using (status = 'approved' and permission_given);
create policy "customers read own testimonials" on testimonials for select using (submitted_by = auth.uid());
create policy "customers submit testimonials" on testimonials for insert
  with check (submitted_by = auth.uid() and source = 'customer' and status = 'pending' and photo_public_path is null);
create policy "admin manages testimonials" on testimonials for all using (is_admin()) with check (is_admin());

-- course: outlines visible to signed-in users; lesson bodies/videos via has_course_access
create policy "read modules" on course_modules for select using (true);
create policy "admin writes modules" on course_modules for all using (is_admin()) with check (is_admin());
create policy "read published lessons" on course_lessons for select
  using (is_admin() or (is_published and (is_preview or has_course_access())));
create policy "admin writes lessons" on course_lessons for all using (is_admin()) with check (is_admin());
create policy "entitled read resources" on course_resources for select
  using (is_admin() or has_course_access());
create policy "admin writes resources" on course_resources for all using (is_admin()) with check (is_admin());
create policy "own progress" on lesson_progress for all
  using (user_id = auth.uid()) with check (user_id = auth.uid() and has_course_access());

-- ebay notifications: admin read; service role writes
create policy "admin reads notifications" on ebay_notifications for select using (is_admin());

-- ---------------------------------------------------------------------------
-- Storage buckets
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values
  ('proof-originals', 'proof-originals', false),     -- unredacted uploads: admin only
  ('proof-public', 'proof-public', true),            -- redacted, approved copies only
  ('testimonial-uploads', 'testimonial-uploads', false),
  ('course-resources', 'course-resources', false),   -- signed URLs for entitled users
  ('listing-images', 'listing-images', false)
on conflict (id) do nothing;

create policy "admin proof originals" on storage.objects for all
  using (bucket_id = 'proof-originals' and is_admin()) with check (bucket_id = 'proof-originals' and is_admin());
create policy "admin writes proof public" on storage.objects for all
  using (bucket_id = 'proof-public' and is_admin()) with check (bucket_id = 'proof-public' and is_admin());
-- customers upload a testimonial photo into a folder named after their user id
create policy "customer testimonial photo" on storage.objects for insert
  with check (bucket_id = 'testimonial-uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "admin testimonial photos" on storage.objects for all
  using (bucket_id = 'testimonial-uploads' and is_admin()) with check (bucket_id = 'testimonial-uploads' and is_admin());
create policy "admin course resources" on storage.objects for all
  using (bucket_id = 'course-resources' and is_admin()) with check (bucket_id = 'course-resources' and is_admin());
-- listing images: first folder is the org id
create policy "members listing images" on storage.objects for all
  using (bucket_id = 'listing-images' and is_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'listing-images' and is_member(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------------------------
-- New user bootstrap: profile + personal organization
-- ---------------------------------------------------------------------------
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  insert into organizations (name, owner_id)
    values (coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)) || '''s workspace', new.id)
    returning id into v_org;
  insert into memberships (org_id, user_id, role) values (v_org, new.id, 'owner');
  insert into profiles (id, full_name, current_org_id)
    values (new.id, new.raw_user_meta_data ->> 'full_name', v_org);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();
