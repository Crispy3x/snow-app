import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createHash } from "node:crypto";
import { hashInviteToken, inviteExpiry, inviteLink, invitationProblem, newInviteToken, sendInviteEmail } from "../invitations";

describe("invite tokens", () => {
  it("are long, random, url-safe, and stored as sha256 hex", () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashInviteToken(a)).toBe(createHash("sha256").update(a).digest("hex"));
    expect(hashInviteToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("expire after 7 days", () => {
    expect(inviteExpiry(new Date("2026-11-26T00:00:00Z"))).toBe("2026-12-03T00:00:00.000Z");
  });

  it("builds the accept link", () => {
    expect(inviteLink("https://app.example", "a-b_c")).toBe("https://app.example/auth/invite?token=a-b_c");
  });
});

describe("invitationProblem", () => {
  const now = new Date("2026-11-26T00:00:00Z");
  const inv = { email: "Pat@Example.com", expires_at: "2026-11-30T00:00:00Z", accepted_at: null };
  it("accepts a valid invitation case-insensitively", () => {
    expect(invitationProblem(inv, "pat@example.com", now)).toBeNull();
  });
  it("rejects missing, used, expired and other-email invitations", () => {
    expect(invitationProblem(null, "pat@example.com", now)).toBe("not_found");
    expect(invitationProblem({ ...inv, accepted_at: "2026-11-20T00:00:00Z" }, "pat@example.com", now)).toBe("accepted");
    expect(invitationProblem({ ...inv, expires_at: "2026-11-25T00:00:00Z" }, "pat@example.com", now)).toBe("expired");
    expect(invitationProblem(inv, "someone@else.com", now)).toBe("wrong_email");
  });
});

describe("sendInviteEmail", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns false without calling Resend when no key is set", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchImpl = vi.fn();
    expect(await sendInviteEmail({ to: "a@b.co", link: "https://x/l", orgName: "Acme", inviterName: "Sam", fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts to the Resend API and escapes HTML", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Team <team@example.com>");
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const ok = await sendInviteEmail({ to: "a@b.co", link: "https://x/l?t=1", orgName: "<Acme>", inviterName: "Sam", fetchImpl });
    expect(ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ from: "Team <team@example.com>", to: ["a@b.co"] });
    expect(body.html).toContain("&lt;Acme&gt;");
    expect(body.text).toContain("https://x/l?t=1");
  });

  it("returns false when Resend rejects the request", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 422 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendInviteEmail({ to: "a@b.co", link: "l", orgName: "A", inviterName: "S", fetchImpl })).toBe(false);
  });
});
