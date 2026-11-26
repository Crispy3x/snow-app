import { Badge } from "@/components/ui/layout";
import type { DirectoryListRow } from "@/lib/directory/types";

const days = (n: number | null, unit = "day") => (n === null ? "Not recorded" : `${n} ${unit}${n === 1 ? "" : "s"}`);

/** Yes/no capabilities as badges. Only "yes" values are shown, so nothing reads as a negative claim. */
export function SupplierBadges({ s }: { s: DirectoryListRow }) {
  return (
    <div className="flex flex-wrap gap-2">
      {s.accepts_dropship && <Badge tone="accent">Drop ships</Badge>}
      {s.us_warehouse && <Badge>US warehouse</Badge>}
      {s.blind_shipping && <Badge>Blind shipping</Badge>}
      {s.provides_tracking && <Badge>Tracking</Badge>}
      {s.csv_feed_available && <Badge>CSV price list</Badge>}
    </div>
  );
}

/** Shipping expectations as a definition list. */
export function ShippingFacts({ s }: { s: DirectoryListRow }) {
  const rows: [string, string][] = [
    ["Ships from", s.ships_from ?? "Not recorded"],
    ["US warehouse", s.us_warehouse ? "Yes" : "No"],
    ["Typical handling", days(s.typical_handling_days, "business day")],
    ["Typical delivery", days(s.typical_delivery_days, "day")],
    ["Minimum order", s.min_order ?? "Not recorded"],
    ["Accepts drop shipping", s.accepts_dropship ? "Yes" : "No"],
    ["Blind shipping (no supplier branding)", s.blind_shipping ? "Yes" : "No"],
    ["Provides tracking", s.provides_tracking ? "Yes" : "No"],
    ["CSV price list available", s.csv_feed_available ? "Yes" : "No"],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="border-b border-line pb-2">
          <dt className="text-sm text-ink-muted">{k}</dt>
          <dd className="font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function websiteHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
