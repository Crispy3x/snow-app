import "server-only";

/**
 * Optional Photoroom integration (https://docs.photoroom.com/), behind
 * PHOTOROOM_API_KEY. Server only: the key is sent in the x-api-key header and
 * is never logged or returned to the browser.
 *
 * Endpoints (checked against Photoroom's OpenAPI spec, Nov 2026):
 *  - Remove Background API: POST https://sdk.photoroom.com/v1/segment
 *      multipart: image_file, format (png|jpg|webp), bg_color, size (preview|medium|hd|full), crop
 *      200 -> image bytes; errors -> JSON { detail, status_code, type }
 *  - Image Editing API v2: POST https://image-api.photoroom.com/v2/edit
 *      multipart: imageFile, removeBackground, background.color | background.prompt (+ background.seed),
 *      padding, outputSize ("WxH"), export.format (png|jpeg|webp)
 *      200 -> image bytes; errors -> JSON { error: { message } }
 *  402 means the Photoroom account is out of API credits.
 */

export const SEGMENT_URL = "https://sdk.photoroom.com/v1/segment";
export const EDIT_URL = "https://image-api.photoroom.com/v2/edit";
const TIMEOUT_MS = 60_000;

export type PhotoroomErrorCode = "not_configured" | "bad_request" | "unauthorized" | "no_credits" | "rate_limited" | "unavailable" | "failed";

export class PhotoroomError extends Error {
  constructor(
    public code: PhotoroomErrorCode,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "PhotoroomError";
  }
}

export const PHOTOROOM_MESSAGES: Record<PhotoroomErrorCode, string> = {
  not_configured: "Connect Photoroom to enable background removal and scenes.",
  bad_request: "Photoroom couldn't process this photo. Try a clearer photo of a single product.",
  unauthorized: "Photoroom rejected the API key. Check PHOTOROOM_API_KEY.",
  no_credits: "The Photoroom account is out of API credits. Top up in the Photoroom dashboard.",
  rate_limited: "Photoroom is busy right now. Please try again in a minute.",
  unavailable: "Photoroom is temporarily unavailable. Please try again shortly.",
  failed: "Photoroom couldn't edit this photo. Please try again.",
};

export function photoroomConfigured(): boolean {
  return Boolean(process.env.PHOTOROOM_API_KEY?.trim());
}

/** Ready-made scenes. Prompts describe only the background; the product is kept as photographed. */
export const SCENES = {
  // eBay's main photo works best on pure white, so this one is a solid colour, not a generated scene.
  white_studio: { label: "White studio", color: "FFFFFF" },
  wooden_table: { label: "Wooden table", prompt: "On a light natural oak wooden table top, softly blurred bright interior in the background, natural window light" },
  outdoor: { label: "Outdoor", prompt: "Outdoors on a flat stone surface, softly blurred green garden in the background, bright daylight" },
  flat_lay: { label: "Flat lay", prompt: "Top-down flat lay on a smooth neutral beige surface, minimal styling, soft diffused light" },
} as const satisfies Record<string, { label: string; prompt?: string; color?: string }>;
export type SceneKey = keyof typeof SCENES;
export const SCENE_KEYS = Object.keys(SCENES) as SceneKey[];

function apiKey(): string {
  const key = process.env.PHOTOROOM_API_KEY?.trim();
  if (!key) throw new PhotoroomError("not_configured", PHOTOROOM_MESSAGES.not_configured);
  return key;
}

function codeForStatus(status: number): PhotoroomErrorCode {
  if (status === 400 || status === 413 || status === 415 || status === 422) return "bad_request";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 402) return "no_credits";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "failed";
}

/** Pull Photoroom's own error text out of either error shape, for logs/diagnostics (never contains the key). */
async function errorDetail(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { detail?: unknown; error?: { message?: unknown } };
    const msg = body?.error?.message ?? body?.detail;
    return typeof msg === "string" ? msg.slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
}

async function post(url: string, form: FormData): Promise<Buffer> {
  const key = apiKey();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "x-api-key": key, Accept: "image/png, image/jpeg, image/webp" },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new PhotoroomError("unavailable", PHOTOROOM_MESSAGES.unavailable);
  }
  if (!res.ok) {
    const code = codeForStatus(res.status);
    const detail = await errorDetail(res);
    // Bad-request details from Photoroom are useful to the seller ("No subject found"), others aren't.
    const message = code === "bad_request" && detail ? `${PHOTOROOM_MESSAGES.bad_request} (${detail})` : PHOTOROOM_MESSAGES[code];
    throw new PhotoroomError(code, message, res.status);
  }
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    // /v1/segment can answer with { base64img } when asked for JSON.
    const body = (await res.json().catch(() => null)) as { base64img?: string } | null;
    if (body?.base64img) return Buffer.from(body.base64img, "base64");
    throw new PhotoroomError("failed", PHOTOROOM_MESSAGES.failed, res.status);
  }
  const data = Buffer.from(await res.arrayBuffer());
  if (!data.length) throw new PhotoroomError("failed", PHOTOROOM_MESSAGES.failed, res.status);
  return data;
}

function fileField(image: Buffer, name = "photo.jpg", type = "image/jpeg"): Blob {
  return new File([new Uint8Array(image)], name, { type });
}

/** Remove the background and put the product on plain white (Remove Background API). Returns a JPEG. */
export async function removeBackground(image: Buffer, opts: { bgColor?: string } = {}): Promise<Buffer> {
  const form = new FormData();
  form.append("image_file", fileField(image));
  form.append("format", "jpg");
  form.append("bg_color", opts.bgColor ?? "#FFFFFF");
  form.append("size", "hd");
  form.append("crop", "true");
  return post(SEGMENT_URL, form);
}

/**
 * Cut the product out and place it on a new background (Image Editing API v2):
 * an AI-generated scene (background.prompt) or a solid colour (background.color).
 * Square output sized for eBay. Returns a JPEG.
 */
export async function editBackground(image: Buffer, opts: { prompt?: string; color?: string; size?: number; seed?: number }): Promise<Buffer> {
  const prompt = opts.prompt?.trim().slice(0, 500);
  const color = opts.color?.replace(/^#/, "").trim();
  if (!prompt && !color) throw new PhotoroomError("bad_request", "Describe the background you want.");
  if (color && !/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)) throw new PhotoroomError("bad_request", "Use a hex colour like FFFFFF.");
  const size = Math.min(2000, Math.max(500, Math.round(opts.size ?? 1600)));
  const form = new FormData();
  form.append("imageFile", fileField(image));
  form.append("removeBackground", "true");
  if (prompt) {
    form.append("background.prompt", prompt);
    if (opts.seed !== undefined) form.append("background.seed", String(Math.trunc(Math.abs(opts.seed))));
  } else {
    form.append("background.color", color!.toUpperCase());
  }
  form.append("padding", "0.12");
  form.append("outputSize", `${size}x${size}`);
  form.append("export.format", "jpeg");
  return post(EDIT_URL, form);
}

/** Scene shortcut for the presets above. */
export function sceneBackground(image: Buffer, scene: SceneKey, size?: number): Promise<Buffer> {
  const s: { prompt?: string; color?: string } = SCENES[scene];
  return editBackground(image, { prompt: s.prompt, color: s.color, size });
}
