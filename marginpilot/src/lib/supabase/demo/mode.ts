/**
 * Local demo mode: the app runs on an in-memory fake Supabase with sample data
 * (see ./client.ts and ./seed.ts) so every page can be opened without accounts.
 * Only ever on when MP_DEMO=1 and the code is NOT running on Vercel.
 */
let warned = false;

export function isDemoMode(): boolean {
  const on = process.env.MP_DEMO === "1" && !process.env.VERCEL;
  if (on && !warned) {
    warned = true;
    console.warn("\n*** MarginPilot DEMO MODE: in-memory fake Supabase with sample data. Nothing is connected. Never use in production. ***\n");
  }
  return on;
}
