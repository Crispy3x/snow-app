import "server-only";
import sharp from "sharp";
import { clampBox, pixelGrid, type RedactionBox } from "./redaction";

/**
 * Server-side rendering of proof images. Runs on the original (private) bytes
 * and returns new bytes with redacted regions destroyed, so the unredacted
 * pixels never reach the public bucket. Output is re-encoded, which also drops
 * EXIF/GPS metadata.
 */

/** Auto-oriented dimensions, matching what the browser shows in the redaction tool. */
export async function imageInfo(input: Buffer): Promise<{ width: number; height: number; format: string }> {
  const meta = await sharp(input).metadata();
  const width = meta.autoOrient?.width ?? meta.width;
  const height = meta.autoOrient?.height ?? meta.height;
  if (!width || !height || !meta.format) throw new Error("Not a readable image.");
  if (!["png", "jpeg", "webp"].includes(meta.format)) throw new Error("Use a PNG, JPEG or WebP image.");
  return { width, height, format: meta.format };
}

/**
 * Pixelate each box heavily: extract the region, shrink it to a few cells
 * (averaging the pixels), scale back up with nearest-neighbour, composite over
 * the base image. Boxes are re-clamped here; the client is not trusted.
 */
export async function renderRedacted(
  input: Buffer,
  boxes: RedactionBox[],
): Promise<{ data: Buffer; width: number; height: number }> {
  const { data: base, info } = await sharp(input).autoOrient().png().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;

  const clean = boxes.map((b) => clampBox(b, width, height)).filter((b): b is RedactionBox => b !== null);

  const overlays = await Promise.all(
    clean.map(async (box) => {
      const { cols, rows } = pixelGrid(box);
      const tiny = await sharp(base)
        .extract({ left: box.x, top: box.y, width: box.w, height: box.h })
        .resize(cols, rows, { fit: "fill", kernel: "cubic" })
        .png()
        .toBuffer();
      const blocks = await sharp(tiny).resize(box.w, box.h, { fit: "fill", kernel: "nearest" }).png().toBuffer();
      return { input: blocks, left: box.x, top: box.y };
    }),
  );

  const data = await sharp(base).composite(overlays).png({ compressionLevel: 9 }).toBuffer();
  return { data, width, height };
}

/** Testimonial photos: orient, square-crop to 256px, JPEG, no metadata. */
export async function renderAvatar(input: Buffer): Promise<Buffer> {
  return sharp(input).autoOrient().resize(256, 256, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
}
