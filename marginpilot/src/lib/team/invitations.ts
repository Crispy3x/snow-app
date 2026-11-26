import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { BRAND } from "@/config/brand";

/**
 * Team invitations. The raw token only ever lives in the emailed link; the
 * database stores its SHA-256 hash, so a leaked table can't be used to join.
 */

export const INVITE_TTL_DAYS = 7;

export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function inviteExpiry(now = new Date()): string {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function inviteLink(baseUrl: string, token: string): string {
  return `${baseUrl}/auth/invite?token=${encodeURIComponent(token)}`;
}

/** Why an invitation can't be used, or null if it's valid for this email. */
export function invitationProblem(
  inv: { email: string; expires_at: string; accepted_at: string | null } | null,
  userEmail: string,
  now = new Date(),
): "not_found" | "accepted" | "expired" | "wrong_email" | null {
  if (!inv) return "not_found";
  if (inv.accepted_at) return "accepted";
  if (Date.parse(inv.expires_at) <= now.getTime()) return "expired";
  if (inv.email.trim().toLowerCase() !== userEmail.trim().toLowerCase()) return "wrong_email";
  return null;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Sends the invite through Resend's REST API when RESEND_API_KEY is set.
 * Returns false (and the caller shows the link to copy) when it isn't configured or fails.
 */
export async function sendInviteEmail(input: {
  to: string;
  link: string;
  orgName: string;
  inviterName: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const from = process.env.EMAIL_FROM || `${BRAND.name} <${BRAND.supportEmail}>`;
  const subject = `${input.inviterName} invited you to ${input.orgName} on ${BRAND.name}`;
  const text = [
    `${input.inviterName} invited you to join the ${input.orgName} workspace on ${BRAND.name}.`,
    "",
    `Accept the invitation: ${input.link}`,
    "",
    `The link expires in ${INVITE_TTL_DAYS} days. If you weren't expecting this, you can ignore this email.`,
  ].join("\n");
  const html = `<p>${escapeHtml(input.inviterName)} invited you to join the <strong>${escapeHtml(input.orgName)}</strong> workspace on ${escapeHtml(BRAND.name)}.</p>
<p><a href="${escapeHtml(input.link)}">Accept the invitation</a></p>
<p>The link expires in ${INVITE_TTL_DAYS} days. If you weren't expecting this, you can ignore this email.</p>`;
  try {
    const res = await (input.fetchImpl ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [input.to], subject, text, html }),
    });
    if (!res.ok) {
      console.error("[team] Resend rejected invite email", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[team] invite email failed", e);
    return false;
  }
}
