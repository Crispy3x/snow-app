"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/ui/form";
import { FLAG_KEY_PATTERN, parseAllowlist } from "@/lib/admin/flag-rules";
import { adminContext, audit } from "@/lib/admin/server";

type Db = Awaited<ReturnType<typeof adminContext>>["db"];

/** Parse and check the allowlist textarea: valid UUIDs that are real workspaces. */
async function readAllowlist(db: Db, text: string): Promise<{ ids: string[] } | { error: string }> {
  const { ids, invalid } = parseAllowlist(text);
  if (invalid.length) return { error: `Not workspace IDs: ${invalid.slice(0, 3).join(", ")}${invalid.length > 3 ? "…" : ""}` };
  if (ids.length > 500) return { error: "At most 500 workspaces per flag." };
  if (ids.length === 0) return { ids };
  const { data } = await db.from("organizations").select("id").in("id", ids);
  const found = new Set((data ?? []).map((r) => r.id as string));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) return { error: `No workspace with ID ${missing[0]}${missing.length > 1 ? ` (and ${missing.length - 1} more)` : ""}.` };
  return { ids };
}

const flagSchema = z.object({
  key: z.string().trim().regex(FLAG_KEY_PATTERN, "Use 2–63 lowercase letters, digits, dots, dashes or underscores, starting with a letter."),
  description: z.string().trim().max(300, "Keep it under 300 characters."),
  enabled: z.boolean(),
  allowlist: z.string().max(30000),
});

function readForm(formData: FormData) {
  return flagSchema.safeParse({
    key: String(formData.get("key") ?? ""),
    description: String(formData.get("description") ?? ""),
    enabled: formData.get("enabled") === "on",
    allowlist: String(formData.get("allowlist") ?? ""),
  });
}

function done() {
  revalidatePath("/admin/flags");
}

export async function saveFlag(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, db } = await adminContext();
  const mode = formData.get("mode") === "create" ? "create" : "update";
  const parsed = readForm(formData);
  if (!parsed.success) {
    return { ok: false, message: "Check the form.", fieldErrors: { [String(parsed.error.issues[0].path[0])]: parsed.error.issues[0].message } };
  }
  const list = await readAllowlist(db, parsed.data.allowlist);
  if ("error" in list) return { ok: false, message: "Check the allowlist.", fieldErrors: { allowlist: list.error } };

  const row = {
    key: parsed.data.key,
    description: parsed.data.description || null,
    enabled: parsed.data.enabled,
    org_allowlist: list.ids,
    updated_at: new Date().toISOString(),
  };

  if (mode === "create") {
    const { error } = await db.from("feature_flags").insert(row);
    if (error) {
      return error.code === "23505"
        ? { ok: false, message: "A flag with that key already exists.", fieldErrors: { key: "Already exists." } }
        : { ok: false, message: `Couldn't create the flag: ${error.message}` };
    }
  } else {
    const { error, count } = await db.from("feature_flags").update(row, { count: "exact" }).eq("key", parsed.data.key);
    if (error || !count) return { ok: false, message: `Couldn't save the flag${error ? `: ${error.message}` : "."}` };
  }

  await audit(db, admin.id, mode === "create" ? "flag_create" : "flag_update", {
    details: { key: row.key, enabled: row.enabled, allowlist: row.org_allowlist.length },
  });
  done();
  return { ok: true, message: mode === "create" ? `Flag ${row.key} created.` : "Saved." };
}

export async function toggleFlag(formData: FormData): Promise<void> {
  const { admin, db } = await adminContext();
  const key = String(formData.get("key") ?? "");
  const enabled = formData.get("enabled") === "true";
  if (!FLAG_KEY_PATTERN.test(key)) return;
  await db.from("feature_flags").update({ enabled, updated_at: new Date().toISOString() }).eq("key", key);
  await audit(db, admin.id, "flag_toggle", { details: { key, enabled } });
  done();
}

export async function deleteFlag(formData: FormData): Promise<void> {
  const { admin, db } = await adminContext();
  const key = String(formData.get("key") ?? "");
  if (!FLAG_KEY_PATTERN.test(key)) return;
  await db.from("feature_flags").delete().eq("key", key);
  await audit(db, admin.id, "flag_delete", { details: { key } });
  done();
}
