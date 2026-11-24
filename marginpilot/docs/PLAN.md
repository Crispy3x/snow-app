# MarginPilot: build plan

Brand name and brand copy live in one file: `src/config/brand.ts`.

## 1. Architecture in one paragraph

Next.js 16 (App Router, Cache Components) on Vercel. Supabase provides Postgres (RLS on every table), auth (email + magic link, optional Google), and storage. Stripe Checkout + Billing for the two subscriptions and the one-time course, the Customer Portal for self-service, and a webhook that is the only writer of billing state. eBay is reached only through official OAuth (authorization-code grant) and REST Sell APIs; tokens are AES-256-GCM encrypted with a key that lives in Vercel env, never in the database. Background work runs in **Inngest**. AI calls go through one server module that meters credits, logs prompts/outputs, maps errors, and returns drafts for approval.

## 2. Background jobs: Inngest (and why)

| Need | How Inngest handles it |
|---|---|
| Scheduled rechecks per store (every N hours) | Cron functions that fan out one event per store |
| eBay call limits | Per-store `concurrency` and `throttle` keys, so one big store can't starve others or trip limits |
| Bulk listing of hundreds of items | `step.run` per item: each step retries on its own, progress survives function timeouts |
| Retries/backoff on 429 / 5xx | Built in, with `RetryAfterError` for eBay and Anthropic `retry-after` |
| Vercel serverless | Runs as a route handler in this app; no worker servers, queues or Redis to operate |

Alternatives considered: Vercel Cron + a Postgres job table (cheaper, but we'd hand-build retries, fan-out and throttling); Trigger.dev (similar, slightly heavier); BullMQ (needs Redis and an always-on worker, which Vercel doesn't run).

## 3. AI model routing (checked against current Anthropic docs, Nov 2026)

| Tier | Model | Price in/out per 1M tokens | Used for |
|---|---|---|---|
| Bulk | `claude-haiku-5-5` | $0.10 / $0.50 | Bulk listing writer, title optimizer batches, image banner detection, audit pre-scoring |
| Standard | `claude-sonnet-5-5` | $2 / $10 | Single listing writer, pricing advisor explanation, buyer message drafts, listing audit reasons |
| Deep | `claude-opus-5-5` | $4 / $20 | Product research assistant (with web search and cited sources), store assistant chat |

Models are env-overridable (`AI_MODEL_*`). Bulk jobs that don't need to be instant can go through the Message Batches API at 50% cost. Prompt caching on system prompts and course material. Every call records tokens, cost and credits in `ai_requests`; refusals, 429s and 5xx map to clear user messages and are not charged credits.

Image cleaner note: Claude can *find* banners, coupons and watermarks (bounding boxes) but does not edit images. Removal is done in code (crop when the banner is at an edge, solid fill on plain backgrounds). Anything else is flagged "can't fix" rather than guessed. A generative in-painting service could be added later.

## 4. eBay terms review: conflicts with the spec (read before Phase 5)

I read eBay's current Drop Shipping policy, the API License Agreement, the Marketplace Account Deletion requirements, call limits, and the Negotiation and Message API docs. Findings:

**A. Retail arbitrage is banned twice.**
- *Drop shipping policy:* drop shipping from a **wholesale supplier** is allowed. "Purchasing the item from another retailer or marketplace that ships directly to your customer is not allowed."
- *API License Agreement:* apps may not "promote or engage in seller arbitrage (for example, automatically repricing eBay listings in response to price changes on other third-party sites, automatically ordering sold items from other third-party sites, or posting tracking information to eBay when items purchased from other third-party sites are shipped)."
- **Conflict:** "paste supplier links", "price and stock monitor → reprice" and "order queue → tracking posted back" are, if pointed at Amazon, Walmart, AliExpress-style retail listings, exactly the License's examples. That risks your API keys and your customers' eBay accounts.
- **Proposed design:**
  1. Suppliers are wholesale sources only: a mock adapter, CSV/feed import, and later adapters for wholesalers with an API.
  2. Retail-marketplace domains are blocked at link-paste time.
  3. Each supplier requires a "wholesale relationship" attestation.
  4. Supplier price changes produce **repricing proposals that the seller approves** (default on), not silent automatic repricing.
  5. No automatic ordering from suppliers. The seller places the supplier order, and the app helps them post the tracking.
  6. Before launch, ask eBay Developer Support in writing to confirm this design. "Third-party sites" in the License is not limited to retail, so written confirmation is the only safe answer.

