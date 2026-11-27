import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isDemoMode } from "./demo/mode";
import { createDemoClient } from "./demo/client";

/**
 * Supabase client acting as the signed-in user (RLS applies).
 * Use in Server Components, Server Actions and Route Handlers.
 */
export async function createClient() {
  const cookieStore = await cookies();
  if (isDemoMode()) return createDemoClient({ signedOut: cookieStore.get("mp_demo_signed_out")?.value === "1" });
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component: cookies are read-only there. proxy.ts refreshes the session.
          }
        },
      },
    },
  );
}
