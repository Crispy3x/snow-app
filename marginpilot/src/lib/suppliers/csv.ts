import { SupplierError, type SupplierAdapter, type SupplierProduct } from "./types";

/**
 * CSV / feed supplier: products come from a wholesaler's price list the seller uploads.
 * Columns (header row, case-insensitive): sku, title, cost, stock, and optionally
 * description, brand, shipping_cost, image_urls (| separated), url, category,
 * plus any other column, which becomes an item specific.
 * Rows are stored in supplier_products by the lister; the monitor re-reads the
 * latest uploaded feed, so checkProducts reads from config.rows.
 */

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const KNOWN = new Set(["sku", "title", "cost", "stock", "description", "brand", "shipping_cost", "image_urls", "url", "category"]);

export function rowToProduct(r: Record<string, string>): SupplierProduct {
  const cost = Number(r.cost);
  if (!r.sku || !r.title || !r.cost?.trim() || !Number.isFinite(cost) || cost < 0) {
    throw new SupplierError(`Row is missing sku, title or a numeric cost`, "unsupported");
  }
  const attributes: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) if (!KNOWN.has(k) && v) attributes[k.replace(/(^|_)(\w)/g, (_, s, c) => (s ? " " : "") + c.toUpperCase())] = v;
  return {
    externalId: r.sku,
    sourceUrl: r.url || null,
    title: r.title,
    description: r.description ?? "",
    brand: r.brand || null,
    cost,
    shippingCost: Number(r.shipping_cost) || 0,
    stock: Number.parseInt(r.stock, 10) || 0,
    images: (r.image_urls ?? "").split("|").map((s) => s.trim()).filter(Boolean),
    attributes,
    category: r.category || null,
  };
}

export const csvSupplier: SupplierAdapter = {
  key: "csv_feed",
  name: "Wholesale price list (CSV)",
  canHandle: (ref) => ref.startsWith("csv:"),
  async fetchProduct(ref, config) {
    const sku = ref.replace(/^csv:/, "");
    const rows = (config?.rows as Record<string, string>[] | undefined) ?? [];
    const row = rows.find((r) => r.sku === sku);
    if (!row) throw new SupplierError(`SKU ${sku} not in the latest price list`, "not_found");
    return rowToProduct(row);
  },
  async checkProducts(ids, config) {
    const rows = (config?.rows as Record<string, string>[] | undefined) ?? [];
    const bySku = new Map(rows.map((r) => [r.sku, r]));
    return ids.map((id) => {
      const r = bySku.get(id);
      if (!r) return { externalId: id, cost: 0, shippingCost: 0, stock: 0, available: false };
      const p = rowToProduct(r);
      return { externalId: id, cost: p.cost, shippingCost: p.shippingCost, stock: p.stock, available: p.stock > 0 };
    });
  },
  orderUrl: (_id, url) => url,
};
