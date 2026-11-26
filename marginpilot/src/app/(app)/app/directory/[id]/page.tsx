import Link from "next/link";
import { notFound } from "next/navigation";
import { getAppContext } from "@/lib/auth";
import { Alert, PageHeader, Panel, TextLink } from "@/components/ui/app";
import { Button } from "@/components/ui/button";
import { LockedDirectory } from "@/components/directory/locked";
import { ShippingFacts, SupplierBadges, websiteHost } from "@/components/directory/supplier-facts";
import { AddToSuppliersForm, NoteForm } from "@/components/directory/seller-forms";
import { directoryAccess, getFavorites, getPublished, linkedSuppliers, publishedCount, storeHandlingDays } from "@/lib/directory/server";
import { handlingTimeHint } from "@/lib/directory/handling";
import { CONTACT_LABEL, contactHref, formatDay } from "@/lib/directory/types";
import { toggleFavorite } from "../actions";

export const metadata = { title: "Supplier details" };

export default async function DirectorySupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAppContext();
  const access = directoryAccess(ctx);
  if (!access.canView) {
    return (
      <>
        <PageHeader title="Supplier directory" />
        <LockedDirectory count={await publishedCount()} />
      </>
    );
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const s = await getPublished(id);
  if (!s) notFound();

  const [favorites, linked, handlingDays] = await Promise.all([
    access.entitled ? getFavorites(ctx.org.id) : Promise.resolve(new Map()),
    access.entitled ? linkedSuppliers(ctx.org.id) : Promise.resolve(new Map<string, string>()),
    storeHandlingDays(ctx.store?.id),
  ]);
  const fav = favorites.get(s.id);
  const hint = handlingTimeHint(s.typical_handling_days, handlingDays);
  const href = contactHref(s.contact_method, s.contact_value);
  const host = websiteHost(s.website);

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/app/directory" className="text-accent underline underline-offset-2">
          Supplier directory
        </Link>
      </p>
      <PageHeader
        title={s.name}
        description={[s.ships_from, s.categories.join(", ")].filter(Boolean).join(" · ") || undefined}
        actions={
          access.entitled ? (
            <form action={toggleFavorite}>
              <input type="hidden" name="id" value={s.id} />
              <Button type="submit" variant="secondary" aria-pressed={!!fav?.is_favorite}>
                {fav?.is_favorite ? "Saved to favourites" : "Save to favourites"}
              </Button>
            </form>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          {s.description && (
            <Panel title="About">
              <p className="whitespace-pre-line">{s.description}</p>
              <div className="mt-4">
                <SupplierBadges s={s} />
              </div>
            </Panel>
          )}

          <Panel title="Shipping expectations">
            <div className="grid gap-4">
              <Alert tone={hint.level === "warn" ? "warning" : "info"} title={hint.level === "warn" ? "Handling time is longer than your store's" : "eBay handling time"}>
                {hint.message}
              </Alert>
              <ShippingFacts s={s} />
            </div>
          </Panel>

          {s.notes && (
            <Panel title="Notes from our review">
              <p className="whitespace-pre-line text-sm">{s.notes}</p>
            </Panel>
          )}
        </div>

        <div className="grid content-start gap-6">
          <Panel title="Contact">
            <dl className="grid gap-3">
              <div>
                <dt className="text-sm text-ink-muted">{CONTACT_LABEL[s.contact_method]}</dt>
                <dd className="break-words font-medium">
                  {href ? (
                    <a href={href} className="text-accent underline underline-offset-2" target={s.contact_method === "email" || s.contact_method === "phone" ? undefined : "_blank"} rel="noopener noreferrer">
                      {s.contact_value}
                    </a>
                  ) : (
                    s.contact_value
                  )}
                </dd>
              </div>
              {s.website && host && (
                <div>
                  <dt className="text-sm text-ink-muted">Website</dt>
                  <dd className="break-words font-medium">
                    <a href={s.website} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
                      {host}
                    </a>
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-sm text-ink-muted">Last verified</dt>
                <dd className="font-medium">{formatDay(s.verified_on)}</dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-ink-muted">
              Ask for a wholesale or reseller account. Terms, prices and minimums can change, so confirm them with the supplier.
            </p>
          </Panel>

          {access.entitled ? (
            <>
              <Panel title="Add to my suppliers">
                <AddToSuppliersForm id={s.id} name={s.name} linkedSupplierId={linked.get(s.id) ?? null} />
              </Panel>
              <Panel title="Your notes">
                <NoteForm id={s.id} note={fav?.note ?? null} />
              </Panel>
            </>
          ) : (
            <Alert tone="info" title="Admin preview">
              Adding suppliers and notes needs a workspace on a plan with the directory. <TextLink href="/admin/directory">Manage the directory</TextLink>
            </Alert>
          )}
        </div>
      </div>
    </>
  );
}
