"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { adminContext, audit } from "@/lib/admin/server";
import type { ActionState } from "@/components/ui/form";
import { directoryInputFromForm, directorySupplierSchema, fieldErrorsFrom } from "@/lib/directory/validation";
import { DIRECTORY_STATUSES } from "@/lib/directory/types";
import { moveItem } from "@/lib/course/ordering";

/** Admin directory management. Every action re-checks the admin and uses the service role. */

function refresh(id?: string) {
  revalidatePath("/admin/directory", "layout");
  revalidatePath("/app/directory", "layout");
  if (id) revalidatePath(`/admin/directory/${id}`);
}

export async function saveDirectorySupplier(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, db } = await adminContext();
  const idRaw = formData.get("id");
  const id = typeof idRaw === "string" && idRaw ? z.uuid().safeParse(idRaw) : null;
  if (id && !id.success) return { ok: false, message: "Supplier not found." };

  const parsed = directorySupplierSchema.safeParse(directoryInputFromForm((k) => formData.get(k)));
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const v = parsed.data;
  const now = new Date().toISOString();

  if (id?.success) {
    const { data: before } = await db.from("directory_suppliers").select("verified_on, verified_by").eq("id", id.data).maybeSingle();
    if (!before) return { ok: false, message: "Supplier not found." };
    const verified_by = v.verified_on && v.verified_on !== before.verified_on ? admin.id : before.verified_by;
    const { error } = await db.from("directory_suppliers").update({ ...v, verified_by, updated_at: now }).eq("id", id.data);
    if (error) return { ok: false, message: `Couldn't save: ${error.message}` };
    await audit(db, admin.id, "directory.update", { details: { id: id.data, name: v.name, status: v.status } });
    refresh(id.data);
    return { ok: true, message: "Saved." };
  }

  const { data: last } = await db.from("directory_suppliers").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await db
    .from("directory_suppliers")
    .insert({ ...v, verified_by: v.verified_on ? admin.id : null, sort_order: (last?.sort_order ?? 0) + 1, updated_at: now })
    .select("id")
    .single();
  if (error || !data) return { ok: false, message: `Couldn't create the supplier: ${error?.message ?? "unknown error"}` };
  await audit(db, admin.id, "directory.create", { details: { id: data.id, name: v.name, status: v.status } });
  refresh();
  redirect(`/admin/directory/${data.id}?created=1`);
}

export async function setDirectoryStatus(formData: FormData) {
  const { admin, db } = await adminContext();
  const id = z.uuid().safeParse(formData.get("id"));
  const status = z.enum(DIRECTORY_STATUSES).safeParse(formData.get("status"));
  if (!id.success || !status.success) return;
  if (status.data === "published") {
    // Same rule as the form: a published entry needs a verification date and a valid record.
    const { data: row } = await db.from("directory_suppliers").select("*").eq("id", id.data).maybeSingle();
    if (!row) return;
    const check = directorySupplierSchema.safeParse(
      directoryInputFromForm((k) => {
        if (k === "status") return "published";
        const val = (row as Record<string, unknown>)[k];
        if (typeof val === "boolean") return val ? "on" : "";
        if (Array.isArray(val)) return val.join(", ");
        return val === null || val === undefined ? "" : String(val);
      }),
    );
    if (!check.success) redirect(`/admin/directory/${id.data}?publish_error=1`);
  }
  await db.from("directory_suppliers").update({ status: status.data, updated_at: new Date().toISOString() }).eq("id", id.data);
  await audit(db, admin.id, `directory.${status.data}`, { details: { id: id.data } });
  refresh(id.data);
}

export async function moveDirectorySupplier(formData: FormData) {
  const { db } = await adminContext();
  const id = z.uuid().safeParse(formData.get("id"));
  const dir = z.enum(["up", "down"]).safeParse(formData.get("direction"));
  if (!id.success || !dir.success) return;
  // Order is shared by drafts and published entries; archived ones keep theirs.
  const { data } = await db.from("directory_suppliers").select("id, sort_order, name").neq("status", "archived");
  const items = ((data ?? []) as { id: string; sort_order: number; name: string }[])
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((r, i) => ({ id: r.id, position: i + 1 }));
  for (const u of moveItem(items, id.data, dir.data)) {
    await db.from("directory_suppliers").update({ sort_order: u.position }).eq("id", u.id);
  }
  refresh();
}

export async function deleteDirectorySupplier(formData: FormData) {
  const { admin, db } = await adminContext();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const { data: row } = await db.from("directory_suppliers").select("name, status").eq("id", id.data).maybeSingle();
  if (!row || row.status === "published") return; // archive or unpublish first
  await db.from("directory_suppliers").delete().eq("id", id.data);
  await audit(db, admin.id, "directory.delete", { details: { id: id.data, name: row.name } });
  refresh();
  redirect("/admin/directory?deleted=1");
}
