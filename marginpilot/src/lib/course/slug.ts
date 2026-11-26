/** Lesson slugs: lowercase ASCII words joined by hyphens, unique across the course. */

/** Static route segments under /app/course that a lesson slug must not shadow. */
export const RESERVED_SLUGS = new Set(["progress", "new", "edit"]);

const MAX_LENGTH = 80;

export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "") // "eBay's" -> "ebays"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LENGTH)
    .replace(/-+$/g, "");
  return slug || "lesson";
}

export function isValidSlug(slug: string): boolean {
  return slug.length <= MAX_LENGTH && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && !RESERVED_SLUGS.has(slug);
}

/** Append -2, -3, ... until the slug is free. `taken` holds slugs used by other lessons. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = slugify(base);
  const free = (s: string) => !used.has(s) && !RESERVED_SLUGS.has(s);
  if (free(root)) return root;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${root.slice(0, MAX_LENGTH - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (free(candidate)) return candidate;
  }
}
