import sharp from "sharp";

/**
 * Local "clean white background" for photos that were already shot on a plain,
 * near-uniform backdrop (a sheet of paper, a light box, a plain wall). No AI and
 * no external service:
 *  1. sample a band around the border; if its colour spread is small, the
 *     background counts as uniform, otherwise we refuse (that needs Photoroom);
 *  2. flood-fill from the border every pixel close to the backdrop colour and
 *     paint it white (only pixels connected to the edge, so a white label on the
 *     product survives);
 *  3. trim to the product, then extend onto a square white canvas with a margin.
 * Planning is pure on raw RGB so it can be unit tested with generated images.
 */

export type Rgb = [number, number, number];
export type RawRgb = { data: Buffer; width: number; height: number; channels: number };

export type BackgroundStats = { uniform: boolean; color: Rgb; std: number; samples: number };

export type WhiteOptions = {
  /** Border band sampled for the backdrop colour, as a fraction of the shorter side. */
  band?: number;
  /** Border colour std-dev at or below this counts as a plain backdrop. */
  maxStd?: number;
  /** RGB distance from the backdrop colour that still counts as backdrop. */
  tolerance?: number;
  /** White margin around the product on the square canvas, as a fraction of the side. */
  margin?: number;
  /** Longest side of the output. */
  size?: number;
};

const DEFAULTS: Required<WhiteOptions> = { band: 0.03, maxStd: 14, tolerance: 42, margin: 0.08, size: 1600 };

/** Mean colour and spread of a band along all four edges. */
export function borderStats(img: RawRgb, opts: WhiteOptions = {}): BackgroundStats {
  const o = { ...DEFAULTS, ...opts };
  const b = Math.max(2, Math.round(Math.min(img.width, img.height) * o.band));
  const sum = [0, 0, 0], sq = [0, 0, 0];
  let n = 0;
  for (let y = 0; y < img.height; y++) {
    const edgeRow = y < b || y >= img.height - b;
    for (let x = 0; x < img.width; x++) {
      if (!edgeRow && x >= b && x < img.width - b) continue;
      const i = (y * img.width + x) * img.channels;
      for (let c = 0; c < 3; c++) {
        const v = img.data[i + Math.min(c, img.channels - 1)];
        sum[c] += v;
        sq[c] += v * v;
      }
      n++;
    }
  }
  if (!n) return { uniform: false, color: [255, 255, 255], std: Infinity, samples: 0 };
  const mean = sum.map((s) => s / n) as Rgb;
  const variance = sq.reduce((acc, s, c) => acc + (s / n - mean[c] * mean[c]), 0) / 3;
  const std = Math.sqrt(Math.max(0, variance));
  return { uniform: std <= o.maxStd, color: mean.map((m) => Math.round(m)) as Rgb, std, samples: n };
}

export type WhitePlan = {
  /** Pixel mask: 1 = backdrop (to be painted white). */
  mask: Uint8Array;
  /** Bounding box of the product (non-backdrop pixels), or null when nothing is left. */
  box: { left: number; top: number; width: number; height: number } | null;
  backdropFraction: number;
};

