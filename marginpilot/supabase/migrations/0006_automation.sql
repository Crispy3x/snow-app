-- Automation: price and stock monitor, order queue, promotions, cleanup, activity/undo.
-- Additive only. New tables have RLS enabled and forced.

-- ---------------------------------------------------------------------------
-- Per-store automation state (written by jobs and server actions via the service role)
-- ---------------------------------------------------------------------------
create table if not exists store_automation (
  store_id uuid primary key references ebay_stores (id) on delete cascade,
  org_id uuid not null references organizations (id) on delete cascade,
  monitor_last_checked_at timestamptz,             -- monitor runs when monitor_interval_hours has elapsed
  orders_synced_at timestamptz,                    -- getOrders is called from here (minus an overlap)
  cleanup_last_run_at timestamptz,
  ad_bid_strategy text not null default 'mid' check (ad_bid_strategy in ('min', 'mid', 'max')),
  ad_campaign_id text,                             -- the store's "MarginPilot" cost-per-sale campaign
  updated_at timestamptz not null default now()
);

alter table store_automation enable row level security;
alter table store_automation force row level security;
create policy "members read store automation" on store_automation for select
  using (is_member(org_id) or is_admin());
-- no insert/update policies: written server-side only (service role)

-- ---------------------------------------------------------------------------
-- Listings: quantity to restore when the supplier has stock again
-- ---------------------------------------------------------------------------
alter table listings add column if not exists restock_quantity int check (restock_quantity is null or restock_quantity >= 0);

-- ---------------------------------------------------------------------------
-- Monitor proposals: margins shown to the seller, decision time
-- ---------------------------------------------------------------------------
alter table monitor_proposals add column if not exists margin_before_pct numeric(6,2);
alter table monitor_proposals add column if not exists margin_after_pct numeric(6,2);
alter table monitor_proposals add column if not exists decided_at timestamptz;

-- at most one open proposal / cleanup candidate per listing
create unique index if not exists monitor_proposals_one_pending
  on monitor_proposals (listing_id) where status = 'pending';
create unique index if not exists cleanup_candidates_one_pending
  on cleanup_candidates (listing_id) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Query helpers
-- ---------------------------------------------------------------------------
create index if not exists orders_store_status_ship_by on orders (store_id, status, ship_by);
create index if not exists orders_pii_purge on orders (pii_purge_after) where ship_to_enc is not null;
create index if not exists order_lines_order on order_lines (order_id);
create unique index if not exists order_lines_unique_line on order_lines (order_id, ebay_line_item_id);
create index if not exists activity_log_store_time on activity_log (store_id, created_at desc);
create index if not exists activity_log_undo_of on activity_log (undo_of);
create index if not exists watcher_offers_listing on watcher_offers (listing_id, created_at desc);
