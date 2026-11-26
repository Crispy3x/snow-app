/** Storage object paths for course uploads (pure). */

export const UPLOAD_FOLDERS = ["resources", "video", "captions"] as const;
export type UploadFolder = (typeof UPLOAD_FOLDERS)[number];

/** Object path for a new upload: <lessonId>/<folder>/<timestamp>-<safe file name>. */
export function uploadPath(lessonId: string, folder: UploadFolder, fileName: string, now = Date.now()): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) : "";
  const stem = (dot > 0 ? base.slice(0, dot) : base)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "file";
  return `${lessonId}/${folder}/${now}-${stem}${ext ? `.${ext}` : ""}`;
}
