import { canManage, getAppContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ebayConfigured, EBAY_ENV } from "@/lib/ebay/config";
import { Alert, EmptyState, PageHeader, Panel, TextLink, money } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { buttonClasses, LinkButton } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { disconnectStore } from "./actions";
import { RenameForm } from "./rename-form";

export const metadata = { title: "eBay stores" };

const ERRORS: Record<string, { title: string; body: string }> = {
  not_configured: {
    title: "eBay isn't set up on this server yet",
    body: "Add EBAY_CLIENT_ID, EBAY_CLIENT_SECRET and EBAY_RU_NAME to the environment, then try again.",
  },
  forbidden: { title: "Only owners and admins can connect stores", body: "Ask a workspace owner to connect or reconnect the store." },
  limit: { title: "Store limit reached", body: "Your plan's store limit is reached. Upgrade on the Billing page or disconnect a store first." },
  no_plan: { title: "Choose a plan first", body: "Connecting eBay stores needs an active plan." },
  declined: { title: "Connection cancelled", body: "eBay didn't grant access, so nothing was connected. You can try again any time." },
  state: { title: "That link expired", body: "The eBay sign-in took longer than 10 minutes or was opened in another session. Start again." },
  token: { title: "eBay didn't accept the sign-in", body: "We couldn't exchange the authorization with eBay. Start again." },
  identity: { title: "Couldn't read the eBay account", body: "eBay authorised us but we couldn't load the account details. Start again in a minute." },
  save: { title: "Couldn't save the store", body: "Something went wrong saving the connection. Start again." },
};

type StoreRow = {
  id: string;
  label: string | null;
  ebay_username: string | null;
  marketplace_id: string;
  status: "active" | "needs_reauth" | "disconnected";
  refresh_expires_at: string | null;
  selling_limit_amount: string | null;
  selling_limit_quantity: number | null;
  connected_at: string;
};

const STATUS = {
  active: { tone: "accent", text: "Connected" },
  needs_reauth: { tone: "amber", text: "Reconnect needed" },
  disconnected: { tone: "neutral", text: "Disconnected" },
} as const;

const dateFmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

