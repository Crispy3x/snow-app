# Code conventions

Read this before adding a page, action, job or AI tool. Next.js here is **16** with Cache Components and `proxy.ts` (not middleware). Its docs are in `node_modules/next/dist/docs/`.

## Where things live

| What | Where |
|---|---|
| Brand name/copy | `src/config/brand.ts` |
| Plans, limits, sale | `src/config/plans.ts` |
| AI models, prices, credit cost per tool | `src/config/ai.ts` |
| Signed-in pages | `src/app/(app)/app/<area>/...` (URL `/app/<area>`) |
| Admin pages | `src/app/(admin)/admin/<area>/...` |
| Public pages | `src/app/(marketing)/...` |
| Route handlers / webhooks | `src/app/api/<area>/.../route.ts` |
| Server-only logic | `src/lib/<area>/...` (start files with `import "server-only"`) |
| Background jobs | `src/jobs/<area>.ts`, export `functions` (already registered in `src/app/api/inngest/route.ts`) |
| Schema changes | a NEW additive migration `supabase/migrations/00NN_<area>.sql` with RLS on every new table |
| Tests | `src/**/__tests__/*.test.ts` (Vitest, node environment) |

## Data access

- Current user, org, plan, role and selected store: `getAppContext()` / `requirePlan()` / `requireStore()` / `requireAdmin()` from `@/lib/auth`. Never trust IDs from the client without re-checking membership.
- As the user (RLS applies): `createClient()` from `@/lib/supabase/server`.
- Bypassing RLS (webhooks, jobs, admin actions after `requireAdmin()`, writes the user can't do directly such as tokens or encrypted fields): `createAdminClient()` from `@/lib/supabase/admin`. When using it for a user action, always filter by `ctx.org.id`.
- Plan limits: `assertWithinLimit(orgId, "stores" | "listings" | "seats", n)` throws `PlanLimitError` with a user-facing message.
- Secrets at rest: `encrypt/decrypt/encryptJson/decryptJson` from `@/lib/crypto` (eBay tokens, buyer ship-to).
- Audit trail: `logActivity({...})` from `@/lib/activity` for every change automation makes on eBay. Set `undoable` + `before` when it can be reversed.

## Pages and the Suspense rule

Pages read the session, so they are dynamic. The `/app` and `/admin` layouts already wrap `children` in `<Suspense>`, so a page can simply `await getAppContext()`. Don't read `cookies()` in a layout's top level. Use `"use cache"` only for data that doesn't depend on the user, and `cacheTag` + `revalidateTag(tag, "max")` to refresh.

Page skeleton:

```tsx
import { requireStore } from "@/lib/auth";
import { PageHeader, Panel } from "@/components/ui/app";

export const metadata = { title: "Orders" };

export default async function OrdersPage() {
  const ctx = await requireStore();
  // query with createClient() filtered by ctx.store.id ...
  return (<><PageHeader title="Orders" description="..." /> ...</>);
}
```

## Mutations

Server actions in an `actions.ts` next to the page (`"use server"`). Re-authorise inside every action (`getAppContext()` etc.). Return `ActionState` (`{ ok, message, fieldErrors }`) and render with `<FormMessage state={state} />` via `useActionState` in a small client component, or `revalidatePath` + plain `<form action>` for simple buttons. Validate input with `zod`.

## UI kit (use these, don't restyle from scratch)

- `@/components/ui/app`: `PageHeader`, `Panel`, `Alert`, `EmptyState`, `StatCard`, `DataTable` + `th`/`td` class strings, `TextLink`, `money()`, `pct()`
- `@/components/ui/form`: `TextInput`, `TextArea`, `Select`, `Checkbox`, `Field`, `FormMessage`, `ActionState`
- `@/components/ui/submit-button`: `SubmitButton` (pending state)
- `@/components/ui/button`: `Button`, `LinkButton`, `buttonClasses(variant, size)`; variants: primary, secondary, ghost, amber, onDark
- `@/components/ui/layout`: `Badge` (tones neutral/accent/amber/danger), `Card`
- `@/components/ui/charts`: `BarChart`, `LineChart`, `Meter`
- `@/components/ui/icons`: inline SVG icons (no emoji anywhere)

Design: Space Grotesk headings (automatic on h1–h4), Inter body. Colors only via tokens: `paper`, `ink`, `ink-muted`, `accent`, `accent-strong`, `accent-soft`, `amber`, `amber-soft`, `line`, `card`, `danger`. No gradients. Real `<button>`/`<a>`, every input labelled, text contrast ≥ 4.5:1 (never put text in `amber` on white; amber is a fill). Layouts must work at 375px wide.

## AI

All Claude calls go through `runAi()` in `@/lib/ai/run`. It checks credits, picks the model by tool (bulk → Haiku 5.5, standard → Sonnet 5.5, deep → Opus 5.5), logs prompt/output to `ai_requests`, charges credits only on success, and returns `{ ok: false, error, message }` for rate limits, refusals, outages and no credits, so show `result.message` to the user. Pass a Zod `schema` for structured output. Output is a **draft**: show it for approval; update `ai_requests.draft_status` to `approved`/`rejected`/`applied`. Strip buyer PII with `redactPii()` before prompting. Use `extractSources()` for web-search tools. Never auto-send buyer messages.

## eBay

`getEbayClient(storeId)` from `@/lib/ebay/client` (handles token refresh and 401 retry, throws `EbayApiError` / `EbayRateLimitError`), with endpoint wrappers in `@/lib/ebay/api`. Add new endpoints to `api.ts` rather than calling `request()` inline. In Inngest jobs, turn `EbayRateLimitError` into `RetryAfterError` from `inngest`. Official APIs only. No scraping.

## Suppliers

`@/lib/suppliers`: `resolveAdapter(link)` (rejects retail marketplace links), `getAdapter(key)`, adapters `mock` and `csv_feed`. Wholesale only. Supplier price changes create **proposals the seller approves** unless the store turned approval off; no automatic ordering from suppliers.

## Background jobs (Inngest v4)

```ts
import { RetryAfterError } from "inngest";
import { inngest, EVENTS } from "@/lib/inngest/client";

const fn = inngest.createFunction(
  { id: "monitor-store", triggers: [{ event: EVENTS.monitorStore }], concurrency: { key: "event.data.storeId", limit: 1 } },
  async ({ event, step }) => { await step.run("check", async () => { /* ... */ }); },
);
// cron: triggers: [{ cron: "0 */6 * * *" }]; fan out with step.sendEvent("fan-out", [...])
```

Send events from actions with `inngest.send({ name: EVENTS.x, data: {...} })`.

## Checks

`npx tsc --noEmit`, `npx eslint <paths>`, `npm test`. Don't run `next build` while other work is in progress in the same checkout. Don't `npm install`: ask for packages instead.
