import { describe, expect, it } from "vitest";
import { canViewLesson, courseAccessFromRows, courseAccessReason, planIncludesCourse } from "../access-rule";

describe("planIncludesCourse", () => {
  it("matches plans.ts: Professional and Mentorship include the course, Starter doesn't", () => {
    expect(planIncludesCourse("starter")).toBe(false);
    expect(planIncludesCourse("professional")).toBe(true);
    expect(planIncludesCourse("mentorship")).toBe(true);
    expect(planIncludesCourse("none")).toBe(false);
  });
});

describe("courseAccessReason", () => {
  it("grants access for an unrefunded purchase, with no plan", () => {
    expect(courseAccessReason([{ refunded_at: null }], [])).toBe("purchase");
  });

  it("ignores refunded purchases", () => {
    expect(courseAccessReason([{ refunded_at: "2026-11-01T00:00:00Z" }], [])).toBeNull();
  });

  it.each([
    ["professional", "active", true],
    ["professional", "trialing", true],
    ["mentorship", "active", true],
    ["starter", "active", false],
    ["professional", "past_due", false],
    ["professional", "canceled", false],
    ["mentorship", "incomplete", false],
  ])("plan %s with status %s -> %s", (plan, status, expected) => {
    expect(courseAccessFromRows([], [{ plan, status }])).toBe(expected);
  });

  it("any qualifying org is enough", () => {
    expect(
      courseAccessReason([], [
        { plan: "starter", status: "active" },
        { plan: "mentorship", status: "trialing" },
      ]),
    ).toBe("plan");
  });
});

describe("canViewLesson", () => {
  const published = { is_published: true, is_preview: false };
  const preview = { is_published: true, is_preview: true };
  const draft = { is_published: false, is_preview: true };

  it("entitled users see published lessons", () => {
    expect(canViewLesson(published, true)).toBe(true);
  });

  it("others see only published previews", () => {
    expect(canViewLesson(published, false)).toBe(false);
    expect(canViewLesson(preview, false)).toBe(true);
    expect(canViewLesson(draft, false)).toBe(false);
    expect(canViewLesson(draft, true)).toBe(false);
  });

  it("admins see everything", () => {
    expect(canViewLesson(draft, false, true)).toBe(true);
  });
});
