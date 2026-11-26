import { describe, expect, it } from "vitest";
import { sanitizeDescription, sanitizeTitle, TITLE_MAX } from "../text";

describe("sanitizeTitle", () => {
  it("removes promo words, symbols and emoji", () => {
    expect(sanitizeTitle("HOT SALE!!! Bamboo Drawer Organizer *** 20% OFF Free Shipping")).toBe("Bamboo Drawer Organizer");
  });
  it("fixes ALL CAPS words but keeps short acronyms", () => {
    expect(sanitizeTitle("MAGNETIC KNIFE STRIP LED USB")).toBe("Magnetic Knife Strip LED USB");
  });
  it("cuts to 80 characters on a word boundary", () => {
    const t = sanitizeTitle("Ceramic Plant Pot ".repeat(10));
    expect(t.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(t.endsWith(" ")).toBe(false);
    expect(t.endsWith("Ceramic") || t.endsWith("Plant") || t.endsWith("Pot")).toBe(true);
  });
});

describe("sanitizeDescription", () => {
  it("strips links, emails, phones, contact prompts and promo phrases", () => {
    const d = sanitizeDescription(
      `<p>Great mat. HOT SALE 20% OFF COUPON! Visit https://shop.example.com or www.deal.cn</p><p>Email sales@x.com or call +1 (555) 123-4567. WhatsApp us now.</p><a href="http://x">click</a>`,
    );
    expect(d).not.toMatch(/http|www|@|555|whatsapp|coupon|hot sale|off/i);
    expect(d).toContain("Great mat.");
  });
  it("keeps only simple tags without attributes", () => {
    const d = sanitizeDescription(`<div style="x"><p class="a">One</p><script>alert(1)</script><ul><li onclick="y">Two</li></ul></div>`);
    expect(d).toBe("<p>One</p><ul><li>Two</li></ul>");
    expect(d).not.toMatch(/script|style|class|onclick/);
  });
  it("wraps plain text in paragraphs", () => {
    expect(sanitizeDescription("First para.\n\nSecond line\nwrapped")).toBe("<p>First para.</p><p>Second line<br>wrapped</p>");
  });
});
