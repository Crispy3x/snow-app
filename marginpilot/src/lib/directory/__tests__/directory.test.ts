import { describe, expect, it } from "vitest";
import { PLANS } from "@/config/plans";
import { cheapestPlanWith, planHasDirectory, planHasMentorship } from "../entitlement";
import { categoriesOf, filterDirectory, hasActiveFilters, parseDirectoryFilters, sortDirectory } from "../filter";
import { handlingTimeHint } from "../handling";
import { directoryInputFromForm, directorySupplierSchema, normalizeUrl, parseCategories, RETAIL_MESSAGE } from "../validation";
import { contactHref, type DirectoryListRow } from "../types";

function form(overrides: Record<string, string> = {}) {
  const base: Record<string, string> = {
    name: "Example Wholesale Co",
    website: "example-wholesale.test",
    categories: "Home, Kitchen",
    description: "",
    contact_method: "email",
    contact_value: "sales@example-wholesale.test",
    ships_from: "US",
    typical_handling_days: "2",
    typical_delivery_days: "5",
    min_order: "",
    notes: "",
    verified_on: "",
    status: "draft",
    accepts_dropship: "on",
    ...overrides,
  };
  return directoryInputFromForm((k) => base[k]);
}

describe("directory validation", () => {
  it("accepts a valid wholesale supplier and normalises fields", () => {
    const r = directorySupplierSchema.safeParse(form());
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.website).toBe("https://example-wholesale.test");
    expect(r.data.categories).toEqual(["Home", "Kitchen"]);
    expect(r.data.typical_handling_days).toBe(2);
    expect(r.data.accepts_dropship).toBe(true);
    expect(r.data.us_warehouse).toBe(false);
    expect(r.data.description).toBeNull();
    expect(r.data.verified_on).toBeNull();
  });

  it.each(["https://www.amazon.com/shop/x", "walmart.com", "https://www.aliexpress.us/item/1", "https://temu.com", "https://www.ebay.co.uk/str/x"])(
    "rejects retail marketplace website %s",
    (website) => {
      const r = directorySupplierSchema.safeParse(form({ website }));
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.error.issues.find((i) => i.path[0] === "website")?.message).toBe(RETAIL_MESSAGE);
    },
  );

  it("rejects a retail marketplace as the wholesale portal contact", () => {
    const r = directorySupplierSchema.safeParse(form({ contact_method: "portal", contact_value: "https://www.amazon.com/business" }));
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0].path[0]).toBe("contact_value");
  });

  it("validates the contact value per method", () => {
    expect(directorySupplierSchema.safeParse(form({ contact_value: "not-an-email" })).success).toBe(false);
    expect(directorySupplierSchema.safeParse(form({ contact_method: "phone", contact_value: "+1 555 010 0000" })).success).toBe(true);
    expect(directorySupplierSchema.safeParse(form({ contact_method: "phone", contact_value: "call us" })).success).toBe(false);
    expect(directorySupplierSchema.safeParse(form({ contact_method: "telegram", contact_value: "@wholesaler" })).success).toBe(true);
    const portal = directorySupplierSchema.safeParse(form({ contact_method: "portal", contact_value: "portal.example-wholesale.test/apply" }));
    expect(portal.success && portal.data.contact_value).toBe("https://portal.example-wholesale.test/apply");
  });

  it("requires a name and contact details, and bounds the day fields", () => {
    const r = directorySupplierSchema.safeParse(form({ name: "", contact_value: "", typical_handling_days: "-1", typical_delivery_days: "2.5" }));
    expect(r.success).toBe(false);
    if (r.success) return;
    const paths = r.error.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["name", "contact_value", "typical_handling_days", "typical_delivery_days"]));
  });

  it("requires a verified-on date to publish", () => {
    expect(directorySupplierSchema.safeParse(form({ status: "published" })).success).toBe(false);
    expect(directorySupplierSchema.safeParse(form({ status: "published", verified_on: "2026-11-20" })).success).toBe(true);
    expect(directorySupplierSchema.safeParse(form({ verified_on: "20/11/2026" })).success).toBe(false);
  });

  it("allows an empty website but rejects garbage", () => {
    const empty = directorySupplierSchema.safeParse(form({ website: "" }));
    expect(empty.success && empty.data.website).toBeNull();
    expect(directorySupplierSchema.safeParse(form({ website: "not a url" })).success).toBe(false);
  });

  it("parses categories and URLs", () => {
    expect(parseCategories(" Home ,home, Pet  supplies,\nToys,")).toEqual(["Home", "Pet supplies", "Toys"]);
    expect(normalizeUrl("  ")).toBeNull();
    expect(normalizeUrl("http://a.test")).toBe("http://a.test");
  });

  it("builds contact links", () => {
    expect(contactHref("email", "a@b.test")).toBe("mailto:a@b.test");
    expect(contactHref("whatsapp", "+1 (555) 010-0000")).toBe("https://wa.me/15550100000");
    expect(contactHref("telegram", "@seller_x")).toBe("https://t.me/seller_x");
    expect(contactHref("portal", "ftp://x")).toBeNull();
  });
});