export default async function StoresPage({ searchParams }: { searchParams: Promise<{ error?: string; reason?: string }> }) {
  const [ctx, sp] = await Promise.all([getAppContext(), searchParams]);
  const supabase = await createClient();
  const { data } = await supabase
    .from("ebay_stores")
    .select("id, label, ebay_username, marketplace_id, status, refresh_expires_at, selling_limit_amount, selling_limit_quantity, connected_at")
    .eq("org_id", ctx.org.id)
    .order("connected_at");
  const stores = (data ?? []) as StoreRow[];
  const manage = canManage(ctx.role);
  const configured = ebayConfigured();
  const error = sp.error ? (ERRORS[sp.error] ?? { title: "Something went wrong", body: "Start again." }) : null;
  const max = ctx.plan?.limits.stores ?? 0;
  const used = stores.filter((s) => s.status !== "disconnected").length;

  const connectButton = manage && configured && (
    <a href="/api/ebay/connect" className={buttonClasses("primary")}>
      Connect an eBay store
    </a>
  );

  return (
    <>
      <PageHeader
        title="eBay stores"
        description={
          <>
            Connect through eBay&apos;s own sign-in. We receive a token, never your password, and you can disconnect at any time.
            {ctx.plan && ` ${used} of ${max} stores used on your ${ctx.plan.name} plan.`}
          </>
        }
        actions={connectButton}
      />

      <div className="space-y-4">
        {error && (
          <Alert tone={sp.error === "declined" ? "info" : "danger"} title={error.title}>
            {error.body}
            {(sp.error === "limit" || sp.error === "no_plan") && (
              <>
                {" "}
                <TextLink href="/app/billing">Go to billing</TextLink>
              </>
            )}
          </Alert>
        )}
        {sp.reason === "no_store" && !error && (
          <Alert tone="info" title="Connect a store to continue">
            That page works on a connected eBay store. Connect one below.
          </Alert>
        )}
        {!configured && !error && (
          <Alert tone="warning" title="eBay isn't set up on this server yet">
            Add EBAY_CLIENT_ID, EBAY_CLIENT_SECRET and EBAY_RU_NAME to the environment to enable store connections.
          </Alert>
        )}
        {configured && EBAY_ENV === "sandbox" && (
          <Alert tone="info">Connected to the eBay sandbox. Sign in with a sandbox test user.</Alert>
        )}
        {!manage && <Alert tone="info">Only workspace owners and admins can connect, rename or disconnect stores.</Alert>}

        {stores.length === 0 ? (
          <EmptyState title="No eBay store connected" action={connectButton || undefined}>
            Connect your eBay seller account to list products, track orders and see your real margins.
          </EmptyState>
        ) : (
          <ul className="space-y-4">
            {stores.map((s) => {
              const st = STATUS[s.status];
              const name = s.label || s.ebay_username || "eBay store";
              return (
                <li key={s.id}>
                  <Panel
                    title={name}
                    description={
                      <>
                        {s.ebay_username ? `eBay user ${s.ebay_username}` : "eBay account"} · {s.marketplace_id.replace("EBAY_", "eBay ")} · connected{" "}
                        {dateFmt(s.connected_at)}
                      </>
                    }
                    actions={<Badge tone={st.tone}>{st.text}</Badge>}
                  >
                    <div className="space-y-5">
                      {s.status === "needs_reauth" && (
                        <Alert tone="warning" title="eBay access expired">
                          eBay no longer accepts this store&apos;s authorization, so syncing and listing are paused. Reconnect to resume.
                        </Alert>
                      )}

                      {s.status !== "disconnected" && (
                        <dl className="grid gap-3 text-sm sm:grid-cols-3">
                          <div>
                            <dt className="text-ink-muted">Selling limit (amount)</dt>
                            <dd className="font-medium tabular-nums">{s.selling_limit_amount ? money(s.selling_limit_amount) : "Not synced yet"}</dd>
                          </div>
                          <div>
                            <dt className="text-ink-muted">Selling limit (items)</dt>
                            <dd className="font-medium tabular-nums">{s.selling_limit_quantity?.toLocaleString() ?? "Not synced yet"}</dd>
                          </div>
                          <div>
                            <dt className="text-ink-muted">Authorization valid until</dt>
                            <dd className="font-medium">{s.refresh_expires_at ? dateFmt(s.refresh_expires_at) : "–"}</dd>
                          </div>
                        </dl>
                      )}

                      {manage && <RenameForm storeId={s.id} label={name} />}

                      <div className="flex flex-wrap gap-2">
                        {s.status !== "disconnected" && (
                          <LinkButton href={`/app/stores/${s.id}/rules`} variant="secondary">
                            Rules and listing defaults
                          </LinkButton>
                        )}
                        {manage && configured && s.status === "needs_reauth" && (
                          <a href={`/api/ebay/connect?reconnect=${s.id}`} className={buttonClasses("primary")}>
                            Reconnect
                          </a>
                        )}
                        {manage && configured && s.status === "disconnected" && (
                          <a href="/api/ebay/connect" className={buttonClasses("secondary")}>
                            Connect again
                          </a>
                        )}
                      </div>

                      {manage && s.status !== "disconnected" && (
                        <details className="rounded-md border border-line p-3 text-sm">
                          <summary className="cursor-pointer font-medium">Disconnect this store</summary>
                          <p className="mt-2 text-ink-muted">
                            We delete the eBay tokens straight away and stop syncing. Your eBay listings stay live on eBay; MarginPilot just
                            can&apos;t see or change them until you connect again. You can also revoke access in your eBay account settings.
                          </p>
                          <form action={disconnectStore} className="mt-3">
                            <input type="hidden" name="storeId" value={s.id} />
                            <SubmitButton variant="secondary" pendingText="Disconnecting…" className="border-danger/40 text-danger">
                              Disconnect {name}
                            </SubmitButton>
                          </form>
                        </details>
                      )}
                    </div>
                  </Panel>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
