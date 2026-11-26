/**
 * Turns an admin-entered provider + reference into something safe to embed.
 * References may be bare IDs or pasted URLs; anything that doesn't match the
 * expected shape is rejected rather than passed into an iframe src.
 */

export const VIDEO_PROVIDERS = ["youtube", "vimeo", "mux", "storage"] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

export type ParsedVideo =
  | { provider: "youtube"; id: string }
  | { provider: "vimeo"; id: string; hash: string | null }
  | { provider: "mux"; playbackId: string }
  | { provider: "storage"; path: string };

export function parseVideoRef(provider: string | null, ref: string | null): ParsedVideo | null {
  const value = (ref ?? "").trim();
  if (!provider || !value) return null;
  switch (provider) {
    case "youtube": {
      if (/^[A-Za-z0-9_-]{11}$/.test(value)) return { provider, id: value };
      const m =
        value.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/) ??
        value.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
      return m ? { provider, id: m[1] } : null;
    }
    case "vimeo": {
      const bare = value.match(/^(\d{5,12})(?:[/:]([a-f0-9]{6,20}))?$/);
      if (bare) return { provider, id: bare[1], hash: bare[2] ?? null };
      const url = value.match(/vimeo\.com\/(?:video\/)?(\d{5,12})(?:\/([a-f0-9]{6,20}))?/);
      if (!url) return null;
      const h = value.match(/[?&]h=([a-f0-9]{6,20})/);
      return { provider, id: url[1], hash: url[2] ?? h?.[1] ?? null };
    }
    case "mux": {
      const id = value.replace(/^https:\/\/(?:stream|player)\.mux\.com\//, "").replace(/(\.m3u8)?(\?.*)?$/, "");
      return /^[A-Za-z0-9]{10,80}$/.test(id) ? { provider, playbackId: id } : null;
    }
    case "storage": {
      const path = value.replace(/^\/+/, "");
      return isSafeStoragePath(path) ? { provider, path } : null;
    }
    default:
      return null;
  }
}

/** Storage object paths: no traversal, no control characters, reasonable length. */
export function isSafeStoragePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 500 &&
    !path.split("/").some((part) => part === "" || part === "." || part === "..") &&
    !/[\u0000-\u001f\\]/.test(path)
  );
}

/** Iframe src for providers that embed by iframe. */
export function iframeSrc(video: ParsedVideo, muxToken?: string | null): string | null {
  switch (video.provider) {
    case "youtube":
      return `https://www.youtube-nocookie.com/embed/${video.id}?rel=0&modestbranding=1`;
    case "vimeo": {
      const params = new URLSearchParams({ dnt: "1" });
      if (video.hash) params.set("h", video.hash);
      return `https://player.vimeo.com/video/${video.id}?${params.toString()}`;
    }
    case "mux": {
      const base = `https://player.mux.com/${video.playbackId}`;
      return muxToken ? `${base}?playback-token=${encodeURIComponent(muxToken)}` : base;
    }
    default:
      return null;
  }
}

/** "12:05" / "1:02:03" for a duration in seconds. */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** Spoken form for screen readers, e.g. "12 minutes 5 seconds". */
export function spokenDuration(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [
    h ? `${h} hour${h === 1 ? "" : "s"}` : "",
    m ? `${m} minute${m === 1 ? "" : "s"}` : "",
    s && !h ? `${s} second${s === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.join(" ") || null;
}

/** Parse "12:05", "1:02:03" or plain seconds from an admin form. */
export function parseDurationInput(input: string): number | null {
  const v = input.trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);
  const m = v.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