const row = (o: Partial<DirectoryListRow> & { id: string; name: string }): DirectoryListRow => ({
  website: null,
  categories: [],
  description: null,
  ships_from: null,
  us_warehouse: false,
  typical_handling_days: null,
  typical_delivery_days: null,
  min_order: null,
  accepts_dropship: false,
  blind_shipping: false,
  provides_tracking: false,
  csv_feed_available: false,
  verified_on: null,
  sort_order: 0,
  ...o,
});

describe("directory filtering", () => {
  const rows = [
    row({ id: "a", name: "Alpha Home Supply", categories: ["Home", "Kitchen"], us_warehouse: true, accepts_dropship: true, typical_handling_days: 1, sort_order: 2 }),
    row({ id: "b", name: "Bravo Pets", categories: ["Pet supplies"], ships_from: "Canada", accepts_dropship: true, typical_handling_days: 3, sort_order: 1 }),
    row({ id: "c", name: "Charlie Tools", categories: ["home"], us_warehouse: true, typical_handling_days: null, sort_order: 1 }),
  ];
  const ids = (r: DirectoryListRow[]) => r.map((x) => x.id);

  it("parses filters from the URL, ignoring bad values", () => {
    const f = parseDirectoryFilters({ q: "  pets ", category: "Home", us: "1", dropship: "0", maxHandling: "abc", fav: ["1", "0"] });
    expect(f).toEqual({ q: "pets", category: "Home", usWarehouse: true, dropship: false, maxHandling: null, favorites: true });
    expect(parseDirectoryFilters({ maxHandling: "2" }).maxHandling).toBe(2);
    expect(parseDirectoryFilters({ maxHandling: "-2" }).maxHandling).toBeNull();
    expect(hasActiveFilters(parseDirectoryFilters({}))).toBe(false);
  });

  it("filters by category case-insensitively", () => {
    expect(ids(filterDirectory(rows, parseDirectoryFilters({ category: "HOME" })))).toEqual(["a", "c"]);
  });

  it("filters by US warehouse and drop shipping", () => {
    expect(ids(filterDirectory(rows, parseDirectoryFilters({ us: "1" })))).toEqual(["a", "c"]);
    expect(ids(filterDirectory(rows, parseDirectoryFilters({ us: "1", dropship: "1" })))).toEqual(["a"]);
  });

  it("filters by max handling days, excluding unknown handling", () => {
    expect(ids(filterDirectory(rows, parseDirectoryFilters({ maxHandling: "3" })))).toEqual(["a", "b"]);
    expect(ids(filterDirectory(rows, parseDirectoryFilters({ maxHandling: "1" })))).toEqual(["a"]);
  });

  it("searches name, region and categories with every term", () => {
    expect(ids(filterDirectory(rows, parseDirectoryFilters({ q: "canada pet" })))).toEqual(["b"]);
    expect(ids(filterDirectory(rows, parseDirectoryFilters({ q: "zzz" })))).toEqual([]);
  });

  it("filters to favourites", () => {
    expect(ids(filterDirectory(rows, parseDirectoryFilters({ fav: "1" }), new Set(["c"])))).toEqual(["c"]);
  });

  it("lists categories and sorts by admin order then name", () => {
    expect(categoriesOf(rows)).toEqual(["Home", "Kitchen", "Pet supplies"]);
    expect(ids(sortDirectory(rows))).toEqual(["b", "c", "a"]);
  });
});

describe("handling-time hint", () => {
  it("warns when the supplier is slower than the store's handling time", () => {
    const h = handlingTimeHint(4, 2);
    expect(h.level).toBe("warn");
    if (h.level === "warn") expect(h.shortBy).toBe(2);
    expect(h.message).toContain("at least 4 business days");
  });
  it("is fine when equal or faster", () => {
    expect(handlingTimeHint(2, 2).level).toBe("ok");
    expect(handlingTimeHint(0, 1).level).toBe("ok");
  });
  it("is unknown without supplier data or a store rule", () => {
    expect(handlingTimeHint(null, 2).level).toBe("unknown");
    expect(handlingTimeHint(3, null).level).toBe("unknown");
    expect(handlingTimeHint(1, null).message).toContain("1 business day.");
  });
});

describe("entitlements follow plans.ts", () => {
  it("maps the directory and mentorship flags", () => {
    for (const p of PLANS) {
      expect(planHasDirectory(p.key)).toBe(p.limits.supplierDirectory);
      expect(planHasMentorship(p.key)).toBe(p.limits.mentorship);
    }
    expect(planHasDirectory("starter")).toBe(false);
    expect(planHasDirectory("professional")).toBe(true);
    expect(planHasDirectory("mentorship")).toBe(true);
    expect(planHasMentorship("professional")).toBe(false);
    expect(planHasMentorship("mentorship")).toBe(true);
    expect(planHasDirectory("none")).toBe(false);
    expect(planHasMentorship(null)).toBe(false);
  });
  it("matches the plan keys hard-coded in the SQL helpers", () => {
    expect(PLANS.filter((p) => p.limits.supplierDirectory).map((p) => p.key)).toEqual(["professional", "mentorship"]);
    expect(PLANS.filter((p) => p.limits.mentorship).map((p) => p.key)).toEqual(["mentorship"]);
    expect(cheapestPlanWith("supplierDirectory")?.key).toBe("professional");
    expect(cheapestPlanWith("mentorship")?.key).toBe("mentorship");
  });
});
