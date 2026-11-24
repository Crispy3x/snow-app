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

## Database

Schema and RLS: `supabase/migrations/0001_init.sql`. Apply with the Supabase CLI (`supabase link` then `supabase db push`).

## Deploy

Import the repo in Vercel and set **Root Directory** to `marginpilot`. Add the env vars from `.env.example`.

## Layout

- `src/app/(marketing)`: public site and legal pages
- `src/components/ui`: shared button, card, section, icons
- `src/components/marketing`: header, footer, page sections, Results (approved proof from the DB)
- `src/content`: marketing copy
- `src/config`: brand and pricing
- `src/lib`: Supabase clients and data loaders
