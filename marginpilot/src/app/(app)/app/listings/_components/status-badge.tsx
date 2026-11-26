import { Badge } from "@/components/ui/layout";

const LISTING: Record<string, { label: string; tone: "neutral" | "accent" | "amber" | "danger" }> = {
  draft: { label: "Draft", tone: "neutral" },
  queued: { label: "Queued", tone: "neutral" },
  publishing: { label: "Publishing", tone: "amber" },
  active: { label: "Live", tone: "accent" },
  out_of_stock: { label: "Out of stock", tone: "amber" },
  ended: { label: "Ended", tone: "neutral" },
  blocked_margin: { label: "Blocked: margin", tone: "danger" },
  error: { label: "Error", tone: "danger" },
};

const JOB: Record<string, { label: string; tone: "neutral" | "accent" | "amber" | "danger" }> = {
  queued: { label: "Waiting", tone: "neutral" },
  running: { label: "Working", tone: "amber" },
  done: { label: "Done", tone: "accent" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function ListingStatusBadge({ status }: { status: string }) {
  const s = LISTING[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function JobStatusBadge({ status }: { status: string }) {
  const s = JOB[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const LISTING_STATUSES = Object.entries(LISTING).map(([value, v]) => ({ value, label: v.label }));
