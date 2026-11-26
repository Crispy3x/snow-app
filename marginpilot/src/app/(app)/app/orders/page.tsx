import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptJson } from "@/lib/crypto";
import { getAdapter } from "@/lib/suppliers";
import { CARRIERS, formatShipTo, shipByState, type ShipTo } from "@/lib/automation/orders";
import { EmptyState, PageHeader, money } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { Select, TextInput } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ActionForm } from "@/components/automation/action-form";
import { CopyButton } from "@/components/automation/copy-button";
import { LinkTabs } from "@/components/automation/tabs";
import { addTracking, markOrdered, syncOrdersNow } from "./actions";

export const metadata = { title: "Orders" };

type LineRow = {
  id: string;
  sku: string | null;
  quantity: number;
  sale_price: string;
  supplier_cost: string | null;
  listings: {
    title: string;
    supplier_products: { external_id: string; source_url: string | null; suppliers: { adapter: string; name: string } | null } | null;
  } | null;
};

type OrderRow = {
  id: string;
  ebay_order_id: string;
  status: "new" | "ordered_from_supplier" | "shipped" | "tracking_posted" | "cancelled" | "returned";
  order_total: string | null;
  buyer_username: string | null;
  ship_by: string | null;
  pii_purge_after: string | null;
  created_on_ebay: string | null;
  order_lines: LineRow[];
};

const STATUS: Record<OrderRow["status"], { label: string; tone: "neutral" | "accent" | "amber" | "danger" }> = {
  new: { label: "New", tone: "amber" },
  ordered_from_supplier: { label: "Ordered from supplier", tone: "accent" },
  shipped: { label: "Shipped on eBay", tone: "neutral" },
  tracking_posted: { label: "Tracking posted", tone: "accent" },
  cancelled: { label: "Cancelled", tone: "danger" },
  returned: { label: "Returned", tone: "neutral" },
};

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "–");

