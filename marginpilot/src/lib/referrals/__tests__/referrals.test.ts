import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { CODE_ALPHABET, generateCode, isValidCode, maskedName, normalizeCode, refCookieToSet, referralLinks } from "../code";
import { commissionCents, commissionPctFromEnv, isSelfReferral, nextCommissionState, normalizeEmail, withinRefundWindow } from "../commission";
import { getOrCreateReferralCode, recordSignupReferral, referralCodeForOrg } from "../server";
import { recordReferralClick } from "../click";
import { toCsv } from "../csv";
import { FakeDb } from "../../billing/__tests__/fake-db";

const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;

describe("referral codes", () => {
  it("generates 8-character codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const c = generateCode();
      expect(c).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
      expect(isValidCode(c)).toBe(true);
    }
    expect(CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it("skips biased bytes (rejection sampling)", () => {
    // 248+ would bias toward the first characters; they must be skipped.
    const bytes = [255, 250, 248, 0, 1, 30, 31, 247, 2, 3, 4, 5];
    const c = generateCode((n) => Uint8Array.from({ length: n }, (_, i) => bytes[i % bytes.length]), 8);
    expect(c).toBe(["2", "3", "Z", "2", "Z", "4", "5", "6"].join(""));
  });

  it("is reasonably unique", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => generateCode()));
    expect(seen.size).toBe(2000);
  });

  it("validates and normalizes", () => {
    expect(normalizeCode(" abcd2345 ")).toBe("ABCD2345");
    expect(normalizeCode("ABCD0123")).toBeNull(); // 0 and 1 are not in the alphabet
    expect(normalizeCode("ABC")).toBeNull();
    expect(normalizeCode("ABCDEFGHJKMNP")).toBeNull(); // 13 chars
    expect(normalizeCode("ABCD-2345")).toBeNull();
    expect(normalizeCode("<script>")).toBeNull();
    expect(normalizeCode(null)).toBeNull();
    expect(normalizeCode(undefined)).toBeNull();
  });

  it("builds links and masks names", () => {
    expect(referralLinks("https://app.example/", "ABCD2345")).toEqual({
      home: "https://app.example/?ref=ABCD2345",
      signup: "https://app.example/signup?ref=ABCD2345",
    });
    expect(maskedName("jordan smith")).toBe("J.");
    expect(maskedName("  Émile")).toBe("É.");
    expect(maskedName("")).toBe("Someone");
    expect(maskedName(null)).toBe("Someone");
  });
});

describe("first-touch cookie", () => {
  it("sets the cookie from a valid ?ref= when none is stored", () => {
    expect(refCookieToSet(undefined, "abcd2345")).toBe("ABCD2345");
  });
  it("never overwrites an existing valid referral", () => {
    expect(refCookieToSet("WXYZ6789", "ABCD2345")).toBeNull();
  });
  it("replaces a junk cookie, ignores junk params", () => {
    expect(refCookieToSet("garbage!", "ABCD2345")).toBe("ABCD2345");
    expect(refCookieToSet(undefined, "not a code")).toBeNull();
    expect(refCookieToSet(undefined, null)).toBeNull();
  });
});

describe("click counting", () => {
  it("posts one RPC call with the service key, and only for valid codes", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const e = env({ NEXT_PUBLIC_SUPABASE_URL: "https://db.example/", SUPABASE_SERVICE_ROLE_KEY: "svc" });
    await recordReferralClick("abcd2345", e, fetchImpl as unknown as typeof fetch);
    await recordReferralClick("bad", e, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://db.example/rest/v1/rpc/record_referral_click");
    expect(JSON.parse(String(init.body))).toEqual({ p_code: "ABCD2345" });
  });
  it("never throws and does nothing without configuration", async () => {
    const failing = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(
      recordReferralClick("ABCD2345", env({ NEXT_PUBLIC_SUPABASE_URL: "https://db", SUPABASE_SERVICE_ROLE_KEY: "k" }), failing as unknown as typeof fetch),
    ).resolves.toBeUndefined();
    await recordReferralClick("ABCD2345", env({}), failing as unknown as typeof fetch);
    expect(failing).toHaveBeenCalledTimes(1);
  });
});

describe("commission", () => {
  it("reads REFERRAL_COMMISSION_PCT with a 30% default", () => {
    expect(commissionPctFromEnv(env({}))).toBe(30);
    expect(commissionPctFromEnv(env({ REFERRAL_COMMISSION_PCT: "25" }))).toBe(25);
    expect(commissionPctFromEnv(env({ REFERRAL_COMMISSION_PCT: "12.5" }))).toBe(12.5);
    expect(commissionPctFromEnv(env({ REFERRAL_COMMISSION_PCT: "abc" }))).toBe(30);
    expect(commissionPctFromEnv(env({ REFERRAL_COMMISSION_PCT: "-5" }))).toBe(30);
    expect(commissionPctFromEnv(env({ REFERRAL_COMMISSION_PCT: "150" }))).toBe(100);
  });
  it("computes whole cents", () => {
    expect(commissionCents(4700, 30)).toBe(1410); // $47 sale-price Starter
    expect(commissionCents(24700, 30)).toBe(7410);
    expect(commissionCents(999, 12.5)).toBe(125); // 124.875 rounds up
    expect(commissionCents(0, 30)).toBe(0);
    expect(commissionCents(-100, 30)).toBe(0);
    expect(commissionCents(4700, 0)).toBe(0);
  });
  it("checks the refund window", () => {
    const paid = "2026-11-01T00:00:00Z";
    expect(withinRefundWindow(paid, new Date("2026-11-30T23:59:59Z"))).toBe(true);
    expect(withinRefundWindow(paid, new Date("2026-12-01T00:00:01Z"))).toBe(false);
    expect(withinRefundWindow(null, new Date())).toBe(false);
  });
  it("allows only the admin transitions pending -> approved -> paid, or void", () => {
    expect(nextCommissionState({ status: "converted", commission_status: "pending" }, "approve")).toEqual({ status: "converted", commission_status: "approved" });
    expect(nextCommissionState({ status: "converted", commission_status: "approved" }, "paid")).toEqual({ status: "paid", commission_status: "paid" });
    expect(nextCommissionState({ status: "converted", commission_status: "pending" }, "paid")).toBeNull();
    expect(nextCommissionState({ status: "converted", commission_status: "approved" }, "void")).toEqual({ status: "void", commission_status: "void" });
    expect(nextCommissionState({ status: "paid", commission_status: "paid" }, "void")).toBeNull();
    expect(nextCommissionState({ status: "void", commission_status: "void" }, "approve")).toBeNull();
    expect(nextCommissionState({ status: "signed_up", commission_status: null }, "approve")).toBeNull();
    expect(nextCommissionState({ status: "signed_up", commission_status: null }, "void")).toEqual({ status: "void", commission_status: "void" });
  });
});

