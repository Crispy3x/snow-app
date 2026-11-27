import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DemoQuery, ioTick, type DemoDb, type Row } from "./query";
import { schema } from "./schema";
import { DEMO_USER, seed } from "./seed";

/**
 * In-memory fake of the Supabase client for demo mode (see ./mode.ts).
 * One store per server process, seeded once, shared by the user/admin/public
 * clients. Auth returns the demo user (or nobody, when signedOut); storage returns placeholders.
 */
type Store = { tables: Map<string, Row[]>; seq: number };
const g = globalThis as unknown as { __mpDemoStore?: Store };

const db: DemoDb = {
  rows(table) {
    const s = store();
    if (!s.tables.has(table)) s.tables.set(table, []);
    return s.tables.get(table)!;
  },
  fill(table, row) {
    const def = schema().get(table);
    const out: Row = {};
    for (const c of def?.columns ?? []) out[c.name] = c.def();
    if (def?.identity) out[def.identity] = ++store().seq;
    return Object.assign(out, row);
  },
  pk(table) {
    return schema().get(table)?.pk ?? ["id"];
  },
  patch(table, patch) {
    // eBay calls always fail in the demo (no credentials); keep the sample stores connected anyway.
    if (table === "ebay_stores" && patch.status === "needs_reauth") return Object.fromEntries(Object.entries(patch).filter(([k]) => k !== "status"));
    return patch;
  },
};

function store(): Store {
  if (!g.__mpDemoStore) {
    g.__mpDemoStore = { tables: new Map(), seq: 1000 };
    // Sample tokens and ship-to addresses are encrypted like real ones; use a throwaway key if none is set.
    process.env.TOKEN_ENCRYPTION_KEY ||= Buffer.alloc(32, 1).toString("base64");
    seed((table, rows) => db.rows(table).push(...rows.map((r) => db.fill(table, r))));
  }
  return g.__mpDemoStore;
}

const PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="#e8ece9"/><text x="300" y="310" font-family="sans-serif" font-size="28" text-anchor="middle" fill="#5b6660">Sample image</text></svg>',
  );

const ok = <T>(data: T) => ioTick().then(() => ({ data, error: null }));

function demoUser() {
  const u = db.rows("auth_users").find((r) => r.id === DEMO_USER.id) ?? DEMO_USER;
  return { id: u.id as string, email: u.email as string, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: { full_name: DEMO_USER.fullName }, created_at: "2026-01-01T00:00:00.000Z" };
}

const authFor = (signedOut: boolean) => ({
  getUser: () => ok({ user: signedOut ? null : demoUser() }),
  getSession: () => ok({ session: { user: demoUser(), access_token: "demo" } }),
  signInWithPassword: () => ok({ user: demoUser(), session: { access_token: "demo" } }),
  signUp: () => ok({ user: demoUser(), session: null }),
  signOut: () => ioTick().then(() => ({ error: null })),
  signInWithOtp: () => ok({}),
  resetPasswordForEmail: () => ok({}),
  updateUser: () => ok({ user: demoUser() }),
  exchangeCodeForSession: () => ok({ user: demoUser(), session: { access_token: "demo" } }),
  verifyOtp: () => ok({ user: demoUser(), session: { access_token: "demo" } }),
  resend: () => ok({}),
  admin: {
    getUserById: (id: string) => {
      const u = db.rows("auth_users").find((r) => r.id === id);
      return ok({ user: u ? { id: u.id, email: u.email } : null });
    },
    deleteUser: () => ok({}),
  },
});

const bucket = () => ({
  createSignedUrl: () => ok({ signedUrl: PLACEHOLDER }),
  createSignedUrls: (paths: string[]) => ok(paths.map((path) => ({ path, signedUrl: PLACEHOLDER, error: null }))),
  createSignedUploadUrl: (path: string) => ok({ signedUrl: "http://demo.local/upload", token: "demo", path }),
  upload: (path: string) => ok({ path, id: crypto.randomUUID(), fullPath: path }),
  download: () => ok(new Blob([decodeURIComponent(PLACEHOLDER.split(",")[1])], { type: "image/svg+xml" })),
  move: () => ok({ message: "moved" }),
  remove: (paths: string[]) => ok(paths.map((name) => ({ name }))),
  getPublicUrl: () => ({ data: { publicUrl: PLACEHOLDER } }),
});

function rpc(name: string, args: Record<string, unknown> = {}) {
  const rows = (t: string) => db.rows(t);
  switch (name) {
    case "has_course_access":
      return ok(true);
    case "directory_published_count":
      return ok(rows("directory_suppliers").filter((r) => r.status === "published").length);
    case "ebay_delete_account_data":
      return ok({ stores: 0, ai_requests: 0, buyer_orders: 0 });
    case "record_referral_click":
      return ok(null);
    case "admin_org_list": {
      const search = String(args.p_search ?? "").toLowerCase();
      const period = (args.p_period_start as string) ?? new Date().toISOString().slice(0, 8) + "01";
      const list = rows("organizations")
        .map((o) => {
          const owner = rows("auth_users").find((u) => u.id === o.owner_id);
          const sub = rows("subscriptions").filter((s) => s.org_id === o.id)[0];
          return {
            id: o.id, name: o.name, plan: o.plan, plan_manual_override: o.plan_manual_override, ai_credits_override: o.ai_credits_override,
            created_at: o.created_at, owner_id: o.owner_id, owner_email: owner?.email ?? null, subscription_status: sub?.status ?? null,
            member_count: rows("memberships").filter((m) => m.org_id === o.id).length,
            store_count: rows("ebay_stores").filter((s) => s.org_id === o.id && s.status !== "disconnected").length,
            credits_used: -rows("ai_credit_ledger").filter((l) => l.org_id === o.id && Number(l.delta) < 0 && l.period_start === period).reduce((n, l) => n + Number(l.delta), 0),
          };
        })
        .filter((o) => !search || `${o.name} ${o.owner_email} ${o.id}`.toLowerCase().includes(search))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const offset = Number(args.p_offset ?? 0);
      return ok(list.slice(offset, offset + Number(args.p_limit ?? 50)).map((o) => ({ ...o, total_count: list.length })));
    }
    case "admin_ai_usage": {
      const groups = new Map<string, Row>();
      for (const r of rows("ai_requests")) {
        if (String(r.created_at) < String(args.p_from) || String(r.created_at) >= String(args.p_to)) continue;
        const key = [r.org_id, r.user_id, r.tool, r.model, r.status].join("|");
        const g0 = groups.get(key) ?? { org_id: r.org_id, user_id: r.user_id, tool: r.tool, model: r.model, status: r.status, requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cost_usd: 0, credits: 0 };
        for (const k of ["input_tokens", "output_tokens", "cache_read_tokens", "cost_usd", "credits"]) g0[k] = Number(g0[k]) + Number(r[k] ?? 0);
        g0.requests = Number(g0.requests) + 1;
        groups.set(key, g0);
      }
      return ok([...groups.values()]);
    }
    default:
      return ioTick().then(() => ({ data: null, error: { message: `demo: rpc ${name} is not implemented` } }));
  }
}

/** signedOut: view pages as a visitor (server.ts sets it from the mp_demo_signed_out=1 cookie). */
export function createDemoClient({ signedOut = false } = {}): SupabaseClient {
  return {
    from: (table: string) => new DemoQuery(db, table),
    rpc,
    auth: authFor(signedOut),
    storage: { from: bucket },
  } as unknown as SupabaseClient;
}