function supplierLink(line: LineRow): { href: string; name: string } | null {
  const sp = line.listings?.supplier_products;
  if (!sp?.suppliers) return null;
  try {
    const href = getAdapter(sp.suppliers.adapter).orderUrl(sp.external_id, sp.source_url);
    return href ? { href, name: sp.suppliers.name } : null;
  } catch {
    return null;
  }
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireStore();
  const tab = (await searchParams).tab === "done" ? "done" : "queue";
  const supabase = await createClient();
  const queueStatuses = ["new", "ordered_from_supplier"];

  let q = supabase
    .from("orders")
    .select(
      "id, ebay_order_id, status, order_total, buyer_username, ship_by, pii_purge_after, created_on_ebay, order_lines(id, sku, quantity, sale_price, supplier_cost, listings(title, supplier_products(external_id, source_url, suppliers(adapter, name))))",
    )
    .eq("org_id", ctx.org.id)
    .eq("store_id", ctx.store.id);
  q = tab === "queue" ? q.in("status", queueStatuses).order("ship_by", { ascending: true }) : q.not("status", "in", `(${queueStatuses.join(",")})`).order("created_on_ebay", { ascending: false });
  const { data } = await q.limit(tab === "queue" ? 200 : 100);
  const orders = (data ?? []) as unknown as OrderRow[];

  // Ship-to is encrypted and not readable through RLS: decrypt server-side for members of this org only.
  const shipTo = new Map<string, string | null>();
  if (tab === "queue" && orders.length) {
    const admin = createAdminClient();
    const { data: enc } = await admin
      .from("orders")
      .select("id, ship_to_enc")
      .eq("org_id", ctx.org.id)
      .eq("store_id", ctx.store.id)
      .in("id", orders.map((o) => o.id));
    for (const r of enc ?? []) {
      try {
        shipTo.set(r.id as string, r.ship_to_enc ? formatShipTo(decryptJson<ShipTo>(r.ship_to_enc as string)) : null);
      } catch {
        shipTo.set(r.id as string, null);
      }
    }
  }
  const now = new Date();
  const lateCount = tab === "queue" ? orders.filter((o) => shipByState(o.ship_by, now) !== "ok").length : 0;

  return (
    <>
      <PageHeader
        title="Orders"
        description="Place each order with your supplier yourself, then add tracking here to post it to eBay. Oldest ship-by date first."
        actions={
          <ActionForm action={syncOrdersNow} className="flex flex-col items-start gap-2 sm:items-end">
            <SubmitButton variant="secondary" pendingText="Starting…">
              Sync orders now
            </SubmitButton>
          </ActionForm>
        }
      />

      <LinkTabs
        label="Order lists"
        current={tab}
        tabs={[
          { key: "queue", label: "To fulfil", href: "/app/orders" },
          { key: "done", label: "Completed", href: "/app/orders?tab=done" },
        ]}
      />

      {lateCount > 0 && (
        <p role="note" className="mb-4 rounded-md border border-amber bg-amber-soft px-4 py-3 text-sm">
          <strong>{lateCount}</strong> order{lateCount === 1 ? " is" : "s are"} late or due to ship within 24 hours. Late shipments hurt your
          seller rating.
        </p>
      )}

      {orders.length === 0 ? (
        <EmptyState title={tab === "queue" ? "No orders to fulfil" : "No completed orders yet"}>
          {tab === "queue" ? "New eBay orders are pulled in every 15 minutes." : "Orders with tracking posted show up here."}
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {orders.map((o) => {
            const state = shipByState(o.ship_by, now);
            const address = shipTo.get(o.id);
            return (
              <li key={o.id} className="rounded-lg border border-line bg-card">
                <div className="flex flex-col gap-2 border-b border-line px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">Order {o.ebay_order_id}</h2>
                    <p className="text-sm text-ink-muted">
                      {date(o.created_on_ebay)} · {o.buyer_username ?? "buyer"} · {money(o.order_total)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
                    {tab === "queue" && state !== "ok" && <Badge tone="danger">{state === "late" ? "Late" : "Ship soon"}</Badge>}
                    <span className="text-sm">Ship by {date(o.ship_by)}</span>
                  </div>
                </div>

                <div className="grid gap-5 p-5 md:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">Items</h3>
                    <ul className="space-y-3">
                      {o.order_lines.map((l) => {
                        const link = supplierLink(l);
                        return (
                          <li key={l.id} className="text-sm">
                            <p className="font-medium">{l.listings?.title ?? l.sku ?? "Unmatched item"}</p>
                            <p className="text-ink-muted">
                              {l.quantity} × {money(l.sale_price)}
                              {l.supplier_cost !== null && <> · supplier cost {money(l.supplier_cost)} each</>}
                              {l.sku && <> · SKU {l.sku}</>}
                            </p>
                            {link && tab === "queue" && (
                              <a
                                href={link.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-accent underline underline-offset-2 hover:text-accent-strong"
                              >
                                Order from {link.name}
                                <span className="sr-only"> (opens in a new tab)</span>
                              </a>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  {tab === "queue" && (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold">Ship to</h3>
                      {address ? (
                        <div className="flex flex-col items-start gap-2">
                          <address className="whitespace-pre-line text-sm not-italic">{address}</address>
                          <CopyButton text={address} />
                        </div>
                      ) : (
                        <p className="text-sm text-ink-muted">No address on file (deleted after the retention period or not provided).</p>
                      )}
                    </div>
                  )}
                </div>

                {o.status === "new" && (
                  <div className="border-t border-line px-5 py-4">
                    <ActionForm action={markOrdered} className="flex flex-col items-start gap-2">
                      <input type="hidden" name="orderId" value={o.id} />
                      <p className="text-sm text-ink-muted">Step 1: place this order with your supplier, then confirm here.</p>
                      <SubmitButton pendingText="Saving…">I placed the supplier order</SubmitButton>
                    </ActionForm>
                  </div>
                )}
                {o.status === "ordered_from_supplier" && (
                  <div className="border-t border-line px-5 py-4">
                    <ActionForm action={addTracking}>
                      <input type="hidden" name="orderId" value={o.id} />
                      <p className="mb-3 text-sm text-ink-muted">Step 2: add the tracking from your supplier to post it to eBay.</p>
                      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
                        <Select id={`carrier-${o.id}`} name="carrier" label="Carrier" options={CARRIERS.map((c) => ({ ...c }))} defaultValue="USPS" />
                        <TextInput id={`tracking-${o.id}`} name="trackingNumber" label="Tracking number" required autoComplete="off" spellCheck={false} />
                        <SubmitButton pendingText="Posting…">Post tracking</SubmitButton>
                      </div>
                    </ActionForm>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
