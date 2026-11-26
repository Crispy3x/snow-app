/**
 * Browser-side downscale before upload, so a phone photo fits under the 1 MB
 * server action body limit: longest side <= 1600px, JPEG, quality stepped down
 * until it fits. EXIF orientation is applied by createImageBitmap.
 */

export const UPLOAD_MAX_SIDE = 1600;
export const UPLOAD_MAX_BYTES = 900 * 1024;

export class DownscaleError extends Error {}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

export async function downscalePhoto(file: File, maxSide = UPLOAD_MAX_SIDE, maxBytes = UPLOAD_MAX_BYTES): Promise<File> {
  if (!file.type.startsWith("image/")) throw new DownscaleError("Choose an image file (JPEG, PNG or WebP).");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new DownscaleError("Your browser couldn't open that photo. Try a JPEG or PNG (HEIC photos may need converting first).");
  }
  let scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext("2d");
      if (!g) throw new DownscaleError("Your browser couldn't process that photo.");
      g.fillStyle = "#ffffff"; // transparent PNGs become white, not black
      g.fillRect(0, 0, w, h);
      g.drawImage(bitmap, 0, 0, w, h);
      for (const q of [0.88, 0.8, 0.7]) {
        const blob = await toBlob(canvas, q);
        if (blob && blob.size <= maxBytes) return new File([blob], "photo.jpg", { type: "image/jpeg" });
      }
      scale *= 0.8;
    }
  } finally {
    bitmap.close();
  }
  throw new DownscaleError("That photo is too detailed to upload. Try a smaller one.");
}
