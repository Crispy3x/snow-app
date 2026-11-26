import { getPlan } from "@/config/plans";

export function planLabel(plan: string) {
  return plan === "none" ? "No plan" : (getPlan(plan)?.name ?? plan);
}

export function subTone(status: string | null): "accent" | "amber" | "danger" | "neutral" {
  if (status === "active" || status === "trialing") return "accent";
  if (status === "past_due" || status === "unpaid" || status === "incomplete") return "amber";
  if (status === "canceled" || status === "incomplete_expired") return "danger";
  return "neutral";
}

export function statusLabel(s: string) {
  return s.replace(/_/g, " ");
}

export function aiStatusTone(s: string): "accent" | "amber" | "danger" | "neutral" {
  return s === "ok" ? "accent" : s === "refused" ? "amber" : s === "error" || s === "rate_limited" ? "danger" : "neutral";
}
