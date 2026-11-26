import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

const { renderRedacted, imageInfo, renderAvatar } = await import("../render");

const W = 120;
const H = 80;

/** Image with 1px black/white vertical stripes everywhere: fine detail like text. */
async function stripes(): Promise<Buffer> {
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = x % 2 === 0 ? 0 : 255;
      const i = (y * W + x) * 3;
      raw[i] = raw[i + 1] = raw[i + 2] = v;
    }
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

async function pixels(png: Buffer) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { at: (x: number, y: number) => data[(y * info.width + x) * info.channels], info };
}

describe("renderRedacted", () => {
  it("destroys the detail inside each box and leaves the rest untouched", async () => {
    const box = { x: 20, y: 10, w: 48, h: 32 };
    const out = await renderRedacted(await stripes(), [box]);
    expect(out.width).toBe(W);
    expect(out.height).toBe(H);
    const px = await pixels(out.data);

    // Inside: the alternating stripes are gone. Neighbouring pixels in the box are equal and mid-grey.
    for (let y = box.y; y < box.y + box.h; y += 3) {
      for (let x = box.x; x < box.x + box.w - 1; x += 2) {
        const v = px.at(x, y);
        expect(v).toBeGreaterThan(60);
        expect(v).toBeLessThan(195);
      }
    }
    // Every row inside the box only has a few distinct values (flat blocks), not 2 alternating extremes per pixel.
    const row = new Set<number>();
    for (let x = box.x; x < box.x + box.w; x++) row.add(px.at(x, box.y + 5));
    expect(row.has(0) || row.has(255)).toBe(false);

    // Outside: original stripes survive exactly.
    expect(px.at(2, 2)).toBe(0);
    expect(px.at(3, 2)).toBe(255);
    expect(px.at(100, 70)).toBe(0);
    expect(px.at(101, 70)).toBe(255);
  });

  it("clamps out-of-bounds boxes instead of failing", async () => {
    const out = await renderRedacted(await stripes(), [{ x: 100, y: 60, w: 500, h: 500 }]);
    const px = await pixels(out.data);
    const v = px.at(110, 70);
    expect(v).toBeGreaterThan(60);
    expect(v).toBeLessThan(195);
  });

  it("with no boxes returns a re-encoded copy of the same size", async () => {
    const out = await renderRedacted(await stripes(), []);
    expect(out.width).toBe(W);
    const px = await pixels(out.data);
    expect(px.at(0, 0)).toBe(0);
    expect(px.at(1, 0)).toBe(255);
  });
});

describe("imageInfo and renderAvatar", () => {
  it("reads dimensions and rejects non-images", async () => {
    expect(await imageInfo(await stripes())).toEqual({ width: W, height: H, format: "png" });
    await expect(imageInfo(Buffer.from("not an image"))).rejects.toThrow();
  });

  it("makes a 256px square JPEG", async () => {
    const meta = await sharp(await renderAvatar(await stripes())).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
    expect(meta.exif).toBeUndefined();
  });
});