describe("self-referral", () => {
  it("blocks the same user and the same email (aliases included)", () => {
    expect(isSelfReferral({ referrerUserId: "u1", referredUserId: "u1" })).toBe(true);
    expect(isSelfReferral({ referrerUserId: "u1", referredUserId: "u2", referrerEmail: "Sam@Shop.com", referredEmail: "sam+2@shop.com" })).toBe(true);
    expect(isSelfReferral({ referrerUserId: "u1", referredUserId: "u2", referrerEmail: "s.a.m@gmail.com", referredEmail: "sam@googlemail.com" })).toBe(true);
    expect(isSelfReferral({ referrerUserId: "u1", referredUserId: "u2", referrerEmail: "sam@shop.com", referredEmail: "alex@shop.com" })).toBe(false);
    expect(isSelfReferral({ referrerUserId: "u1", referredUserId: "u2", referrerEmail: null, referredEmail: "alex@shop.com" })).toBe(false);
    expect(normalizeEmail("nope")).toBeNull();
  });
});

describe("code creation and sign-up recording", () => {
  const REFERRER = "aaaaaaaa-0000-0000-0000-000000000001";
  const NEW_USER = "bbbbbbbb-0000-0000-0000-000000000002";
  const ORG = "cccccccc-0000-0000-0000-000000000003";

  function setup() {
    const db = new FakeDb({
      referral_codes: [{ user_id: REFERRER, code: "ABCD2345" }],
      organizations: [{ id: ORG, owner_id: NEW_USER, name: "New", created_at: "2026-11-26T00:00:00Z" }],
    });
    const emails: Record<string, string> = { [REFERRER]: "ref@shop.com" };
    const deps = { db: db as unknown as SupabaseClient, userEmail: async (id: string) => emails[id] ?? null };
    return { db, deps };
  }

  it("returns the existing code, or creates one once", async () => {
    const { db, deps } = setup();
    expect(await getOrCreateReferralCode(deps.db, REFERRER)).toBe("ABCD2345");
    const created = await getOrCreateReferralCode(deps.db, NEW_USER, () => "WXYZ6789");
    expect(created).toBe("WXYZ6789");
    expect(await getOrCreateReferralCode(deps.db, NEW_USER, () => "QQQQ2222")).toBe("WXYZ6789");
    expect(db.rows("referral_codes")).toHaveLength(2);
  });

  it("records a sign-up through a valid code with a masked label and the new workspace", async () => {
    const { db, deps } = setup();
    const res = await recordSignupReferral(deps, { rawCode: "abcd2345", referredUserId: NEW_USER, referredEmail: "new@shop.com", referredName: "Taylor Reed" });
    expect(res).toBe("recorded");
    expect(db.rows("referrals")).toEqual([
      { code: "ABCD2345", referrer_user_id: REFERRER, referred_user_id: NEW_USER, referred_org_id: ORG, referred_label: "T.", status: "signed_up" },
    ]);
    expect(await referralCodeForOrg(deps.db, ORG)).toBe("ABCD2345");
    // Only once per referred user.
    expect(await recordSignupReferral(deps, { rawCode: "ABCD2345", referredUserId: NEW_USER, referredEmail: "new@shop.com", referredName: "T" })).toBe("already_referred");
  });

  it("blocks self-referral by email and ignores bad or unknown codes", async () => {
    const { db, deps } = setup();
    expect(await recordSignupReferral(deps, { rawCode: "ABCD2345", referredUserId: NEW_USER, referredEmail: "REF+alt@shop.com", referredName: "Me" })).toBe("self_referral");
    expect(await recordSignupReferral(deps, { rawCode: "ABCD2345", referredUserId: REFERRER, referredEmail: "x@y.com", referredName: "Me" })).toBe("self_referral");
    expect(await recordSignupReferral(deps, { rawCode: "ZZZZ9999", referredUserId: NEW_USER, referredEmail: "n@s.com", referredName: "N" })).toBe("unknown_code");
    expect(await recordSignupReferral(deps, { rawCode: "bad!", referredUserId: NEW_USER, referredEmail: "n@s.com", referredName: "N" })).toBe("invalid_code");
    expect(db.rows("referrals")).toHaveLength(0);
  });
});

describe("csv", () => {
  it("quotes and neutralises formulas", () => {
    expect(toCsv([["a", 'b "q"', "c,d"], ["=SUM(1)", null, 3]])).toBe('a,"b ""q""","c,d"\r\n\'=SUM(1),,3\r\n');
  });
});
