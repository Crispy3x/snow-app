"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManage, requireStore } from "@/lib/auth";
import { applyTierBids, createSaleEvent, sendWatcherOffers, setBidStrategy } from "@/lib/automation/promotions-run";
import type { ActionState } from "@/components/ui/form";

const ids = (fd: FormData) => fd.getAll("listingIds").map(String).filter((s) => z.string().uuid().safeParse(s).success).slice(0, 500);

export async function sendOffers(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStore();
  const margin = Number(formData.get("margin"));
  const message = String(formData.get("message") ?? "").trim().slice(0, 2000);
  const selected = ids(formData);
  if (!(margin > 0 && margin < 100)) return { ok: false, message: "Choose a target margin between 0 and 100%." };
  if (!selected.length) return { ok: false, message: "Select at least one listing." };
  const r = await sendWatcherOffers({ orgId: ctx.org.id, userId: ctx.user.id, storeId: ctx.store.id }, selected, margin, message);
  revalidatePath("/app/promotions");
  return r;
}

const saleSchema = z
  .object({
    name: z.string().trim().min(3, "Give the sale a name (3+ characters).").max(90),
    discount: z.coerce.number().min(5, "eBay sales need at least 5% off.").max(80, "Use 80% off or less."),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date."),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an end date."),
  })
  .refine((v) => v.end > v.start, { message: "The end date must be after the start date.", path: ["end"] });

export async function createSale(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStore();
  const parsed = saleSchema.safeParse({
    name: formData.get("name"),
    discount: formData.get("discount"),
    start: formData.get("start"),
    end: formData.get("end"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] = i.message;
    return { ok: false, message: parsed.error.issues[0].message, fieldErrors };
  }
  const selected = ids(formData);
  if (!selected.length) return { ok: false, message: "Select at least one listing." };
  const soon = Date.now() + 10 * 60_000; // eBay needs a start in the future
  const startDate = new Date(Math.max(Date.parse(`${parsed.data.start}T00:00:00Z`), soon));
  const endDate = new Date(`${parsed.data.end}T23:59:00Z`);
  if (endDate.getTime() - startDate.getTime() > 45 * 86_400_000) return { ok: false, message: "eBay sales can run for up to 45 days." };
  const r = await createSaleEvent(
    { orgId: ctx.org.id, userId: ctx.user.id, storeId: ctx.store.id },
    { listingIds: selected, discountPct: parsed.data.discount, startDate, endDate, name: parsed.data.name },
  );
  revalidatePath("/app/promotions");
  return r;
}

export async function saveBidStrategy(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStore();
  if (!canManage(ctx.role)) return { ok: false, message: "Only owners and admins can change ad settings." };
  const s = z.enum(["min", "mid", "max"]).safeParse(formData.get("strategy"));
  if (!s.success) return { ok: false, message: "Choose min, mid or max." };
  await setBidStrategy(ctx.store.id, ctx.org.id, s.data);
  revalidatePath("/app/promotions");
  return { ok: true, message: "Saved. Apply bids to update eBay." };
}

export async function applyBids(): Promise<ActionState> {
  const ctx = await requireStore();
  if (!canManage(ctx.role)) return { ok: false, message: "Only owners and admins can change ad bids." };
  const r = await applyTierBids({ orgId: ctx.org.id, userId: ctx.user.id, storeId: ctx.store.id });
  revalidatePath("/app/promotions");
  return r;
}
