# MarginPilot

eBay store automation software plus a video course. The plan, schema overview, eBay terms review and the list of accounts and keys you need are in **[docs/PLAN.md](docs/PLAN.md)**.

The brand name lives in `src/config/brand.ts`.

## Run locally

```bash
cd marginpilot
cp .env.example .env.local   # fill in what you have; the marketing site runs without any keys
npm install
npm run dev                  # http://localhost:3000
npm test                     # vitest
npm run build
```

### Demo mode (every page, no accounts)

```bash
npm run demo                              # = MP_DEMO=1 next dev
# or a production build:
MP_DEMO=1 npm run build && MP_DEMO=1 npm start
```

Runs the app on an in-memory fake Supabase (`src/lib/supabase/demo/`) seeded with sample store data, signed in as an admin demo user. Nothing is connected: eBay, Stripe and AI calls fail and pages show their error states. Proof, testimonials, the supplier directory, mentorship and referral earnings stay empty on purpose. Set the cookie `mp_demo_signed_out=1` to see the login/signup pages as a visitor. Demo mode is never on when `VERCEL` is set.

## Database

Schema and RLS: `supabase/migrations/0001_init.sql`. Apply with the Supabase CLI (`supabase link` then `supabase db push`).

## Deploy

Import the repo in Vercel and set **Root Directory** to `marginpilot`. Add the env vars from `.env.example`.

## Going live: setup checklist

1. **Supabase**: create a project, then `supabase link` and `supabase db push` (runs `supabase/migrations/0001`–`0008`). Add `<APP_URL>/auth/callback` to Auth > URL Configuration > Redirect URLs. Sign up once, then set `is_admin = true` on your row in `profiles`.
2. **Stripe**: products Starter $94/mo, Professional $494/mo, Mentorship $994/mo (and optionally a one-time Course). A coupon: 50% off, duration *forever*, put its id in `STRIPE_COUPON_SALE`. Turn on the Customer Portal. Webhook to `<APP_URL>/api/stripe/webhook` with: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created/updated/deleted/paused/resumed`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`.
3. **eBay**: keyset (sandbox first) and a RuName whose accept/decline URLs are `<APP_URL>/api/ebay/callback`. Register the marketplace account deletion endpoint `<APP_URL>/api/ebay/notifications/account-deletion` with your verification token *before* any production call.
4. **Anthropic**: API key with a spend limit.
5. **Inngest**: install the Vercel integration (sets the keys); functions are served from `/api/inngest`.
6. **Resend** (optional): team invite emails; without it the invite link is shown to copy.
7. **Mux** (optional): signed course video; YouTube, Vimeo and uploaded files also work.
8. Generate `TOKEN_ENCRYPTION_KEY` (see `.env.example`) and set every variable in Vercel.

Then: connect a sandbox eBay store, set store rules and policies, add the mock supplier (`mock:anything` or `https://mock-supplier.test/p/<id>` links) and list a first batch.

## Layout

- `src/app/(marketing)`: public site, legal pages, sign-up and login
- `src/app/(app)/app`: the signed-in app (dashboard, listings, monitor, orders, promotions, cleanup, activity, AI tools, course, stores, team, billing, settings)
- `src/app/(admin)/admin`: admin (users and plans, proof queue, course content, flags, AI usage)
- `src/app/api`: Stripe webhook and checkout, eBay OAuth and notifications, Inngest
- `src/jobs`: background jobs (store sync, bulk lister, monitor, orders, cleanup, audit, account deletion)
- `src/components/ui`: shared button, card, section, icons
- `src/components/marketing`: header, footer, page sections, Results (approved proof from the DB)
- `src/content`: marketing copy
- `src/config`: brand and pricing
- `src/lib`: server logic (auth, limits, margin engine, AI, eBay, suppliers, billing, and one folder per area)

Conventions for adding code: [docs/CONVENTIONS.md](docs/CONVENTIONS.md).
