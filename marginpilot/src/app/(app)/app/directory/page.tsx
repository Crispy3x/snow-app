import Link from "next/link";
import { getAppContext } from "@/lib/auth";
import { Alert, EmptyState, PageHeader } from "@/components/ui/app";
import { Button, LinkButton } from "@/components/ui/button";
import { Checkbox, Select, TextInput } from "@/components/ui/form";
import { Badge } from "@/components/ui/layout";
import { LockedDirectory } from "@/components/directory/locked";
import { SupplierBadges, websiteHost } from "@/components/directory/supplier-facts";
import { directoryAccess, getFavorites, listPublished, publishedCount, storeHandlingDays } from "@/lib/directory/server";
import { categoriesOf, filterDirectory, hasActiveFilters, parseDirectoryFilters } from "@/lib/directory/filter";
import { handlingTimeHint } from "@/lib/directory/handling";
import { formatDay as formatDate } from "@/lib/directory/types";
import { toggleFavorite } from "./actions";

export const metadata = { title: "Supplier directory" };

export default async function DirectoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getAppContext();
  const access = directoryAccess(ctx);
  const header = (
    <PageHeader
      title="Supplier directory"
      description="Wholesale suppliers our team has vetted for eBay drop shipping. eBay only allows drop shipping from wholesale suppliers, so retail stores and marketplaces are never listed."
      actions={access.entitled ? <LinkButton href="/app/listings/suppliers" variant="secondary">My suppliers</LinkButton> : undefined}
    />
  );

  if (!access.canView) {
    return (
      <>
        {header}
        <LockedDirectory count={await publishedCount()} />
      </>
    );
  }

  const filters = parseDirectoryFilters(await searchParams);
  const [all, favorites, handlingDays] = await Promise.all([
    listPublished(),
    access.entitled ? getFavorites(ctx.org.id) : Promise.resolve(new Map()),
    storeHandlingDays(ctx.store?.id),
  ]);
  const favoriteIds = new Set([...favorites.values()].filter((f) => f.is_favorite).map((f) => f.directory_supplier_id));
  const rows = filterDirectory(all, filters, favoriteIds);
  const categories = categoriesOf(all);

  return (
    <>
      {header}
      <div className="grid gap-6">
        {access.adminPreview && (
          <Alert tone="info" title="Admin preview">
            Your workspace&apos;s plan doesn&apos;t include the directory; you can see it because you&apos;re a platform admin. Favourites
            and adding suppliers are turned off. Manage entries in <Link href="/admin/directory" className="underline">admin</Link>.
          </Alert>
        )}

        {all.length === 0 ? (
          <EmptyState title="No suppliers published yet">
            Every supplier here is vetted and entered by our team, so the directory starts empty and grows as suppliers pass review.
            Check back soon. In the meantime you can add your own wholesale supplier on the{" "}
            <Link href="/app/listings/suppliers" className="font-medium text-accent underline">Suppliers</Link> page.
          </EmptyState>
        ) : (
          <>
            <form method="get" className="grid gap-4 rounded-lg border border-line bg-card p-4" role="search" aria-label="Filter suppliers">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <TextInput id="q" label="Search" type="search" defaultValue={filters.q} placeholder="Name, product type, region" />
                <Select
                  id="category"
                  label="Category"
                  defaultValue={filters.category}
                  options={[{ value: "", label: "All categories" }, ...categories.map((c) => ({ value: c, label: c }))]}
                />
                <Select
                  id="maxHandling"
                  label="Handling time"
                  defaultValue={filters.maxHandling === null ? "" : String(filters.maxHandling)}
                  options={[
                    { value: "", label: "Any" },
                    { value: "1", label: "1 business day or less" },
                    { value: "2", label: "2 business days or less" },
                    { value: "3", label: "3 business days or less" },
                    { value: "5", label: "5 business days or less" },
                  ]}
                />
                <div className="grid content-end gap-2">
                  <Checkbox id="us" label="US warehouse" value="1" defaultChecked={filters.usWarehouse} />
                  <Checkbox id="dropship" label="Accepts drop shipping" value="1" defaultChecked={filters.dropship} />
                  {access.entitled && <Checkbox id="fav" label="My favourites only" value="1" defaultChecked={filters.favorites} />}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit">Apply filters</Button>
                {hasActiveFilters(filters) && (
                  <LinkButton href="/app/directory" variant="ghost">
                    Clear
                  </LinkButton>
                )}
              </div>
            </form>

            <p className="text-sm text-ink-muted" role="status">
              Showing {rows.length.toLocaleString()} of {all.length.toLocaleString()} suppliers.
              {handlingDays !== null && ` Your store's handling time is ${handlingDays} business ${handlingDays === 1 ? "day" : "days"}.`}
            </p>

            {rows.length === 0 ? (
              <EmptyState title="No suppliers match these filters" action={<LinkButton href="/app/directory" variant="secondary">Clear filters</LinkButton>} />
            ) : (
              <ul className="grid gap-4 md:grid-cols-2" aria-label="Suppliers">
                {rows.map((s) => {
                  const hint = handlingTimeHint(s.typical_handling_days, handlingDays);
                  const fav = favoriteIds.has(s.id);
                  const host = websiteHost(s.website);
                  return (
                    <li key={s.id} className="flex flex-col gap-3 rounded-lg border border-line bg-card p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="text-lg font-semibold">
                            <Link href={`/app/directory/${s.id}`} className="hover:underline">
                              {s.name}
                            </Link>
                          </h2>
                          <p className="text-sm text-ink-muted">
                            {[s.ships_from, host].filter(Boolean).join(" · ") || "Location not recorded"}
                          </p>
                        </div>
                        {access.entitled && (
                          <form action={toggleFavorite}>
                            <input type="hidden" name="id" value={s.id} />
                            <Button type="submit" variant={fav ? "secondary" : "ghost"} aria-pressed={fav} className="px-3">
                              {fav ? "Saved" : "Save"}
                              <span className="sr-only"> {s.name} to favourites</span>
                            </Button>
                          </form>
                        )}
                      </div>
                      {s.description && <p className="line-clamp-3 text-sm">{s.description}</p>}
                      <SupplierBadges s={s} />
                      {s.categories.length > 0 && (
                        <p className="text-sm text-ink-muted">
                          <span className="sr-only">Categories: </span>
                          {s.categories.join(", ")}
                        </p>
                      )}
                      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm">
                        <span>
                          Handling: {s.typical_handling_days === null ? "not recorded" : `${s.typical_handling_days} business ${s.typical_handling_days === 1 ? "day" : "days"}`}
                          {hint.level === "warn" && (
                            <>
                              {" "}
                              <Badge tone="amber">Slower than your store</Badge>
                            </>
                          )}
                        </span>
                        {s.verified_on && <span className="text-ink-muted">Verified {formatDate(s.verified_on)}</span>}
                      </div>
                      <div>
                        <LinkButton href={`/app/directory/${s.id}`} variant="secondary">
                          View details<span className="sr-only"> for {s.name}</span>
                        </LinkButton>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </>
  );
}
