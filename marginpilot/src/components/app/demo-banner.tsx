import { isDemoMode } from "@/lib/supabase/demo/mode";

/** Shown in the /app and /admin shells when the app runs on the demo fake (MP_DEMO=1). */
export function DemoBanner() {
  if (!isDemoMode()) return null;
  return (
    <p role="note" className="mb-6 rounded-md border border-amber bg-amber-soft px-4 py-2 text-sm font-medium text-ink">
      Demo mode: sample data, nothing is connected
    </p>
  );
}
