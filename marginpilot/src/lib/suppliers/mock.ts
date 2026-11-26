import { SupplierError, type StockCheck, type SupplierAdapter, type SupplierProduct } from "./types";

/**
 * Mock wholesale supplier for testing everything end to end without a real supplier.
 * Accepts links like https://mock-supplier.test/p/<id> or mock:<id>.
 * Products are generated deterministically from the id; cost and stock drift a
 * little each day so the price and stock monitor has something to react to.
 * Ids starting with "oos-" are out of stock; "gone-" returns not found.
 */

const ADJECTIVES = ["Stainless", "Bamboo", "Silicone", "Magnetic", "Ceramic", "Cotton", "Aluminum", "Glass", "Leather", "Oak"];
const NOUNS = ["Garlic Press", "Drawer Organizer", "Baking Mat Set", "Knife Strip", "Spice Rack", "Cable Organizer", "Plant Pot", "Desk Lamp", "Phone Stand", "Storage Bin"];
const COLORS = ["Black", "White", "Natural", "Gray", "Blue", "Green"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function parseId(ref: string): string | null {
  const m = ref.match(/^mock:([\w-]+)$/) ?? ref.match(/^https?:\/\/mock-supplier\.test\/p\/([\w-]+)/);
  return m ? m[1] : null;
}

function dayDrift(id: string, now: Date): number {
  const day = Math.floor(now.getTime() / 86_400_000);
  return ((hash(`${id}:${day}`) % 21) - 10) / 100; // -10% .. +10%
}

export function mockProduct(id: string, now = new Date()): SupplierProduct {
  const h = hash(id);
  const adjective = ADJECTIVES[h % ADJECTIVES.length];
  const noun = NOUNS[(h >> 4) % NOUNS.length];
  const color = COLORS[(h >> 8) % COLORS.length];
  const baseCost = 3 + (h % 4000) / 100; // $3 .. $43
  const cost = Math.round(baseCost * (1 + dayDrift(id, now)) * 100) / 100;
  const stock = id.startsWith("oos-") ? 0 : (h >> 12) % 250;
  return {
    externalId: id,
    sourceUrl: `https://mock-supplier.test/p/${id}`,
    title: `${adjective} ${noun} - ${color}`,
    description: `Wholesale ${adjective.toLowerCase()} ${noun.toLowerCase()} in ${color.toLowerCase()}. Durable, easy to clean. Ships in plain packaging within 2 business days. HOT SALE 20% OFF COUPON!`,
    brand: null,
    cost,
    shippingCost: Math.round(((h >> 16) % 600) / 100 * 100) / 100,
    stock,
    images: [`https://picsum.photos/seed/${encodeURIComponent(id)}/800/800`],
    attributes: { Color: color, Material: adjective, Type: noun },
    category: "Home & Garden",
  };
}

export const mockSupplier: SupplierAdapter = {
  key: "mock",
  name: "Mock wholesale supplier",
  canHandle: (ref) => parseId(ref.trim()) !== null,
  async fetchProduct(ref) {
    const id = parseId(ref.trim());
    if (!id) throw new SupplierError("Not a mock supplier link", "unsupported");
    if (id.startsWith("gone-")) throw new SupplierError("Product not found at supplier", "not_found");
    return mockProduct(id);
  },
  async checkProducts(ids): Promise<StockCheck[]> {
    return ids.map((id) => {
      if (id.startsWith("gone-")) return { externalId: id, cost: 0, shippingCost: 0, stock: 0, available: false };
      const p = mockProduct(id);
      return { externalId: id, cost: p.cost, shippingCost: p.shippingCost, stock: p.stock, available: p.stock > 0 };
    });
  },
  orderUrl: (id) => `https://mock-supplier.test/p/${id}?order=1`,
};
