-- AI tools: product research runs and listing audits.
-- Additive only. RLS on every new table. Rows are written by server code with the
-- service role (after re-checking membership) or by Inngest jobs; members can read
-- their org's rows and update draft status.

-- ---------------------------------------------------------------------------
-- Product research runs (Claude web search + the seller's own sales; never eBay
-- sold/Marketplace Insights data)
-- ---------------------------------------------------------------------------
create table research_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  store_id uuid references ebay_stores (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  query text not null,
  price_min numeric(10,2),
  price_max numeric(10,2),
  target_margin_pct numeric(5,2),
  report text not null,                              -- free-text answer from the deep model
  structured jsonb,                                   -- {demandSummary, ideas[], cautions[]} from the structuring pass
  sources jsonb not null default '[]'::jsonb,         -- [{url,title}] from web search results/citations
  own_data jsonb not null default '{}'::jsonb,        -- seller's own sales context used in the prompt
  ai_request_id uuid references ai_requests (id) on delete set null,
  draft_status draft_status not null default 'draft',
  created_at timestamptz not null default now()
);
create index research_runs_org_time on research_runs (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Listing audit: one run per request, one item per active listing scored
-- ---------------------------------------------------------------------------
create table audit_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  store_id uuid not null references ebay_stores (id) on delete cascade,
  requested_by uuid references auth.users (id) on delete set null,
  status job_status not null default 'queued',
  total_listings int not null default 0,
  analyzed int not null default 0,                    -- listings that got an AI recommendation
  ai_request_ids uuid[] not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index audit_runs_store_time on audit_runs (store_id, created_at desc);

create table audit_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references audit_runs (id) on delete cascade,
  org_id uuid not null references organizations (id) on delete cascade,
  store_id uuid not null references ebay_stores (id) on delete cascade,
  listing_id uuid references listings (id) on delete cascade,
  title text not null,
  score int not null,                                 -- 0 (worst) to 100, computed in code
  metrics jsonb not null default '{}'::jsonb,         -- views, sold, watchers, age, margin, counts
  issues text[] not null default '{}',
  recommendation text check (recommendation in ('fix', 'reprice', 'end', 'keep')),
  reasons text[] not null default '{}',
  suggested_changes jsonb,                            -- {title?, price?, notes?}
  ai_request_id uuid references ai_requests (id) on delete set null,
  draft_status draft_status not null default 'draft',
  decided_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index audit_items_run_score on audit_items (run_id, score);

alter table research_runs enable row level security;
alter table research_runs force row level security;
alter table audit_runs enable row level security;
alter table audit_runs force row level security;
alter table audit_items enable row level security;
alter table audit_items force row level security;

create policy "members read research runs" on research_runs for select using (is_member(org_id) or is_admin());
create policy "members update research runs" on research_runs for update using (is_member(org_id)) with check (is_member(org_id));
create policy "members delete research runs" on research_runs for delete using (is_member(org_id));

create policy "members read audit runs" on audit_runs for select using (is_member(org_id) or is_admin());

create policy "members read audit items" on audit_items for select using (is_member(org_id) or is_admin());
create policy "members update audit items" on audit_items for update using (is_member(org_id)) with check (is_member(org_id));
