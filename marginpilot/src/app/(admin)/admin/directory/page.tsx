import Link from "next/link";
import { adminContext } from "@/lib/admin/server";
import { Alert, EmptyState, PageHeader } from "@/components/ui/app";
import { LinkButton, buttonClasses } from "@/components/ui/button";
import { Badge } from "@/components/ui/layout";
import { MoveButtons } from "@/components/course/admin/move-buttons";
import { formatDay, type DirectoryStatus } from "@/lib/directory/types";
import { moveDirectorySupplier, setDirectoryStatus } from "./actions";

export const metadata = { title: "Supplier directory" };

type Row = {
  id: string;
  name: string;
  website: string | null;
  categories: string[];
  status: DirectoryStatus;
  sort_order: number;
  verified_on: string | null;
  typical_handling_days: number | null;
  updated_at: string;
};

const STATUS_BADGE: Record<DirectoryStatus, { tone: "accent" | "amber" | "neutral"; label: string }> = {
  published: { tone: "accent", label: "Published" },
  draft: { tone: "amber", label: "Draft" },
  archived: { tone: "neutral", label: "Archived" },
};

function staleDays(verifiedOn: string | null, now: number): number | null {
  if (!verifiedOn) return null;
  return Math.floor((now - Date.parse(`${verifiedOn}T00:00:00Z`)) / 86_400_000);
}

export default async function AdminDirectoryPage({ searchParams }: { searchParams: Promise<{ show?: string; deleted?: string }> }) {
  const { db } = await adminContext();
  const { show, deleted } = await searchParams;
  const showArchived = show === "archived";
  const { data } = await db
    .from("directory_suppliers")
    .select("id, name, website, categories, status, sort_order, verified_on, typical_handling_days, updated_at")
    .order("sort_order")
    .order("name");
  const all = (data ?? []) as Row[];
  const active = all.filter((r) => r.status !== "archived");
  const archived = all.filter((r) => r.status === "archived");
  const rows = showArchived ? archived : active;
  const published = active.filter((r) => r.status === "published").length;
  const now = Date.now();

  return (
    <>
      <PageHeader
        title="Supplier directory"
        description="Vetted wholesale suppliers shown to Professional and Mentorship workspaces. Everything here is entered by an admin; nothing is imported or generated."
        actions={<LinkButton href="/admin/directory/new">Add supplier</LinkButton>}
      />
      <div className="grid gap-4">
        {deleted && <Alert tone="success">Supplier deleted.</Alert>}
        <Alert tone="info">
          Wholesale only. eBay allows drop shipping only from wholesale suppliers, so retail store and marketplace websites are rejected.
          Contact details are visible only to entitled plans.
        </Alert>
        <nav aria-label="Directory views" className="flex flex-wrap gap-2">
          <Link href="/admin/directory" aria-current={!showArchived ? "page" : undefined} className={buttonClasses(showArchived ? "ghost" : "secondary")}>
            Live and drafts ({active.length}, {published} published)
          </Link>
          <Link href="/admin/directory?show=archived" aria-current={showArchived ? "page" : undefined} className={buttonClasses(showArchived ? "secondary" : "ghost")}>
            Archived ({archived.length})
          </Link>
        </nav>

        {rows.length === 0 ? (
          showArchived ? (
            <EmptyState title="Nothing archived" />
          ) : (
            <EmptyState title="No suppliers yet" action={<LinkButton href="/admin/directory/new">Add the first supplier</LinkButton>}>
              Add wholesale suppliers you have vetted yourself. Sellers see an empty directory, with an explanation, until you publish one.
            </EmptyState>
          )
        ) : (
          <ol className="grid gap-3" aria-label={showArchived ? "Archived suppliers" : "Suppliers in display order"}>
            {rows.map((r, i) => {
              const age = staleDays(r.verified_on, now);
              const badge = STATUS_BADGE[r.status];
              return (
                <li key={r.id} className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {!showArchived && <span className="text-ink-muted">{i + 1}. </span>}
                      <Link href={`/admin/directory/${r.id}`} className="hover:underline">
                        {r.name}
                      </Link>
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                      {r.verified_on ? (
                        <span>Verified {formatDay(r.verified_on)}</span>
                      ) : (
                        <Badge tone="danger">Not verified</Badge>
                      )}
                      {age !== null && age > 180 && <Badge tone="amber">Re-verify: {age} days old</Badge>}
                      {r.categories.length > 0 && <span>{r.categories.join(", ")}</span>}
                      {r.typical_handling_days !== null && <span>Handling {r.typical_handling_days}d</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!showArchived && (
                      <MoveButtons action={moveDirectorySupplier} id={r.id} label={r.name} isFirst={i === 0} isLast={i === rows.length - 1} />
                    )}
                    <form action={setDirectoryStatus}>
                      <input type="hidden" name="id" value={r.id} />
                      {r.status === "published" ? (
                        <button type="submit" name="status" value="draft" className={buttonClasses("secondary")}>
                          Unpublish<span className="sr-only"> {r.name}</span>
                        </button>
                      ) : (
                        <button type="submit" name="status" value="published" className={buttonClasses("primary")}>
                          Publish<span className="sr-only"> {r.name}</span>
                        </button>
                      )}
                    </form>
                    <LinkButton href={`/admin/directory/${r.id}`} variant="ghost">
                      Edit<span className="sr-only"> {r.name}</span>
                    </LinkButton>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </>
  );
}
