import { describe, expect, it } from "vitest";
import { isValidSlug, slugify, uniqueSlug } from "../slug";
import { uploadPath } from "../paths";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Pricing and Margin Math")).toBe("pricing-and-margin-math");
  });

  it("drops apostrophes, accents and punctuation", () => {
    expect(slugify("Suppliers & eBay's sourcing rules!")).toBe("suppliers-and-ebays-sourcing-rules");
    expect(slugify("Café résumé")).toBe("cafe-resume");
    expect(slugify("  --Hello,   world--  ")).toBe("hello-world");
  });

  it("falls back when nothing is left", () => {
    expect(slugify("!!!")).toBe("lesson");
  });

  it("caps length without a trailing hyphen", () => {
    const s = slugify("word ".repeat(40));
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("uniqueSlug", () => {
  it("keeps a free slug", () => {
    expect(uniqueSlug("Intro", [])).toBe("intro");
  });

  it("adds a numeric suffix when taken", () => {
    expect(uniqueSlug("Intro", ["intro"])).toBe("intro-2");
    expect(uniqueSlug("Intro", ["intro", "intro-2", "intro-3"])).toBe("intro-4");
  });

  it("avoids reserved route segments", () => {
    expect(uniqueSlug("Progress", [])).toBe("progress-2");
  });
});

describe("isValidSlug", () => {
  it("accepts clean slugs and rejects others", () => {
    expect(isValidSlug("setting-up-payments")).toBe(true);
    expect(isValidSlug("Setting-Up")).toBe(false);
    expect(isValidSlug("double--hyphen")).toBe(false);
    expect(isValidSlug("-leading")).toBe(false);
    expect(isValidSlug("progress")).toBe(false);
  });
});

describe("uploadPath", () => {
  it("builds <lessonId>/<folder>/<time>-<safe name>", () => {
    expect(uploadPath("L1", "resources", "Margin calculator (v2).xlsx", 123)).toBe("L1/resources/123-Margin-calculator-v2.xlsx");
    expect(uploadPath("L1", "captions", "../../etc/passwd", 5)).toBe("L1/captions/5-passwd");
  });
});
