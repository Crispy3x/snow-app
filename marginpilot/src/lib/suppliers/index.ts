import { csvSupplier } from "./csv";
import { mockSupplier } from "./mock";
import { SupplierError, isBlockedRetailUrl, type SupplierAdapter } from "./types";

export * from "./types";

/** Register new wholesale adapters here. */
export const ADAPTERS: SupplierAdapter[] = [mockSupplier, csvSupplier];

export function getAdapter(key: string): SupplierAdapter {
  const a = ADAPTERS.find((a) => a.key === key);
  if (!a) throw new SupplierError(`Unknown supplier adapter: ${key}`, "unsupported");
  return a;
}

/** Picks the adapter for a pasted link, rejecting retail marketplaces first. */
export function resolveAdapter(ref: string): SupplierAdapter {
  if (isBlockedRetailUrl(ref)) {
    throw new SupplierError(
      "That link is a retail store or marketplace. eBay only allows drop shipping from wholesale suppliers, so it can't be listed.",
      "blocked_retail",
    );
  }
  const a = ADAPTERS.find((a) => a.canHandle(ref));
  if (!a) throw new SupplierError("No connected wholesale supplier recognises that link.", "unsupported");
  return a;
}
