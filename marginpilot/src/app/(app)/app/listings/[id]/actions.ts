"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAppContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { EbayApiError, EbayRateLimitError } from "@/lib/ebay/client";
import { logActivity } from "@/lib/activity";
import { guardPrice } from "@/lib/margin";
import type { ActionState } from "@/components/ui/form";
import { endListing, listingCost, loadListing, publishListing, reviseLiveListing } from "@/lib/lister/publish";
import { loadStoreRules } from "@/lib/lister/store";
import { sanitizeDescription } from "@/lib/lister/text";
import { checkVero } from "@/lib/lister/vero";

const optionalMoney = z.union([z.literal(""), z.coerce.number().min(0)]).optional();

const schema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(10, "Titles need at least 10 characters.").max(80, "eBay titles are at most 80 characters."),
  description: z.string().max(50_000),
  price: z.coerce.number().positive("Enter a price above 0.").max(100_000),
  quantity: z.coerce.number().int("Whole numbers only.").min(0).max(10_000),
  cost: optionalMoney,
  shipping: optionalMoney,
});

async function authorisedListing(id: string) {
  const ctx = await getAppContext();
  const listing = z.string().uuid().safeParse(id).success ? await loadListing(id, ctx.org.id) : null;
  return { ctx, listing };
}

export async function saveListing(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, message: "Check the highlighted fields.", fieldErrors };
  }
  const d = parsed.data;
  const { ctx, listing } = await authorisedListing(d.id);
  if (!listing) return { ok: false, message: "Listing not found." };
  if (listing.status === "ended" || listing.status === "publishing") return { ok: false, message: "This listing can't be edited right now." };

  const unlinked = !listing.supplier_products;
  const manualCost = unlinked && d.cost !== undefined && d.cost !== "" ? Number(d.cost) : null;
  const manualShip = unlinked && d.shipping !== undefined && d.shipping !== "" ? Number(d.shipping) : null;
  const next = {
    ...listing,
    title: d.title,
    description: sanitizeDescription(d.description),
    price: d.price,
    quantity: d.quantity,
    ...(manualCost !== null ? { manual_cost: manualCost } : {}),
    ...(manualShip !== null ? { manual_shipping_cost: manualShip } : {}),
  };
  const cost = listingCost(next);
  const rules = await loadStoreRules(listing.store_id);
  const guard = cost ? guardPrice(d.price, cost, rules) : null;
  const live = listing.status === "active" || listing.status === "out_of_stock";
  if (live && (!guard || !guard.ok)) {
    return {
      ok: false,
      message: guard
        ? `Not saved: ${guard.reasons.join(" ")}${guard.suggestedPrice ? ` The lowest passing price is $${guard.suggestedPrice.toFixed(2)}.` : ""}`
        : "Add a cost so the margin can be checked.",
      fieldErrors: { price: "Below the margin floor." },
    };
  }

  if (live) {
    try {
      await reviseLiveListing(next);
    } catch (e) {
      const msg =
        e instanceof EbayRateLimitError
          ? "eBay is rate limiting requests. Try again in a minute."
          : e instanceof EbayApiError
            ? `eBay rejected the change: ${e.message}`
            : "Couldn't update eBay.";
      return { ok: false, message: msg };
    }
  }

  const vero = checkVero(`${d.title}\n${d.description}`);
  let status = listing.status;
  if (!live && guard) status = guard.ok ? (listing.status === "blocked_margin" ? "draft" : listing.status) : "blocked_margin";
  const db = createAdminClient();
  const { error } = await db
    .from("listings")
    .update({
      title: next.title,
      description: next.description,
      price: d.price,
      quantity: d.quantity,
      ...(manualCost !== null ? { manual_cost: manualCost } : {}),
      ...(manualShip !== null ? { manual_shipping_cost: manualShip } : {}),
      status,
      net_margin_pct: guard?.breakdown.marginPct ?? listing.net_margin_pct,
      margin_reasons: guard && !guard.ok ? guard.reasons : [],
      last_error: guard && !guard.ok ? guard.reasons.join(" ") : null,
      vero_risk: vero.risk,
      vero_flags: vero.reasons,
      updated_at: new Date().toISOString(),
    })
    .eq("id", listing.id)
    .eq("org_id", ctx.org.id);
  if (error) return { ok: false, message: "Couldn't save. Please try again." };

  if (live) {
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (Number(listing.price) !== d.price) {
      before.price = Number(listing.price);
      after.price = d.price;
    }
    if (listing.quantity !== d.quantity) {
      before.quantity = listing.quantity;
      after.quantity = d.quantity;
    }
    if (listing.title !== d.title) {
      before.title = listing.title;
      after.title = d.title;
    }
    if (Object.keys(after).length) {
      await logActivity({
        orgId: ctx.org.id,
        storeId: listing.store_id,
        actor: "user",
        userId: ctx.user.id,
        entityType: "listing",
        entityId: listing.id,
        action: "listing_edited",
        before: { ...before, sku: listing.sku, offer_id: listing.ebay_offer_id },
        after,
        undoable: true,
      });
    }
  }
  revalidatePath(`/app/listings/${listing.id}`);
  revalidatePath("/app/listings");
  if (!live && guard && !guard.ok) return { ok: true, message: `Saved as a draft, but it's blocked: ${guard.reasons.join(" ")}` };
  return { ok: true, message: live ? "Saved and updated on eBay." : "Saved." };
}

export async function publishDraft(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, listing } = await authorisedListing(String(formData.get("id") ?? ""));
  if (!listing) return { ok: false, message: "Listing not found." };
  if (!["draft", "error", "blocked_margin"].includes(listing.status)) return { ok: false, message: "Only drafts can be published." };
  if (listing.quantity <= 0) return { ok: false, message: "Set a quantity above 0 before publishing." };
  try {
    const res = await publishListing(listing, { type: "user", userId: ctx.user.id });
    revalidatePath(`/app/listings/${listing.id}`);
    revalidatePath("/app/listings");
    return res.ok ? { ok: true, message: `Live on eBay (item ${res.listingId}).` } : { ok: false, message: res.message };
  } catch (e) {
    if (e instanceof EbayRateLimitError) return { ok: false, message: "eBay is rate limiting requests. Try again in a minute." };
    throw e;
  }
}

export async function endListingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, listing } = await authorisedListing(String(formData.get("id") ?? ""));
  if (!listing) return { ok: false, message: "Listing not found." };
  const res = await endListing(listing, ctx.user.id);
  revalidatePath(`/app/listings/${listing.id}`);
  revalidatePath("/app/listings");
  return res.ok ? { ok: true, message: "Listing ended. You can undo this from the activity log." } : { ok: false, message: res.message };
}