/** Flood-fill the backdrop from the edges. Pure. */
export function planWhite(img: RawRgb, color: Rgb, opts: WhiteOptions = {}): WhitePlan {
  const o = { ...DEFAULTS, ...opts };
  const { width: W, height: H, channels: C, data } = img;
  const tol2 = o.tolerance * o.tolerance;
  const mask = new Uint8Array(W * H);
  const close = (p: number) => {
    const i = p * C;
    const dr = data[i] - color[0], dg = data[i + Math.min(1, C - 1)] - color[1], db = data[i + Math.min(2, C - 1)] - color[2];
    return dr * dr + dg * dg + db * db <= tol2;
  };
  const stack = new Int32Array(W * H);
  let top = 0;
  const seed = (p: number) => {
    if (!mask[p] && close(p)) {
      mask[p] = 1;
      stack[top++] = p;
    }
  };
  for (let x = 0; x < W; x++) {
    seed(x);
    seed((H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    seed(y * W);
    seed(y * W + W - 1);
  }
  while (top > 0) {
    const p = stack[--top];
    const x = p % W, y = (p - x) / W;
    if (x > 0) seed(p - 1);
    if (x < W - 1) seed(p + 1);
    if (y > 0) seed(p - W);
    if (y < H - 1) seed(p + W);
  }

  let minX = W, minY = H, maxX = -1, maxY = -1, filled = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x]) {
        filled++;
        continue;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const box = maxX < 0 ? null : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  return { mask, box, backdropFraction: filled / (W * H) };
}

export type WhiteResult =
  | { ok: true; output: Buffer; width: number; height: number; stats: BackgroundStats }
  | { ok: false; reason: string; stats?: BackgroundStats };

/** Decode with EXIF orientation applied and any transparency flattened onto white. */
export async function loadRgb(input: Buffer, maxSide = 1600): Promise<RawRgb> {
  const { data, info } = await sharp(input)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Is the photo's backdrop plain enough for the local white-background option? */
export async function canWhiten(input: Buffer, opts: WhiteOptions = {}): Promise<BackgroundStats> {
  return borderStats(await loadRgb(input, 600), opts);
}

/** Paint the backdrop white, trim, and centre on a square white canvas. Returns a JPEG. */
export async function whiteBackground(input: Buffer, opts: WhiteOptions = {}): Promise<WhiteResult> {
  const o = { ...DEFAULTS, ...opts };
  let img: RawRgb;
  try {
    img = await loadRgb(input, o.size);
  } catch {
    return { ok: false, reason: "That file couldn't be read as an image." };
  }
  const stats = borderStats(img, o);
  if (!stats.uniform) {
    return { ok: false, stats, reason: "The background isn't plain enough to clean locally. Use background removal (Photoroom) or reshoot on a plain sheet." };
  }
  const plan = planWhite(img, stats.color, o);
  if (!plan.box || plan.box.width < 8 || plan.box.height < 8) {
    return { ok: false, stats, reason: "Couldn't find the product against the background. Try a photo with more contrast." };
  }

  const data = Buffer.from(img.data);
  for (let p = 0; p < plan.mask.length; p++) {
    if (!plan.mask[p]) continue;
    const i = p * img.channels;
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
  }

  const { width: bw, height: bh } = plan.box;
  // Square canvas: product fills (1 - 2*margin) of the side, never upscaled past the output size.
  const inner = Math.max(bw, bh);
  const side = Math.min(o.size, Math.round(inner / (1 - 2 * o.margin)));
  const scale = Math.min(1, (side * (1 - 2 * o.margin)) / inner);
  const pw = Math.max(1, Math.round(bw * scale)), ph = Math.max(1, Math.round(bh * scale));
  const product = await sharp(data, { raw: { width: img.width, height: img.height, channels: img.channels as 3 } })
    .extract(plan.box)
    .resize({ width: pw, height: ph, fit: "fill" })
    .png()
    .toBuffer();
  const left = Math.floor((side - pw) / 2), top = Math.floor((side - ph) / 2);
  const output = await sharp(product)
    .extend({ left, top, right: side - pw - left, bottom: side - ph - top, background: "#ffffff" })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return { ok: true, output, width: side, height: side, stats };
}

/** Centre any image on a square white canvas (JPEG), with an optional white margin. */
export async function toSquareJpeg(input: Buffer, opts: { size?: number; margin?: number } = {}): Promise<Buffer> {
  const size = opts.size ?? 1600;
  const margin = Math.min(0.4, Math.max(0, opts.margin ?? 0));
  const inner = Math.max(1, Math.round(size * (1 - 2 * margin)));
  const fitted = await sharp(input)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: inner, height: inner, fit: "inside" })
    .png()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = fitted.info;
  const left = Math.floor((size - w) / 2), top = Math.floor((size - h) / 2);
  return sharp(fitted.data)
    .extend({ left, top, right: size - w - left, bottom: size - h - top, background: "#ffffff" })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}
