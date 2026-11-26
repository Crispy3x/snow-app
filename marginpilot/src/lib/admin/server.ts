import "server-only";
import { requireAdmin, type SessionUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

/** requireAdmin() then the service-role client. Use at the top of every admin page and action. */
export async function adminContext(): Promise<{ admin: SessionUser; db: SupabaseClient }> {
  const admin = await requireAdmin();
  return { admin, db: createAdminClient() };
}

/** Record an admin change in admin_audit_log. Never throws: the change itself already happened. */
export async function audit(
  db: SupabaseClient,
  adminId: string,
  action: string,
  fields: { orgId?: string | null; targetUserId?: string | null; details?: Record<string, unknown> } = {},
): Promise<void> {
  const { error } = await db.from("admin_audit_log").insert({
    admin_id: adminId,
    action,
    org_id: fields.orgId ?? null,
    target_user_id: fields.targetUserId ?? null,
    details: fields.details ?? {},
  });
  if (error) console.error("admin audit log write failed", action, error.message);
}

/** Emails for a handful of user ids (auth.users is only reachable through the admin API). */
export async function userEmails(db: SupabaseClient, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))].slice(0, 100);
  const out = new Map<string, string>();
  await Promise.all(
    unique.map(async (id) => {
      const { data } = await db.auth.admin.getUserById(id);
      if (data?.user?.email) out.set(id, data.user.email);
    }),
  );
  return out;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00Z`) : new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
