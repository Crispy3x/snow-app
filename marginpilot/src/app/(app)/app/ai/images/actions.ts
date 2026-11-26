"use server";

import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAi } from "@/lib/ai/run";
import { EbayApiError, EbayRateLimitError } from "@/lib/ebay/client";
import { logActivity } from "@/lib/activity";
import { cleanImage, type Region } from "@/lib/lister/images";
import { loadListing, reviseLiveListing } from "@/lib/lister/publish";
import { fetchImage, moveImage, removeImage, signedUrl, uploadImage } from "@/lib/lister/storage";

const analysisSchema = z.object({
  hasPromo: z.boolean(),
  regions: z.array(
    z.object({
      x: z.number().describe("left edge, fraction of width 0..1"),
      y: z.number().describe("top edge, fraction of height 0..1"),
      w: z.number().describe("width, fraction 0..1"),
      h: z.number().describe("height, fraction 0..1"),
      kind: z.enum(["banner", "coupon", "watermark", "text", "logo"]),
    }),
  ),
  fixable: z.boolean(),
  reason: z.string(),
});

const SYSTEM = `You inspect supplier product photos before they go on eBay.
Find promotional overlays that eBay doesn't allow or that look spammy: sale banners, coupon/discount stickers, price tags, watermarks, website names, added text and seller/supplier logos stamped on the photo.
Do NOT flag text or logos that are physically printed on the product or its packaging.
Return a tight bounding box for each overlay as fractions of the image (x, y = top-left corner; w, h = size; all 0..1).
Set fixable true only if every overlay is at an image edge or sits on a plain, uniform background (so it can be cropped or filled), and explain briefly in reason.`;

export type CleanState = {
  ok?: boolean;
  message?: string;
  requestId?: string;
  beforeUrl?: string;
  afterUrl?: string | null;
  pendingPath?: string | null;
  listingId?: string | null;
  imageIndex?: number | null;
  hasPromo?: boolean;
  regions?: Region[];
  aiReason?: string;
  actions?: string[];
  unfixable?: string[];
} | null;

export async function analyzeImage(_prev: CleanState, formData: FormData): Promise<CleanState> {
  const ctx = await requireStore();
  const listingId = String(formData.get("listingId") ?? "");
  const imageIndex = Number(formData.get("imageIndex") ?? 0) || 0;
  let url = String(formData.get("imageUrl") ?? "").trim();
  let listing: Awaited<ReturnType<typeof loadListing>> = null;

  if (!url && listingId) {
    if (!z.string().uuid().safeParse(listingId).success) return { ok: false, message: "Choose a listing." };
    listing = await loadListing(listingId, ctx.org.id);
    if (!listing) return { ok: false, message: "Listing not found." };
    url = (listing.images ?? [])[imageIndex] ?? "";
    if (!url) return { ok: false, message: "That listing has no photo at that position." };
  }
  if (!url) return { ok: false, message: "Choose a listing photo or paste an image URL." };

  let original: Buffer;
  try {
    original = (await fetchImage(url)).data;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't download the image." };
  }

  let forAi: Buffer;
  try {
    forAi = await sharp(original).rotate().resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  } catch {
    return { ok: false, message: "That file couldn't be read as an image." };
  }

  const res = await runAi({
    orgId: ctx.org.id,
    userId: ctx.user.id,
    storeId: ctx.store.id,
    tool: "image_cleaner",
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: forAi.toString("base64") } },
          { type: "text", text: "Find promotional overlays on this product photo." },
        ],
      },
    ],
    logPrompt: { system: SYSTEM, image: url.slice(0, 500) },
    schema: analysisSchema,
    maxTokens: 1500,
    effort: "low",
  });
  if (!res.ok) return { ok: false, message: res.message };

  const regions: Region[] = res.output.hasPromo ? res.output.regions : [];
  const base: CleanState = {
    ok: true,
    requestId: res.requestId,
    beforeUrl: url,
    listingId: listing ? listing.id : null,
    imageIndex: listing ? imageIndex : null,
    hasPromo: res.output.hasPromo && regions.length > 0,
    regions,
    aiReason: res.output.reason,
  };
  if (!base.hasPromo) return { ...base, afterUrl: null, pendingPath: null, message: "No promo overlays found. This photo is fine to use.", actions: [], unfixable: [] };

  const cleaned = await cleanImage(original, regions);
  const actions = [
    ...(cleaned.plan.crop ? [`Cropped ${cleaned.plan.width - cleaned.plan.crop.width}px × ${cleaned.plan.height - cleaned.plan.crop.height}px off the edges`] : []),
    ...cleaned.plan.fills.map((f) => `Filled a ${f.kind} with the background colour`),
  ];
  const unfixable = cleaned.plan.unfixable.map((u) => `${u.region.kind}: ${u.reason}`);
  if (!cleaned.output) {
    return { ...base, afterUrl: null, pendingPath: null, actions, unfixable, message: "Can't fix this photo automatically. Use a different photo or ask the supplier for a clean one." };
  }
  const pendingPath = `${ctx.org.id}/pending/${randomUUID()}.jpg`;
  try {
    await uploadImage(pendingPath, cleaned.output);
    const afterUrl = await signedUrl(pendingPath, 60 * 60);
    return {
      ...base,
      afterUrl,
      pendingPath,
      actions,
      unfixable,
      message: cleaned.fixedAll ? "Cleaned. Compare and approve." : "Partly cleaned: some overlays can't be removed safely (see below).",
    };
  } catch (e) {
    return { ...base, ok: false, message: e instanceof Error ? e.message : "Couldn't store the cleaned image." };
  }
}