**B. Pricing from eBay data.** The License forbids using eBay content "alone or in combination with third-party information, to suggest or model prices for items listed on eBay."
- **Conflict:** the pricing advisor's "competitor prices … from allowed APIs" (e.g. the Browse API).
- **Proposed design:** competitor prices are only ones the seller types in. The advisor works from cost, fees and the margin floor.

**C. Product research.** eBay's sold-item and market-trend data (Marketplace Insights) is a **Restricted API**. It needs separate approval and is barred from AI ingestion.
- **Proposed design:** research uses Claude web search (sources shown) plus the seller's own sales history, not eBay market data.

**D. Buyer personal data.** Allowed "only as strictly necessary" to fulfil orders. It must be deleted when no longer needed, and must not be used for unsolicited messages.
- **Proposed design:**
  - Ship-to data is encrypted, readable only server-side, and auto-purged after the return window (`orders.pii_purge_after`).
  - Buyer names and addresses are stripped from AI prompts.
  - Buyer messages go to Anthropic only when the seller asks for a draft. Anthropic API data isn't used for training. Sign their DPA.
  - eBay data is never used for training.

**E. Marketplace account deletion endpoint is mandatory.** It must be live before the first production API call. It needs:
- a challenge-response GET;
- an immediate 2xx acknowledgement;
- irreversible deletion of that eBay user's data.

Planned for Phase 4 (`ebay_notifications` table).

**F. Offers and messages.**
- Offers to watchers use the Negotiation API (`send_offer_to_interested_buyers`), which has per-seller offer limits and no counter-offers. The spec is compatible with this.
- Buyer messages use the REST Message API (`commerce.message`). Sending happens only after the seller approves.

**G. Call limits and Growth Check.**
- Default daily limits: Inventory 2M, Fulfillment 100K, Account 25K.
- Higher limits and production scale need eBay's Application Growth Check.
- A public privacy policy consistent with eBay's is required. The draft is in `/privacy`.

**H. Seller-performance data** (e.g. promoted listings). Showing sellers their **own** data is fine. Aggregating across sellers (e.g. "average ad ROI of our users") needs eBay's written permission. We won't build that.

**Decision needed from you before Phase 5:** approve A–C as described, or tell me what to change.

## 5. Phases

1. **Project setup, marketing site, legal pages** ← this delivery
2. Auth (Supabase), Stripe billing (checkout, portal, webhook + tests), plan limits, account pages
3. Admin (users/plans, flags, AI cost) + proof system (upload, redaction tool, approval queue, customer testimonial submit)
4. eBay OAuth + store switcher, account-deletion endpoint, store rules, margin engine (+ tests), dashboard, eBay webhook tests
5. Bulk lister with mock supplier + AI listing writer, title optimizer, image cleaner
6. Monitor, order queue, offers, cleanup, activity log with undo
7. Research assistant, pricing advisor, buyer message assistant, listing audit, store chat
8. Course area (player, progress, resources, gating, admin ordering)

## 6. Plan limits (initial, editable in `src/config/plans.ts` in Phase 2)

| | Starter | Growth | Course only |
|---|---|---|---|
| eBay stores | 1 | 5 | 0 |
| Active listings managed | 500 | 5,000 | 0 |
| AI credits / month | 300 | 2,000 | 0 |
| Team seats | 1 | 5 | n/a |
| Course | No | Yes | Yes |

