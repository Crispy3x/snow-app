import { describe, expect, it } from "vitest";
import { MAX_BOXES, boxFromPoints, clampBox, hitTest, normalizeBoxes, pixelBlockSize, pixelGrid } from "../redaction";

describe("clampBox", () => {
  it("keeps a box that is already inside the image", () => {
    expect(clampBox({ x: 10, y: 20, w: 30, h: 40 }, 100, 100)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });

  it("clamps boxes that run off the edges", () => {
    expect(clampBox({ x: -10, y: -5, w: 50, h: 30 }, 100, 100)).toEqual({ x: 0, y: 0, w: 40, h: 25 });
    expect(clampBox({ x: 80, y: 90, w: 50, h: 50 }, 100, 100)).toEqual({ x: 80, y: 90, w: 20, h: 10 });
  });

  it("rounds outward so no fractional edge is left unredacted", () => {
    expect(clampBox({ x: 10.7, y: 10.2, w: 5.1, h: 5.1 }, 100, 100)).toEqual({ x: 10, y: 10, w: 6, h: 6 });
  });

  it("normalises negative width and height (dragged up/left)", () => {
    expect(clampBox({ x: 50, y: 50, w: -20, h: -10 }, 100, 100)).toEqual({ x: 30, y: 40, w: 20, h: 10 });
  });

  it("drops boxes that are fully outside, too small or not numbers", () => {
    expect(clampBox({ x: 200, y: 200, w: 10, h: 10 }, 100, 100)).toBeNull();
    expect(clampBox({ x: 10, y: 10, w: 2, h: 50 }, 100, 100)).toBeNull();
    expect(clampBox({ x: Number.NaN, y: 10, w: 20, h: 20 }, 100, 100)).toBeNull();
    expect(clampBox({ x: 1, y: 1, w: 10, h: 10 }, 0, 100)).toBeNull();
  });

  it("accepts numeric strings from form inputs", () => {
    expect(clampBox({ x: "5", y: "6", w: "10", h: "12" } as never, 100, 100)).toEqual({ x: 5, y: 6, w: 10, h: 12 });
  });
});

describe("normalizeBoxes", () => {
  it("validates untrusted input, drops junk and duplicates", () => {
    const out = normalizeBoxes(
      [{ x: 1, y: 1, w: 10, h: 10 }, null, "x", { x: 1, y: 1, w: 10, h: 10 }, { x: 5 }, { x: 90, y: 90, w: 50, h: 50 }],
      100,
      100,
    );
    expect(out).toEqual([
      { x: 1, y: 1, w: 10, h: 10 },
      { x: 90, y: 90, w: 10, h: 10 },
    ]);
  });

  it("returns [] for non-arrays", () => {
    expect(normalizeBoxes({ x: 1 }, 100, 100)).toEqual([]);
    expect(normalizeBoxes(null, 100, 100)).toEqual([]);
  });

  it("refuses more than MAX_BOXES rather than silently dropping some", () => {
    const many = Array.from({ length: MAX_BOXES + 1 }, (_, i) => ({ x: i, y: 0, w: 10, h: 10 }));
    expect(() => normalizeBoxes(many, 1000, 1000)).toThrow(/Too many/);
  });
});

describe("drawing helpers", () => {
  it("builds a box from two drag points in any direction", () => {
    expect(boxFromPoints({ x: 50, y: 40 }, { x: 10, y: 80 })).toEqual({ x: 10, y: 40, w: 40, h: 40 });
  });

  it("hit-tests the topmost box", () => {
    const boxes = [
      { x: 0, y: 0, w: 50, h: 50 },
      { x: 20, y: 20, w: 50, h: 50 },
    ];
    expect(hitTest(boxes, { x: 30, y: 30 })).toBe(1);
    expect(hitTest(boxes, { x: 5, y: 5 })).toBe(0);
    expect(hitTest(boxes, { x: 99, y: 99 })).toBe(-1);
  });

  it("pixelates heavily: at least 16px blocks, at most ~3 blocks on the short side", () => {
    expect(pixelBlockSize({ x: 0, y: 0, w: 300, h: 20 })).toBe(16);
    expect(pixelBlockSize({ x: 0, y: 0, w: 300, h: 300 })).toBe(100);
    expect(pixelGrid({ x: 0, y: 0, w: 300, h: 20 })).toEqual({ cols: 19, rows: 2 });
    expect(pixelGrid({ x: 0, y: 0, w: 8, h: 8 })).toEqual({ cols: 1, rows: 1 });
  });
});