const approveSchema = z.object({
  requestId: z.string().uuid(),
  pendingPath: z.string().min(10),
  listingId: z.string().uuid().optional().or(z.literal("")),
  imageIndex: z.coerce.number().int().min(0).max(23).optional(),
});

export async function approveImage(_prev: CleanState, formData: FormData): Promise<CleanState> {
  const ctx = await requireStore();
  const parsed = approveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Something was missing. Run the cleaner again." };
  const d = parsed.data;
  if (!d.pendingPath.startsWith(`${ctx.org.id}/pending/`) || d.pendingPath.includes("..")) return { ok: false, message: "Image not found." };
  const db = createAdminClient();

  if (!d.listingId) {
    const finalPath = `${ctx.org.id}/cleaned/${randomUUID()}.jpg`;
    await moveImage(d.pendingPath, finalPath);
    const url = await signedUrl(finalPath);
    await db.from("ai_requests").update({ draft_status: "applied" }).eq("id", d.requestId).eq("org_id", ctx.org.id);
    return { ok: true, message: "Saved. Use this URL for your listing photo:", afterUrl: url, pendingPath: null };
  }

  const listing = await loadListing(d.listingId, ctx.org.id);
  if (!listing) return { ok: false, message: "Listing not found." };
  const finalPath = `${ctx.org.id}/${listing.id}/${randomUUID()}.jpg`;
  await moveImage(d.pendingPath, finalPath);
  const url = await signedUrl(finalPath);
  const before = listing.images ?? [];
  const images = [...before];
  const idx = d.imageIndex ?? 0;
  if (idx < images.length) images[idx] = url;
  else images.unshift(url);

  const live = listing.status === "active" || listing.status === "out_of_stock";
  if (live) {
    try {
      await reviseLiveListing({ ...listing, images });
    } catch (e) {
      const msg = e instanceof EbayRateLimitError ? "eBay is rate limiting requests. Try again in a minute." : e instanceof EbayApiError ? `eBay rejected the photo: ${e.message}` : "Couldn't update eBay.";
      return { ok: false, message: msg };
    }
  }
  await db.from("listings").update({ images, updated_at: new Date().toISOString() }).eq("id", listing.id).eq("org_id", ctx.org.id);
  await db.from("ai_requests").update({ draft_status: "applied" }).eq("id", d.requestId).eq("org_id", ctx.org.id);
  if (live) {
    await logActivity({
      orgId: ctx.org.id,
      storeId: listing.store_id,
      actor: "user",
      userId: ctx.user.id,
      entityType: "listing",
      entityId: listing.id,
      action: "images_changed",
      before: { images: before, sku: listing.sku },
      after: { images, source: "image_cleaner" },
      undoable: true,
    });
  }
  revalidatePath(`/app/listings/${listing.id}`);
  return { ok: true, message: live ? "Photo replaced on the listing and on eBay." : "Photo replaced on the listing.", afterUrl: url, pendingPath: null, listingId: listing.id };
}

export async function discardImage(formData: FormData) {
  const ctx = await requireStore();
  const pendingPath = String(formData.get("pendingPath") ?? "");
  const requestId = String(formData.get("requestId") ?? "");
  if (pendingPath.startsWith(`${ctx.org.id}/pending/`) && !pendingPath.includes("..")) await removeImage(pendingPath);
  if (z.string().uuid().safeParse(requestId).success) {
    await createAdminClient().from("ai_requests").update({ draft_status: "rejected" }).eq("id", requestId).eq("org_id", ctx.org.id);
  }
}
