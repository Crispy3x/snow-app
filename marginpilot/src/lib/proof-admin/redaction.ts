/**
 * Redaction boxes for proof screenshots. Pure functions shared by the client
 * redaction tool and the server renderer, so both agree on what gets hidden.
 * Coordinates are integer pixels of the (auto-oriented) original image.
 */

export type RedactionBox = { x: number; y: number; w: number; h: number };

export const MAX_BOXES = 200;
/** Boxes smaller than this (either side) are dropped: they can't hide anything useful. */
export const MIN_BOX_SIDE = 4;

function finite(n: unknown): number | null {
  const v = typeof n === "string" && n.trim() !== "" ? Number(n) : n;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Clamp a box to the image bounds and round outward to whole pixels, so a
 * fractional box never leaves a sliver of unredacted pixels at its edge.
 * Negative width/height (dragged up or left) is normalised. Returns null if
 * nothing usable is left.
 */
export function clampBox(box: RedactionBox, imageWidth: number, imageHeight: number): RedactionBox | null {
  if (!(imageWidth > 0) || !(imageHeight > 0)) return null;
  const vals = [box.x, box.y, box.w, box.h].map(finite);
  if (vals.some((v) => v === null)) return null;
  const [x, y, w, h] = vals as number[];
  const x1 = Math.min(x, x + w);
  const y1 = Math.min(y, y + h);
  const x2 = Math.max(x, x + w);
  const y2 = Math.max(y, y + h);

  const left = Math.max(0, Math.floor(x1));
  const top = Math.max(0, Math.floor(y1));
  const right = Math.min(imageWidth, Math.ceil(x2));
  const bottom = Math.min(imageHeight, Math.ceil(y2));
  const cw = right - left;
  const ch = bottom - top;
  if (cw < MIN_BOX_SIDE || ch < MIN_BOX_SIDE) return null;
  return { x: left, y: top, w: cw, h: ch };
}

/**
 * Validate untrusted input (form JSON, DB jsonb) into a clean list of boxes.
 * Drops malformed entries, clamps the rest, removes exact duplicates and caps
 * the count. Throws on more than MAX_BOXES so the admin learns about it rather
 * than silently losing boxes.
 */
export function normalizeBoxes(input: unknown, imageWidth: number, imageHeight: number): RedactionBox[] {
  if (!Array.isArray(input)) return [];
  if (input.length > MAX_BOXES) throw new Error(`Too many redaction boxes (max ${MAX_BOXES}).`);
  const out: RedactionBox[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const box = clampBox(
      { x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number },
      imageWidth,
      imageHeight,
    );
    if (!box) continue;
    const key = `${box.x},${box.y},${box.w},${box.h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(box);
  }
  return out;
}

/** Box spanning two drag points (any direction). */
export function boxFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): RedactionBox {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/**
 * Pixelation block size for a box: at least 16px, and large enough that the
 * shorter side holds at most 3 blocks. Text inside becomes a few flat colour
 * cells; nothing legible survives.
 */
export function pixelBlockSize(box: RedactionBox): number {
  return Math.max(16, Math.ceil(Math.min(box.w, box.h) / 3));
}

/** Size the region is shrunk to before being scaled back up with nearest-neighbour. */
export function pixelGrid(box: RedactionBox): { cols: number; rows: number } {
  const block = pixelBlockSize(box);
  return { cols: Math.max(1, Math.ceil(box.w / block)), rows: Math.max(1, Math.ceil(box.h / block)) };
}

/** Does the point fall inside the box? Used to select a box by tapping it. */
export function hitTest(boxes: RedactionBox[], p: { x: number; y: number }): number {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return i;
  }
  return -1;
}
