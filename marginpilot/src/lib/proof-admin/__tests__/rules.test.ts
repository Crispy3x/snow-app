import { describe, expect, it } from "vitest";
import {
  canApproveScreenshot,
  canApproveTestimonial,
  customerTestimonialSchema,
  fieldErrors,
  isIsoDate,
  isSafeObjectPath,
  moveId,
  screenshotMetaSchema,
  sortOrderUpdates,
  testimonialSchema,
} from "../rules";

const TODAY = "2026-11-26";

const shot = {
  caption: "Monthly sales, November",
  store_label: "Home goods store",
  range_start: "2026-10-01",
  range_end: "2026-10-31",
  captured_on: "2026-11-02",
  image_width: 1200,
  image_height: 800,
};

describe("isIsoDate", () => {
  it("accepts real dates only", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("26-2-1")).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });
});

describe("screenshot metadata", () => {
  it("accepts a complete caption, store label, date range and capture date", () => {
    expect(screenshotMetaSchema(TODAY).safeParse(shot).success).toBe(true);
  });

  it("requires every field", () => {
    const r = screenshotMetaSchema(TODAY).safeParse({ ...shot, caption: "", store_label: " ", captured_on: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(Object.keys(fieldErrors(r.error)).sort()).toEqual(["caption", "captured_on", "store_label"]);
  });

  it("rejects an end date before the start date", () => {
    const r = screenshotMetaSchema(TODAY).safeParse({ ...shot, range_end: "2026-09-01", captured_on: "2026-11-01" });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrors(r.error).range_end).toMatch(/on or after/);
  });

  it("rejects a capture date before the period ends, or in the future", () => {
    const early = screenshotMetaSchema(TODAY).safeParse({ ...shot, captured_on: "2026-10-15" });
    expect(early.success).toBe(false);
    const future = screenshotMetaSchema(TODAY).safeParse({ ...shot, captured_on: "2026-12-25" });
    expect(future.success).toBe(false);
    // one day of slack for time zones ahead of UTC
    expect(screenshotMetaSchema(TODAY).safeParse({ ...shot, captured_on: "2026-11-27" }).success).toBe(true);
  });
});

describe("canApproveScreenshot", () => {
  it("requires the buyer-PII check", () => {
    const r = canApproveScreenshot(shot, { piiChecked: false, today: TODAY });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/buyer names/);
  });

  it("requires caption, dates and image size", () => {
    expect(canApproveScreenshot({ ...shot, caption: "" }, { piiChecked: true, today: TODAY }).ok).toBe(false);
    expect(canApproveScreenshot({ ...shot, range_start: null }, { piiChecked: true, today: TODAY }).ok).toBe(false);
    expect(canApproveScreenshot({ ...shot, image_width: null }, { piiChecked: true, today: TODAY }).ok).toBe(false);
  });

  it("passes when everything is present", () => {
    expect(canApproveScreenshot(shot, { piiChecked: true, today: TODAY })).toEqual({ ok: true });
  });
});

describe("testimonials", () => {
  const t = { name: "Sam", quote: "It saves me hours every week.", store_type: "Auto parts", given_on: "2026-11-20" };

  it("cannot be approved without permission", () => {
    const r = canApproveTestimonial({ ...t, permission_given: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/permission/);
  });

  it("cannot be approved with missing fields", () => {
    expect(canApproveTestimonial({ ...t, quote: " ", permission_given: true }).ok).toBe(false);
    expect(canApproveTestimonial({ ...t, given_on: "nope", permission_given: true }).ok).toBe(false);
  });

  it("can be approved with permission and all fields", () => {
    expect(canApproveTestimonial({ ...t, permission_given: true })).toEqual({ ok: true });
  });

  it("customer submissions require the permission box", () => {
    const no = customerTestimonialSchema(TODAY).safeParse({ ...t, permission_given: false });
    expect(no.success).toBe(false);
    if (!no.success) expect(fieldErrors(no.error).permission_given).toBeTruthy();
    expect(customerTestimonialSchema(TODAY).safeParse({ ...t, permission_given: true }).success).toBe(true);
  });

  it("admin drafts may be saved without permission (but not approved)", () => {
    expect(testimonialSchema(TODAY).safeParse({ ...t, permission_given: false }).success).toBe(true);
  });

  it("rejects future dates and too-short quotes", () => {
    expect(testimonialSchema(TODAY).safeParse({ ...t, permission_given: true, given_on: "2027-01-10" }).success).toBe(false);
    expect(testimonialSchema(TODAY).safeParse({ ...t, permission_given: true, quote: "Good" }).success).toBe(false);
  });
});

describe("reordering", () => {
  const ids = ["a", "b", "c", "d"];
  it("moves up, down, to top and bottom", () => {
    expect(moveId(ids, "c", "up")).toEqual(["a", "c", "b", "d"]);
    expect(moveId(ids, "b", "down")).toEqual(["a", "c", "b", "d"]);
    expect(moveId(ids, "d", "top")).toEqual(["d", "a", "b", "c"]);
    expect(moveId(ids, "a", "bottom")).toEqual(["b", "c", "d", "a"]);
  });

  it("is a no-op at the edges or for unknown ids", () => {
    expect(moveId(ids, "a", "up")).toEqual(ids);
    expect(moveId(ids, "d", "down")).toEqual(ids);
    expect(moveId(ids, "zz", "up")).toEqual(ids);
  });

  it("writes only the sort_order values that change", () => {
    const rows = [
      { id: "a", sort_order: 10 },
      { id: "b", sort_order: 20 },
      { id: "c", sort_order: 30 },
    ];
    expect(sortOrderUpdates(rows, ["a", "c", "b"])).toEqual([
      { id: "c", sort_order: 20 },
      { id: "b", sort_order: 30 },
    ]);
    // all zero (new rows) get spread out
    expect(sortOrderUpdates([{ id: "x", sort_order: 0 }, { id: "y", sort_order: 0 }], ["x", "y"])).toHaveLength(2);
  });
});

describe("isSafeObjectPath", () => {
  it("only accepts generated paths under the prefix", () => {
    expect(isSafeObjectPath("originals/2026/abc.png", "originals/")).toBe(true);
    expect(isSafeObjectPath("originals/../secret.png", "originals/")).toBe(false);
    expect(isSafeObjectPath("other/abc.png", "originals/")).toBe(false);
    expect(isSafeObjectPath("originals/a b.png", "originals/")).toBe(false);
  });
});
