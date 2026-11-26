import { resolveAdapter, SupplierError } from "@/lib/suppliers";
import { parseCsv, rowToProduct } from "@/lib/suppliers/csv";

/**
 * Parsing and validating bulk-add input. Pure, unit tested.
 * Links: one per line; retail marketplace links are rejected with resolveAdapter's
 * message; links must belong to the chosen supplier's adapter.
 * CSV: same columns as a wholesale price list (sku, title, cost, stock, ...).
 */

export const MAX_BULK_ITEMS = 500;

export type BulkItemInput = { kind: "link"; ref: string } | { kind: "csv"; row: Record<string, string> };

export type LineError = { line: number; input: string; message: string };

export type ParsedBulk = { items: BulkItemInput[]; errors: LineError[] };

export function parseLinks(text: string, supplierAdapter: string): ParsedBulk {
  const items: BulkItemInput[] = [];
  const errors: LineError[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const ref = raw.trim();
    if (!ref) return;
    const line = i + 1;
    try {
      const a = resolveAdapter(ref);
      if (a.key !== supplierAdapter) {
        errors.push({ line, input: ref, message: `This link is for "${a.name}", not the supplier you chose.` });
        return;
      }
    } catch (e) {
      errors.push({ line, input: ref, message: e instanceof SupplierError ? e.message : "Not a supported link." });
      return;
    }
    if (seen.has(ref)) {
      errors.push({ line, input: ref, message: "Duplicate of an earlier line." });
      return;
    }
    seen.add(ref);
    items.push({ kind: "link", ref });
  });
  if (items.length + errors.length === 0) errors.push({ line: 0, input: "", message: "Paste at least one link." });
  if (items.length > MAX_BULK_ITEMS) errors.push({ line: 0, input: "", message: `Up to ${MAX_BULK_ITEMS} items per batch.` });
  return { items, errors };
}

export function parseCsvItems(text: string): ParsedBulk {
  const items: BulkItemInput[] = [];
  const errors: LineError[] = [];
  const rows = parseCsv(text);
  if (rows.length === 0) return { items, errors: [{ line: 0, input: "", message: "The CSV needs a header row and at least one product row." }] };
  const header = Object.keys(rows[0]);
  for (const col of ["sku", "title", "cost"]) {
    if (!header.includes(col)) errors.push({ line: 1, input: header.join(","), message: `Missing the "${col}" column.` });
  }
  if (errors.length) return { items, errors };
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const line = i + 2; // header is line 1
    try {
      rowToProduct(row);
    } catch (e) {
      errors.push({ line, input: row.sku || row.title || "", message: e instanceof Error ? e.message : "Invalid row" });
      return;
    }
    if (seen.has(row.sku)) {
      errors.push({ line, input: row.sku, message: "Duplicate SKU." });
      return;
    }
    seen.add(row.sku);
    items.push({ kind: "csv", row });
  });
  if (items.length > MAX_BULK_ITEMS) errors.push({ line: 0, input: "", message: `Up to ${MAX_BULK_ITEMS} items per batch.` });
  return { items, errors };
}

/** Validate a price-list upload for a csv_feed supplier. Returns the rows to store. */
export function parsePriceList(text: string, maxRows = 5000): { rows: Record<string, string>[]; errors: LineError[] } {
  const parsed = parseCsvItems(text);
  const rows = parsed.items.flatMap((i) => (i.kind === "csv" ? [i.row] : []));
  const errors = parsed.errors.filter((e) => !e.message.startsWith("Up to"));
  if (rows.length > maxRows) errors.push({ line: 0, input: "", message: `Price lists can have up to ${maxRows.toLocaleString()} rows.` });
  return { rows, errors };
}

export function formatLineErrors(errors: LineError[], max = 20): string {
  const lines = errors.slice(0, max).map((e) => (e.line ? `Line ${e.line}${e.input ? ` (${e.input.slice(0, 60)})` : ""}: ${e.message}` : e.message));
  if (errors.length > max) lines.push(`…and ${errors.length - max} more.`);
  return lines.join("\n");
}