## 7. Database schema

See `supabase/migrations/0001_init.sql`. It was checked by running it on a local Postgres with stubbed Supabase `auth`/`storage` schemas: every table has RLS, and anonymous users see only approved proof. Tables by area:

| Area | Tables |
|---|---|
| Identity and tenancy | `profiles` (is_admin, current org/store, onboarding), `organizations` (plan, Stripe customer), `memberships` (team seats), `invitations` |
| Billing | `subscriptions`, `course_purchases`, `stripe_events` (webhook idempotency), `feature_flags` |
| eBay | `ebay_oauth_states`, `ebay_stores` (encrypted tokens, column grants keep tokens server-only), `store_rules` (margin floor, FVF 13.6% default, $0.40 order fee, tax on cost, sale discount, ad tiers, handling, regions, min price, monitor/cleanup settings), `ebay_notifications` |
| Catalogue | `suppliers` (adapter + wholesale attestation), `supplier_products`, `listings`, `bulk_jobs`, `bulk_job_items` |
| Automation | `monitor_proposals`, `orders` (encrypted ship-to + purge date), `order_lines`, `fulfillments`, `watcher_offers`, `promotions`, `cleanup_candidates`, `store_daily_metrics`, `activity_log` (before/after, undo) |
| AI | `ai_requests` (prompt, output, draft status, tokens, cost, credits), `ai_credit_ledger`, `chat_threads`, `message_drafts` |
| Proof | `proof_screenshots` (private original, redaction boxes, public copy on approval), `testimonials` (approval requires `permission_given`, enforced by a check constraint) |
| Course | `course_modules`, `course_lessons`, `course_resources`, `lesson_progress`; `has_course_access()` = course purchase or active Growth plan |
| Storage buckets | `proof-originals` (admin), `proof-public` (public, redacted only), `testimonial-uploads`, `course-resources` (signed URLs), `listing-images` (per org) |

## 8. Accounts and keys you need to create

| Service | What to create | Env vars |
|---|---|---|
| **Supabase** | A project (choose the region nearest your users). Enable email auth; set the Site URL and redirect URLs to your domain. Run the migration (`supabase db push`). Set yourself `is_admin = true` in `profiles`. | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| **Stripe** | An account. Products: Starter (monthly), Growth (monthly), Course (one-time). Customer Portal enabled. Webhook endpoint `/api/stripe/webhook` with checkout, subscription, invoice and charge.refunded events. | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_*` |
| **eBay Developer Program** | Developer account (developer.ebay.com). Sandbox and Production keysets. A RuName with accept/decline URLs pointing at `/api/ebay/callback`. Marketplace account deletion endpoint + verification token. Later: Application Growth Check. Plus a sandbox test seller account. | `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_DEV_ID`, `EBAY_RU_NAME`, `EBAY_DELETION_*` |
| **Anthropic** | Console account, API key, spend limit, and the DPA. | `ANTHROPIC_API_KEY` |
| **Inngest** | Account, app linked to the Vercel project (Vercel integration sets the keys). | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` |
| **Vercel** | Project importing this repo with **Root Directory = `marginpilot`**. Add a domain. | all of the above |
| **Resend** (or Postmark) | Verified sending domain for receipts and alerts. Also use it as Supabase SMTP. | `RESEND_API_KEY`, `EMAIL_FROM` |
| **Mux** (course video) | Account, signing key for signed playback (Vimeo is a simpler alternative). | `MUX_*` |
| Generated by you | 32-byte key for token encryption. | `TOKEN_ENCRYPTION_KEY` |
| Lawyer | Review the four legal pages (marked DRAFT). | n/a |

## 9. Testing

Vitest for unit/integration tests: margin engine (Phase 4), Stripe webhook (Phase 2, signature + idempotency + each event type), eBay notification webhooks (Phase 4, challenge response, deletion). Playwright smoke test of the marketing site and key flows.
