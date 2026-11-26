-- Billing, team and account additions (additive; no new tables).

-- Subscriptions: sale discount flag and the last failed payment (written by the Stripe webhook).
alter table subscriptions
  add column if not exists sale_discount boolean not null default false,
  add column if not exists last_payment_failed_at timestamptz,
  add column if not exists last_failed_invoice_id text;

create index if not exists subscriptions_org_idx on subscriptions (org_id);
create index if not exists invitations_org_pending_idx on invitations (org_id) where accepted_at is null;
create index if not exists course_purchases_pi_idx on course_purchases (stripe_payment_intent_id);

-- Account deletion: a user who leaves must not be blocked by "who did this" columns
-- in other workspaces. Re-point those foreign keys to ON DELETE SET NULL.
-- (Organizations they own are deleted by the app first; that cascades their data.)
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('invitations', 'invited_by'),
      ('bulk_jobs', 'created_by'),
      ('monitor_proposals', 'decided_by'),
      ('fulfillments', 'created_by'),
      ('activity_log', 'user_id'),
      ('message_drafts', 'approved_by'),
      ('proof_screenshots', 'uploaded_by'),
      ('proof_screenshots', 'reviewed_by'),
      ('testimonials', 'reviewed_by')
    ) as t(tbl, col)
  loop
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = r.tbl and column_name = r.col) then
      execute format('alter table %I drop constraint if exists %I', r.tbl, r.tbl || '_' || r.col || '_fkey');
      execute format('alter table %I add constraint %I foreign key (%I) references auth.users (id) on delete set null',
                     r.tbl, r.tbl || '_' || r.col || '_fkey', r.col);
    end if;
  end loop;
end $$;
