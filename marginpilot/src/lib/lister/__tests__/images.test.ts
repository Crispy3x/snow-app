import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { cleanImage, edgeCut, loadRaw, normalizeRegion, planCleanup, ringStats, toPixels, type RawImage } from "../images";

const W = 200, H = 200;

/** White square with a grey "product" in the middle, plus optional overlays. */
async function makeImage(overlays: { left: number; top: number; width: number; height: number; color: string }[], noisy = false): Promise<Buffer> {
  const base = sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } });
  const layers = [
    { input: await sharp({ create: { width: 80, height: 80, channels: 3, background: "#777777" } }).png().toBuffer(), left: 60, top: 60 },
    ...(await Promise.all(
      overlays.map(async (o) => ({
        input: await sharp({ create: { width: o.width, height: o.height, channels: 3, background: o.color } }).png().toBuffer(),
        left: o.left,
        top: o.top,
      })),
    )),
  ];
  if (noisy) {
    // checkerboard background so the ring around a region isn't uniform
    const tile = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tile.fill(((x >> 2) + (y >> 2)) % 2 ? 0 : 255, (y * W + x) * 3, (y * W + x) * 3 + 3);
    return sharp(tile, { raw: { width: W, height: H, channels: 3 } }).composite(layers).png().toBuffer();
  }
  return base.composite(layers).png().toBuffer();
}

function pixel(img: RawImage, x: number, y: number) {
  const i = (y * img.width + x) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

describe("geometry helpers", () => {
  it("normalizes and clips regions", () => {
    expect(normalizeRegion({ x: -0.1, y: 0.9, w: 0.5, h: 0.5, kind: "banner" })).toEqual({ x: 0, y: 0.9, w: 0.5, h: expect.closeTo(0.1, 5), kind: "banner" });
    expect(normalizeRegion({ x: 1, y: 0, w: 0.2, h: 0.2, kind: "text" })).toBeNull();
  });

  it("converts to pixels with padding", () => {
    expect(toPixels({ x: 0.1, y: 0.2, w: 0.3, h: 0.1, kind: "text" }, 100, 100, 0.02)).toEqual({ left: 8, top: 18, width: 34, height: 14 });
  });

  it("finds the cheapest edge", () => {
    expect(edgeCut({ left: 0, top: 0, width: 200, height: 20 }, 200, 200)).toEqual({ edge: "top", depth: 20 });
    expect(edgeCut({ left: 0, top: 170, width: 200, height: 30 }, 200, 200)).toEqual({ edge: "bottom", depth: 30 });
    expect(edgeCut({ left: 80, top: 80, width: 20, height: 20 }, 200, 200)).toBeNull();
  });

  it("measures ring uniformity", async () => {
    const img = await loadRaw(await makeImage([]));
    const s = ringStats(img, { left: 10, top: 10, width: 20, height: 20 });
    expect(s.std).toBeLessThan(1);
    expect(s.mean).toEqual([255, 255, 255]);
  });
});

describe("planCleanup / cleanImage", () => {
  it("crops a banner along the bottom edge", async () => {
    const input = await makeImage([{ left: 0, top: 176, width: 200, height: 24, color: "#ff0000" }]);
    const res = await cleanImage(input, [{ x: 0, y: 0.88, w: 1, h: 0.12, kind: "banner" }]);
    expect(res.plan.crop).not.toBeNull();
    expect(res.plan.crop!.top).toBe(0);
    expect(res.plan.crop!.height).toBeLessThan(176);
    expect(res.fixedAll).toBe(true);
    const out = await loadRaw(res.output!);
    // no red left on the bottom row
    const [r, g] = pixel(out, 100, out.height - 1);
    expect(r - g).toBeLessThan(40);
  });

  it("fills a coupon on a plain background with the sampled colour", async () => {
    const input = await makeImage([{ left: 20, top: 150, width: 30, height: 20, color: "#00aa00" }]);
    const img = await loadRaw(input);
    const plan = planCleanup([{ x: 0.1, y: 0.75, w: 0.15, h: 0.1, kind: "coupon" }], img);
    expect(plan.crop).toBeNull();
    expect(plan.fills).toHaveLength(1);
    expect(plan.fills[0].color).toEqual([255, 255, 255]);
    const res = await cleanImage(input, [{ x: 0.1, y: 0.75, w: 0.15, h: 0.1, kind: "coupon" }]);
    const out = await loadRaw(res.output!);
    const [r, g, b] = pixel(out, 35, 160);
    expect(Math.min(r, g, b)).toBeGreaterThan(235);
  });

  it("refuses to guess when the overlay sits on a busy background", async () => {
    const input = await makeImage([{ left: 20, top: 30, width: 30, height: 20, color: "#0000ff" }], true);
    const res = await cleanImage(input, [{ x: 0.1, y: 0.15, w: 0.15, h: 0.1, kind: "watermark" }]);
    expect(res.output).toBeNull();
    expect(res.fixedAll).toBe(false);
    expect(res.plan.unfixable).toHaveLength(1);
  });

  it("won't crop away too much of the image", async () => {
    const img = await loadRaw(await makeImage([]));
    // banner covering the top 45% must not be cropped
    const plan = planCleanup([{ x: 0, y: 0, w: 1, h: 0.45, kind: "banner" }], img);
    expect(plan.crop).toBeNull();
  });

  it("keeps the aspect ratio sane", async () => {
    const img = await loadRaw(await makeImage([]));
    // two side strips of 25% each would make a tall 1:2 image when maxCropFraction allows it
    const plan = planCleanup(
      [{ x: 0, y: 0, w: 0.25, h: 1, kind: "banner" }, { x: 0.75, y: 0, w: 0.25, h: 1, kind: "banner" }],
      img,
      { maxCropFraction: 0.6 },
    );
    const crop = plan.crop!;
    expect(crop.width / crop.height).toBeGreaterThanOrEqual(0.6);
  });
});
