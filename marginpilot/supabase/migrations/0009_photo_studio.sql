-- Photo studio: one product photo -> AI listing draft + background variants.
-- Additive only.

alter type ai_tool add value if not exists 'photo_studio';

-- One row per uploaded photo. Tracks the files the studio created in the
-- private listing-images bucket so the server never trusts storage paths sent
-- by the browser, and so discarded/abandoned sessions can be cleaned up.
--  source_path: <org_id>/pending/<uuid>.jpg (the downscaled upload)
--  results:     [{ id, kind, label, path }] background variants, also under <org_id>/pending/
--  draft:       the AI draft as shown (title, description, specifics, keywords, condition, vero)
--  status:      draft until a listing is created (applied) or the session is discarded
create table if not exists photo_studio_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  store_id uuid references ebay_stores (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  source_path text not null,
  results jsonb not null default '[]'::jsonb,
  draft jsonb,
  ai_request_id uuid references ai_requests (id) on delete set null,
  cost numeric(10,2),
  shipping_cost numeric(10,2),
  status text not null default 'draft' check (status in ('draft', 'applied', 'discarded')),
  listing_id uuid references listings (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists photo_studio_jobs_org_created on photo_studio_jobs (org_id, created_at desc);
create index if not exists photo_studio_jobs_status_created on photo_studio_jobs (status, created_at) where status = 'draft';

alter table photo_studio_jobs enable row level security;
alter table photo_studio_jobs force row level security;

create policy "members read photo studio jobs" on photo_studio_jobs for select using (is_member(org_id) or is_admin());
create policy "members insert photo studio jobs" on photo_studio_jobs for insert with check (is_member(org_id));
create policy "members update photo studio jobs" on photo_studio_jobs for update using (is_member(org_id)) with check (is_member(org_id));
create policy "members delete photo studio jobs" on photo_studio_jobs for delete using (is_member(org_id));
