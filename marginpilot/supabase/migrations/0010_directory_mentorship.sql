-- 0010_directory_mentorship.sql: supplier directory and mentorship hub. Additive only.
--
-- Nothing is seeded. Every directory supplier, session, recording, resource and
-- piece of audit feedback is entered by a platform admin in /admin/directory and
-- /admin/mentorship.
--
-- Entitlements mirror src/config/plans.ts:
--   limits.supplierDirectory: professional, mentorship
--   limits.mentorship:        mentorship

-- ---------------------------------------------------------------------------
-- Entitlement helpers (security definer, fixed search_path)
-- ---------------------------------------------------------------------------
create or replace function org_has_directory(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from organizations where id = p_org and plan in ('professional', 'mentorship'));
$$;

create or replace function org_has_mentorship(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from organizations where id = p_org and plan = 'mentorship');
$$;

-- For tables without an org_id: the caller is a member of at least one entitled org.
-- The app additionally checks the org currently selected in the workspace switcher.
create or replace function user_has_directory() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m join organizations o on o.id = m.org_id
    where m.user_id = auth.uid() and o.plan in ('professional', 'mentorship')
  );
$$;

create or replace function user_has_mentorship() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m join organizations o on o.id = m.org_id
    where m.user_id = auth.uid() and o.plan = 'mentorship'
  );
$$;

-- ---------------------------------------------------------------------------
-- Supplier directory (admin-curated wholesale suppliers)
-- ---------------------------------------------------------------------------
create table if not exists directory_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  website text,
  categories text[] not null default '{}',
  description text,
  contact_method text not null check (contact_method in ('email', 'phone', 'whatsapp', 'telegram', 'portal')),
  contact_value text not null,                       -- returned only to entitled users (RLS below)
  ships_from text,                                   -- country or region
  us_warehouse boolean not null default false,
  typical_handling_days int check (typical_handling_days is null or typical_handling_days between 0 and 60),
  typical_delivery_days int check (typical_delivery_days is null or typical_delivery_days between 0 and 90),
  min_order text,                                    -- free text: "$100 first order", "none"
  accepts_dropship boolean not null default false,
  blind_shipping boolean not null default false,
  provides_tracking boolean not null default false,
  csv_feed_available boolean not null default false,
  notes text,
  verified_on date,
  verified_by uuid references auth.users (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists directory_suppliers_status_sort on directory_suppliers (status, sort_order);

alter table directory_suppliers enable row level security;

create policy "entitled read published directory" on directory_suppliers for select
  using ((status = 'published' and user_has_directory()) or is_admin());
create policy "admin writes directory" on directory_suppliers for all
  using (is_admin()) with check (is_admin());

-- Count shown on the locked page to users without the directory. Reveals nothing but the number.
create or replace function directory_published_count() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from directory_suppliers where status = 'published';
$$;
revoke all on function directory_published_count() from public;
grant execute on function directory_published_count() to authenticated;

-- Favourites and private notes, per workspace
create table if not exists directory_favorites (
  org_id uuid not null references organizations (id) on delete cascade,
  directory_supplier_id uuid not null references directory_suppliers (id) on delete cascade,
  is_favorite boolean not null default false,
  note text check (note is null or char_length(note) <= 4000),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_id, directory_supplier_id)
);

alter table directory_favorites enable row level security;

create policy "members read directory favorites" on directory_favorites for select
  using ((is_member(org_id) and org_has_directory(org_id)) or is_admin());
create policy "members insert directory favorites" on directory_favorites for insert
  with check (is_member(org_id) and org_has_directory(org_id));
create policy "members update directory favorites" on directory_favorites for update
  using (is_member(org_id) and org_has_directory(org_id))
  with check (is_member(org_id) and org_has_directory(org_id));
create policy "members delete directory favorites" on directory_favorites for delete
  using (is_member(org_id) and org_has_directory(org_id));

-- Lookup for "already in my suppliers"
create index if not exists suppliers_directory_id on suppliers (org_id, (config ->> 'directory_id'));

-- ---------------------------------------------------------------------------
-- Mentorship hub
-- ---------------------------------------------------------------------------
create table if not exists mentorship_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 200),
  description text,
  starts_at timestamptz not null,
  duration_min int not null default 60 check (duration_min between 5 and 480),
  join_url text,
  recording_url text,
  status text not null default 'scheduled' check (status in ('scheduled', 'done', 'cancelled')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mentorship_sessions_starts on mentorship_sessions (starts_at);

create table if not exists mentorship_resources (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 200),
  description text,
  url text,
  storage_path text,                                 -- private bucket 'mentorship-resources', signed URLs
  file_name text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  check (url is not null or storage_path is not null)
);

create table if not exists store_audit_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  store_id uuid not null references ebay_stores (id) on delete cascade,
  requested_by uuid references auth.users (id) on delete set null,
  week_of date not null check (extract(isodow from week_of) = 1),   -- Monday of the ISO week
  seller_notes text check (seller_notes is null or char_length(seller_notes) <= 4000),
  status text not null default 'requested' check (status in ('requested', 'in_review', 'delivered')),
  feedback text,
  delivered_at timestamptz,
  delivered_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, week_of)                           -- one request per workspace per ISO week
);
create index if not exists store_audit_requests_status on store_audit_requests (status, created_at);

alter table mentorship_sessions enable row level security;
alter table mentorship_resources enable row level security;
alter table store_audit_requests enable row level security;

create policy "mentorship members read sessions" on mentorship_sessions for select
  using (user_has_mentorship() or is_admin());
create policy "admin writes sessions" on mentorship_sessions for all
  using (is_admin()) with check (is_admin());

create policy "mentorship members read resources" on mentorship_resources for select
  using (user_has_mentorship() or is_admin());
create policy "admin writes resources" on mentorship_resources for all
  using (is_admin()) with check (is_admin());

create policy "members read audit requests" on store_audit_requests for select
  using (is_member(org_id) or is_admin());
create policy "mentorship members request audits" on store_audit_requests for insert
  with check (
    is_member(org_id)
    and org_has_mentorship(org_id)
    and requested_by = auth.uid()
    and status = 'requested'
    and feedback is null and delivered_at is null and delivered_by is null
    and exists (select 1 from ebay_stores s where s.id = store_id and s.org_id = store_audit_requests.org_id)
  );
create policy "admin updates audit requests" on store_audit_requests for update
  using (is_admin()) with check (is_admin());
create policy "admin deletes audit requests" on store_audit_requests for delete
  using (is_admin());

-- Resource files: admin uploads; entitled users get short-lived signed URLs from the server.
insert into storage.buckets (id, name, public) values ('mentorship-resources', 'mentorship-resources', false)
on conflict (id) do nothing;
create policy "admin mentorship resources" on storage.objects for all
  using (bucket_id = 'mentorship-resources' and is_admin())
  with check (bucket_id = 'mentorship-resources' and is_admin());
