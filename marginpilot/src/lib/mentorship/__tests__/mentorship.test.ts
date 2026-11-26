import { describe, expect, it } from "vitest";
import { auditRequestWindow, isoWeek, isoWeekStart, weekLabel } from "../iso-week";
import { groupSessions, isLive, type SessionLike } from "../sessions";
import { countLowMargin, sumMetrics } from "../snapshot-calc";
import { auditRequestSchema, feedbackSchema, isoToLocalDateTime, localDateTimeToIso, resourceLinkSchema, sessionSchema } from "../validation";

describe("ISO weeks", () => {
  it("returns the Monday of the week (UTC)", () => {
    expect(isoWeekStart(new Date("2026-11-26T12:00:00Z"))).toBe("2026-11-23"); // Thursday
    expect(isoWeekStart(new Date("2026-11-23T00:00:00Z"))).toBe("2026-11-23"); // Monday
    expect(isoWeekStart(new Date("2026-11-29T23:59:59Z"))).toBe("2026-11-23"); // Sunday
    expect(isoWeekStart(new Date("2026-11-30T00:00:00Z"))).toBe("2026-11-30");
    expect(isoWeekStart(new Date("2027-01-01T10:00:00Z"))).toBe("2026-12-28"); // across the year
  });

  it("numbers weeks per ISO-8601", () => {
    expect(isoWeek(new Date("2026-11-26T00:00:00Z"))).toEqual({ year: 2026, week: 48 });
    expect(isoWeek(new Date("2027-01-01T00:00:00Z"))).toEqual({ year: 2026, week: 53 });
    expect(isoWeek(new Date("2021-01-03T00:00:00Z"))).toEqual({ year: 2020, week: 53 });
    expect(isoWeek(new Date("2024-12-30T00:00:00Z"))).toEqual({ year: 2025, week: 1 });
    expect(weekLabel("2026-11-23")).toBe("Week 48 (Nov 23 – Nov 29, 2026)");
  });

  it("allows one audit request per workspace per ISO week", () => {
    const now = new Date("2026-11-26T09:00:00Z");
    const open = auditRequestWindow([{ week_of: "2026-11-16" }], now);
    expect(open).toMatchObject({ allowed: true, weekOf: "2026-11-23", current: null, nextWeekOf: "2026-11-30" });
    const taken = auditRequestWindow([{ week_of: "2026-11-23", id: "x" }], now);
    expect(taken.allowed).toBe(false);
    expect(taken.current).toEqual({ week_of: "2026-11-23", id: "x" });
    // The following Monday opens a new week.
    expect(auditRequestWindow([{ week_of: "2026-11-23" }], new Date("2026-11-30T00:00:01Z")).allowed).toBe(true);
  });
});

describe("sessions", () => {
  const s = (id: string, starts_at: string, status: SessionLike["status"] = "scheduled", duration_min = 60): SessionLike => ({
    id,
    starts_at,
    duration_min,
    status,
    recording_url: null,
  });
  const now = new Date("2026-11-26T18:30:00Z");

  it("groups upcoming, past and cancelled", () => {
    const g = groupSessions(
      [
        s("next-week", "2026-12-03T18:00:00Z"),
        s("live", "2026-11-26T18:00:00Z"),
        s("old", "2026-11-19T18:00:00Z", "done"),
        s("ended-not-marked", "2026-11-25T18:00:00Z"),
        s("cancelled-future", "2026-12-10T18:00:00Z", "cancelled"),
        s("cancelled-past", "2026-11-01T18:00:00Z", "cancelled"),
      ],
      now,
    );
    expect(g.upcoming.map((x) => x.id)).toEqual(["live", "next-week"]);
    expect(g.past.map((x) => x.id)).toEqual(["ended-not-marked", "old"]);
    expect(g.cancelled.map((x) => x.id)).toEqual(["cancelled-future"]);
  });

  it("detects a live session", () => {
    expect(isLive(s("a", "2026-11-26T18:00:00Z"), now)).toBe(true);
    expect(isLive(s("b", "2026-11-26T17:00:00Z"), now)).toBe(false);
    expect(isLive(s("c", "2026-11-26T18:00:00Z", "cancelled"), now)).toBe(false);
  });
});

