-- eBay area (Phase 4): per-store listing defaults, deletion helper, indexes.
-- Additive only. Every new table has RLS.

-- ---------------------------------------------------------------------------
-- store_settings: defaults the bulk lister needs to create offers.
-- One row per store. Written by owners/admins from /app/stores/<id>/rules.
-- ---------------------------------------------------------------------------
create table if not exists store_settings (
  store_id uuid primary key references ebay_stores (id) on delete cascade,
  org_id uuid not null references organizations (id) on delete cascade,
  fulfillment_policy_id text,          -- eBay business policy ids (Account API)
  payment_policy_id text,
  return_policy_id text,
  merchant_location_key text,          -- Inventory API location key used on every offer
  location_postal_code text,
  location_country text,
  updated_at timestamptz not null default now()
);

alter table store_settings enable row level security;
alter table store_settings force row level security;

create policy "members read store settings" on store_settings for select
  using (is_member(org_id) or is_admin());
create policy "admins write store settings" on store_settings for all
  using (has_role(org_id, '{owner,admin}'))
  with check (
    has_role(org_id, '{owner,admin}')
    and exists (select 1 from ebay_stores s where s.id = store_id and s.org_id = store_settings.org_id)
  );

-- ---------------------------------------------------------------------------
-- Lookups used by the marketplace account deletion job and the dashboard
-- ---------------------------------------------------------------------------
create index if not exists ebay_stores_ebay_user_id on ebay_stores (ebay_user_id);
create index if not exists orders_buyer_username on orders (lower(buyer_username));
create index if not exists orders_store_created on orders (store_id, created_on_ebay);
create index if not exists ebay_notifications_user on ebay_notifications (ebay_user_id);

-- ---------------------------------------------------------------------------
-- Marketplace account deletion (eBay requirement): irreversibly delete or
-- anonymise everything we hold about one eBay user, in one transaction.
--  * as a seller: their connected stores (cascades to listings, orders,
--    order lines, rules, settings, metrics, activity, drafts) plus AI
--    requests and chat threads tied to those stores;
--  * as a buyer in other sellers' orders: username and ship-to removed, and
--    AI prompts/outputs that mention the username are redacted.
-- Service role only.
-- ---------------------------------------------------------------------------
create or replace function ebay_delete_account_data(p_ebay_user_id text, p_username text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_store_ids uuid[];
  v_stores int := 0;
  v_ai int := 0;
  v_buyer_orders int := 0;
  v_ai_redacted int := 0;
  v_name text := nullif(lower(trim(coalesce(p_username, ''))), '');
begin
  select coalesce(array_agg(id), '{}') into v_store_ids
    from ebay_stores
   where ebay_user_id = p_ebay_user_id;   -- immutable id only; usernames can change hands

  if array_length(v_store_ids, 1) > 0 then
    delete from ai_requests where store_id = any (v_store_ids);
    get diagnostics v_ai = row_count;
    delete from chat_threads where store_id = any (v_store_ids);
    update profiles set current_store_id = null where current_store_id = any (v_store_ids);
    delete from ebay_stores where id = any (v_store_ids);
    get diagnostics v_stores = row_count;
  end if;

  -- usernames shorter than 3 characters would match too broadly in free text
  if v_name is not null then
    update orders set buyer_username = null, ship_to_enc = null
     where lower(buyer_username) = v_name;
    get diagnostics v_buyer_orders = row_count;

    if length(v_name) >= 3 then
      update ai_requests
         set prompt = jsonb_build_object('redacted', 'ebay_account_deletion'),
             output = null
       where position(v_name in lower(prompt::text)) > 0
          or position(v_name in lower(coalesce(output::text, ''))) > 0;
      get diagnostics v_ai_redacted = row_count;
    end if;
  end if;

  return jsonb_build_object(
    'stores_deleted', v_stores,
    'ai_requests_deleted', v_ai,
    'buyer_orders_anonymised', v_buyer_orders,
    'ai_requests_redacted', v_ai_redacted
  );
end $$;

revoke all on function ebay_delete_account_data(text, text) from public, anon, authenticated;
grant execute on function ebay_delete_account_data(text, text) to service_role;
