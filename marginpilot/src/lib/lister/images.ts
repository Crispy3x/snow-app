import sharp from "sharp";

/**
 * Image cleaner geometry. Claude finds promo overlays (bounding boxes as
 * fractions); this module removes them without guessing (docs/PLAN.md §3):
 *  - overlays touching an edge are cropped off, within limits that keep the
 *    product and a sane aspect ratio;
 *  - overlays on a near-uniform background are filled with the sampled colour;
 *  - anything else is reported as "can't fix" for the seller.
 * Planning is pure (works on a raw RGB buffer); applying uses sharp.
 */

export type PromoKind = "banner" | "coupon" | "watermark" | "text" | "logo";
export type Region = { x: number; y: number; w: number; h: number; kind: PromoKind };
export type PixelRect = { left: number; top: number; width: number; height: number };
export type RawImage = { data: Buffer; width: number; height: number; channels: number };
export type Rgb = [number, number, number];

export type CleanPlan = {
  width: number;
  height: number;
  crop: PixelRect | null;
  fills: { rect: PixelRect; color: Rgb; kind: PromoKind }[];
  unfixable: { region: Region; reason: string }[];
};

export type PlanOptions = {
  /** Region counts as touching an edge within this fraction of the side. */
  edgeTolerance?: number;
  /** Max fraction of width or height that may be cropped away in total. */
  maxCropFraction?: number;
  /** Allowed output aspect ratio range (width / height). */
  minAspect?: number;
  maxAspect?: number;
  /** Padding added around each region, as a fraction of the shorter side. */
  padding?: number;
  /** Ring std-dev at or below this counts as a plain background. */
  uniformStd?: number;
};

const DEFAULTS: Required<PlanOptions> = {
  edgeTolerance: 0.04,
  maxCropFraction: 0.3,
  minAspect: 0.6,
  maxAspect: 1.67,
  padding: 0.01,
  uniformStd: 12,
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/** Clip a region to the image and drop empty ones. */
export function normalizeRegion(r: Region): Region | null {
  const x = clamp01(r.x), y = clamp01(r.y);
  const w = clamp01(Math.min(r.w, 1 - x)), h = clamp01(Math.min(r.h, 1 - y));
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h, kind: r.kind };
}

export function toPixels(r: Region, width: number, height: number, padding = 0): PixelRect {
  const pad = Math.round(Math.min(width, height) * padding);
  const left = Math.max(0, Math.floor(r.x * width + 1e-6) - pad);
  const top = Math.max(0, Math.floor(r.y * height + 1e-6) - pad);
  const right = Math.min(width, Math.ceil((r.x + r.w) * width - 1e-6) + pad);
  const bottom = Math.min(height, Math.ceil((r.y + r.h) * height - 1e-6) + pad);
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

type Edge = "top" | "bottom" | "left" | "right";

/** The cheapest edge to crop a rect off, if it touches one: depth in pixels from that edge. */
export function edgeCut(rect: PixelRect, width: number, height: number, tolerance = DEFAULTS.edgeTolerance): { edge: Edge; depth: number } | null {
  const opts: { edge: Edge; depth: number }[] = [];
  if (rect.top <= tolerance * height) opts.push({ edge: "top", depth: rect.top + rect.height });
  if (rect.top + rect.height >= height - tolerance * height) opts.push({ edge: "bottom", depth: height - rect.top });
  if (rect.left <= tolerance * width) opts.push({ edge: "left", depth: rect.left + rect.width });
  if (rect.left + rect.width >= width - tolerance * width) opts.push({ edge: "right", depth: width - rect.left });
  if (!opts.length) return null;
  // compare as a fraction of the side being cut
  const frac = (o: { edge: Edge; depth: number }) => o.depth / (o.edge === "top" || o.edge === "bottom" ? height : width);
  return opts.sort((a, b) => frac(a) - frac(b))[0];
}

/** Mean colour and spread of the pixels in a band around (outside) a rect. */
export function ringStats(img: RawImage, rect: PixelRect, ring?: number): { mean: Rgb; std: number; samples: number } {
  const band = ring ?? Math.max(3, Math.round(Math.min(img.width, img.height) * 0.03));
  const x0 = Math.max(0, rect.left - band), y0 = Math.max(0, rect.top - band);
  const x1 = Math.min(img.width, rect.left + rect.width + band), y1 = Math.min(img.height, rect.top + rect.height + band);
  const sum = [0, 0, 0], sq = [0, 0, 0];
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const inside = x >= rect.left && x < rect.left + rect.width && y >= rect.top && y < rect.top + rect.height;
      if (inside) continue;
      const i = (y * img.width + x) * img.channels;
      for (let c = 0; c < 3; c++) {
        const v = img.data[i + Math.min(c, img.channels - 1)];
        sum[c] += v;
        sq[c] += v * v;
      }
      n++;
    }
  }
  if (n === 0) return { mean: [255, 255, 255], std: Infinity, samples: 0 };
  const mean = sum.map((s) => s / n) as Rgb;
  const variance = sq.reduce((acc, s, c) => acc + (s / n - mean[c] * mean[c]), 0) / 3;
  return { mean: mean.map((m) => Math.round(m)) as Rgb, std: Math.sqrt(Math.max(0, variance)), samples: n };
}