describe("mentorship validation", () => {
  it("converts local date-times with the browser offset", () => {
    // UTC-5 (getTimezoneOffset() = 300): 10:00 local is 15:00 UTC.
    expect(localDateTimeToIso("2026-12-03T10:00", 300)).toBe("2026-12-03T15:00:00.000Z");
    expect(isoToLocalDateTime("2026-12-03T15:00:00.000Z", 300)).toBe("2026-12-03T10:00");
    expect(localDateTimeToIso("tomorrow", 0)).toBeNull();
  });

  it("validates sessions", () => {
    const ok = sessionSchema.safeParse({
      title: "Weekly call",
      description: "",
      starts_local: "2026-12-03T10:00",
      tz_offset: "300",
      duration_min: "60",
      join_url: "https://meet.example.test/abc",
      recording_url: "",
      status: "scheduled",
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.starts_at).toBe("2026-12-03T15:00:00.000Z");
      expect(ok.data.recording_url).toBeNull();
      expect(ok.data.description).toBeNull();
    }
    const bad = sessionSchema.safeParse({
      title: "",
      description: "",
      starts_local: "",
      tz_offset: "0",
      duration_min: "2",
      join_url: "http://insecure.test",
      recording_url: "",
      status: "scheduled",
    });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues.map((i) => i.path[0])).toEqual(expect.arrayContaining(["title", "starts_local", "duration_min", "join_url"]));
  });

  it("validates resources, audit requests and feedback", () => {
    expect(resourceLinkSchema.safeParse({ title: "Checklist", description: "", url: "" }).success).toBe(false);
    expect(resourceLinkSchema.safeParse({ title: "Checklist", description: "", url: "https://docs.example.test/x" }).success).toBe(true);
    expect(auditRequestSchema.safeParse({ store_id: "nope", seller_notes: "" }).success).toBe(false);
    const req = auditRequestSchema.safeParse({ store_id: "3f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f", seller_notes: "  " });
    expect(req.success && req.data.seller_notes).toBeNull();
    const id = "3f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
    expect(feedbackSchema.safeParse({ id, feedback: "", intent: "save" }).success).toBe(true);
    expect(feedbackSchema.safeParse({ id, feedback: "Too short", intent: "deliver" }).success).toBe(false);
    expect(feedbackSchema.safeParse({ id, feedback: "Your titles are missing key item specifics.", intent: "deliver" }).success).toBe(true);
  });
});

describe("store snapshot calculations", () => {
  const rules = { finalValueFeePct: 13.6, perOrderFee: 0.4, minNetMarginPct: 20 };

  it("counts low-margin listings with the margin guard, then stored margin, else unknown", () => {
    const r = countLowMargin(
      [
        { price: 30, net_margin_pct: null, supplier_products: { cost: 10, shipping_cost: 2 } }, // healthy
        { price: 12, net_margin_pct: 50, supplier_products: { cost: 9, shipping_cost: 1 } }, // guard says low despite stale stored margin
        { price: 20, net_margin_pct: null, manual_cost: 15, manual_shipping_cost: 0, supplier_products: null }, // low via manual cost
        { price: 20, net_margin_pct: "12.5", supplier_products: null }, // low via stored margin
        { price: 20, net_margin_pct: null, supplier_products: null }, // unknown
      ],
      rules,
    );
    expect(r).toEqual({ low: 3, unknown: 1 });
  });

  it("sums daily metrics", () => {
    expect(
      sumMetrics([
        { day: "2026-11-01", sales: "100.10", net_profit: "20.05", orders: 3 },
        { day: "2026-11-02", sales: 50, net_profit: -5, orders: 1 },
      ]),
    ).toEqual({ sales: 150.1, net: 15.05, orders: 4, days: 2 });
  });
});
