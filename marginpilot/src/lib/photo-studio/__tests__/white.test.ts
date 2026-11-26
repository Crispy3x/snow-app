import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { borderStats, canWhiten, loadRgb, planWhite, toSquareJpeg, whiteBackground } from "../white";

/** Light grey backdrop with a red product block (and a white label on it). */
async function productOnPlain(w = 400, h = 300, bg = { r: 236, g: 234, b: 230 }) {
  const product = await sharp({ create: { width: 120, height: 90, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .composite([{ input: await sharp({ create: { width: 30, height: 20, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer(), left: 45, top: 35 }])
    .png()
    .toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background: bg } })
    .composite([{ input: product, left: 220, top: 150 }])
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function noisy(w = 300, h = 300) {
  const data = Buffer.alloc(w * h * 3);
  let seed = 7;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = seed % 256;
  }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

async function pixel(buf: Buffer, x: number, y: number) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}

describe("local white background", () => {
  it("detects a plain backdrop and a busy one", async () => {
    expect((await canWhiten(await productOnPlain())).uniform).toBe(true);
    expect((await canWhiten(await noisy())).uniform).toBe(false);
  });

  it("flood-fills only the backdrop and finds the product box", async () => {
    const raw = await loadRgb(await productOnPlain());
    const stats = borderStats(raw);
    const plan = planWhite(raw, stats.color);
    expect(plan.box).not.toBeNull();
    expect(plan.box!.left).toBeGreaterThanOrEqual(216);
    expect(plan.box!.left).toBeLessThanOrEqual(222);
    expect(plan.box!.width).toBeGreaterThanOrEqual(116);
    expect(plan.box!.width).toBeLessThanOrEqual(126);
    // the white label inside the product is not connected to the edge, so it stays product
    expect(plan.mask[(150 + 45) * raw.width + 220 + 60]).toBe(0);
    expect(plan.backdropFraction).toBeGreaterThan(0.85);
  });

  it("outputs a square JPEG with a white canvas and the product centred", async () => {
    const res = await whiteBackground(await productOnPlain());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const meta = await sharp(res.output).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(meta.height);
    const side = meta.width!;
    const corner = await pixel(res.output, 2, 2);
    corner.forEach((v) => expect(v).toBeGreaterThan(248));
    const [r, g, b] = await pixel(res.output, Math.floor(side / 2) - Math.floor(side * 0.3), Math.floor(side / 2));
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(80);
    expect(b).toBeLessThan(80);
  });

  it("refuses busy backgrounds instead of guessing", async () => {
    const res = await whiteBackground(await noisy());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/plain/i);
  });

  it("refuses when nothing but backdrop is found", async () => {
    const blank = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 240, g: 240, b: 240 } } }).jpeg().toBuffer();
    const res = await whiteBackground(blank);
    expect(res.ok).toBe(false);
  });

  it("rejects files that aren't images", async () => {
    const res = await whiteBackground(Buffer.from("not an image"));
    expect(res.ok).toBe(false);
  });

  it("toSquareJpeg pads any image onto a white square", async () => {
    const wide = await sharp({ create: { width: 400, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } } }).png().toBuffer();
    const out = await toSquareJpeg(wide, { size: 500, margin: 0.1 });
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([500, 500]);
    (await pixel(out, 250, 10)).forEach((v) => expect(v).toBeGreaterThan(248));
    const [, , blue] = await pixel(out, 250, 250);
    expect(blue).toBeGreaterThan(200);
  });
});
