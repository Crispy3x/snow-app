-- Lister (Phase 5): bulk add, AI listing writer, title optimizer, image cleaner.
-- Additive only. No new tables, so no new RLS policies: every column added here
-- sits on a table that already has org-scoped RLS in 0001_init.sql.

-- Bulk jobs remember the supplier and the target margin chosen at submit time.
alter table bulk_jobs
  add column if not exists supplier_id uuid references suppliers (id) on delete set null,
  add column if not exists target_margin_pct numeric(5,2),
  add column if not exists finished_at timestamptz;

-- Items keep their input order and when they last changed (progress page).
alter table bulk_job_items
  add column if not exists position int not null default 0,
  add column if not exists updated_at timestamptz not null default now();
create index if not exists bulk_job_items_job on bulk_job_items (job_id, position);

-- Listings:
--  manual_cost / manual_shipping_cost: cost for listings not linked to a supplier
--    product (e.g. saved from the AI listing writer from raw supplier text).
--    When supplier_product_id is set, supplier_products.cost wins.
--  vero_risk / vero_flags: last VeRO check (AI + deterministic brand list).
--  margin_reasons: why the margin guard blocked the listing (status blocked_margin).
alter table listings
  add column if not exists manual_cost numeric(10,2),
  add column if not exists manual_shipping_cost numeric(10,2),
  add column if not exists vero_risk text check (vero_risk in ('none', 'low', 'high')),
  add column if not exists vero_flags jsonb not null default '[]'::jsonb,
  add column if not exists margin_reasons jsonb not null default '[]'::jsonb;

-- Listing images: the bucket stays private (0001). Cleaned images are stored at
-- listing-images/<org_id>/<listing_id>/<uuid>.jpg and listings.images gets a
-- long-lived signed URL, because eBay needs a URL it can fetch without auth.
-- eBay copies pictures into its own picture service when an offer is published
-- or revised, so the URL only has to stay valid until then; see
-- src/lib/lister/storage.ts.