const overlaps = (a: PixelRect, b: PixelRect) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/** Decide how to remove each region. Pure. */
export function planCleanup(regionsIn: Region[], img: RawImage, options: PlanOptions = {}): CleanPlan {
  const o = { ...DEFAULTS, ...options };
  const { width: W, height: H } = img;
  const regions = regionsIn.map(normalizeRegion).filter((r): r is Region => r !== null);
  const rects = regions.map((r) => toPixels(r, W, H, o.padding));

  // 1. Crop: add edge regions one at a time while the crop stays within limits.
  const cut = { top: 0, bottom: 0, left: 0, right: 0 };
  const cropped = new Set<number>();
  const order = rects
    .map((rect, i) => ({ i, c: edgeCut(rect, W, H, o.edgeTolerance) }))
    .filter((e): e is { i: number; c: { edge: Edge; depth: number } } => e.c !== null)
    .sort((a, b) => a.c.depth - b.c.depth);
  for (const { i, c } of order) {
    const next = { ...cut, [c.edge]: Math.max(cut[c.edge], c.depth) };
    const w = W - next.left - next.right, h = H - next.top - next.bottom;
    if (w <= 0 || h <= 0) continue;
    if (next.left + next.right > o.maxCropFraction * W || next.top + next.bottom > o.maxCropFraction * H) continue;
    const aspect = w / h;
    if (aspect < o.minAspect || aspect > o.maxAspect) continue;
    Object.assign(cut, next);
    cropped.add(i);
  }
  const crop: PixelRect | null = cropped.size
    ? { left: cut.left, top: cut.top, width: W - cut.left - cut.right, height: H - cut.top - cut.bottom }
    : null;

  // 2. Fill: remaining regions on a plain background.
  const fills: CleanPlan["fills"] = [];
  const unfixable: CleanPlan["unfixable"] = [];
  rects.forEach((rect, i) => {
    if (cropped.has(i)) return;
    if (crop && !overlaps(rect, crop)) return; // removed by the crop anyway
    const s = ringStats(img, rect);
    if (s.std <= o.uniformStd) {
      fills.push({ rect, color: s.mean, kind: regions[i].kind });
      return;
    }
    const tooBig = regions[i].w * regions[i].h > 0.35;
    unfixable.push({
      region: regions[i],
      reason: tooBig
        ? "The overlay covers too much of the photo to remove safely."
        : edgeCut(rect, W, H, o.edgeTolerance)
          ? "It's at the edge, but cropping it off would cut too much of the product or distort the shape."
          : "It sits over the product or a busy background, so it can't be removed without guessing.",
    });
  });
  // a fill entirely inside a cropped strip is pointless
  const keptFills = crop ? fills.filter((f) => overlaps(f.rect, crop)) : fills;
  return { width: W, height: H, crop, fills: keptFills, unfixable };
}

export function hasChanges(plan: CleanPlan): boolean {
  return plan.crop !== null || plan.fills.length > 0;
}

/** Decode to raw RGB with EXIF orientation applied, so plans match what users see. */
export async function loadRaw(input: Buffer, maxSide = 1600): Promise<RawImage> {
  const { data, info } = await sharp(input)
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Apply fills then crop. Returns a JPEG. */
export async function applyCleanup(img: RawImage, plan: CleanPlan): Promise<Buffer> {
  const data = Buffer.from(img.data);
  for (const f of plan.fills) {
    for (let y = f.rect.top; y < f.rect.top + f.rect.height; y++) {
      for (let x = f.rect.left; x < f.rect.left + f.rect.width; x++) {
        const i = (y * img.width + x) * img.channels;
        data[i] = f.color[0];
        data[i + 1] = f.color[1];
        data[i + 2] = f.color[2];
      }
    }
  }
  let pipeline = sharp(data, { raw: { width: img.width, height: img.height, channels: img.channels as 3 | 4 } });
  if (plan.crop) pipeline = pipeline.extract(plan.crop);
  return pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

export type CleanResult = { plan: CleanPlan; output: Buffer | null; fixedAll: boolean };

/** Plan and apply in one go. output is null when nothing could be changed. */
export async function cleanImage(input: Buffer, regions: Region[], options?: PlanOptions): Promise<CleanResult> {
  const img = await loadRaw(input);
  const plan = planCleanup(regions, img, options);
  const output = hasChanges(plan) ? await applyCleanup(img, plan) : null;
  return { plan, output, fixedAll: plan.unfixable.length === 0 && output !== null };
}
