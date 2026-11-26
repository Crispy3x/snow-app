import { EmptyState, PageHeader, Panel } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { SubmitButton } from "@/components/ui/submit-button";
import { adminContext, formatDateTime } from "@/lib/admin/server";
import { deleteFlag, toggleFlag } from "./actions";
import { FlagForm, type FlagFormValues } from "./flag-form";

export const metadata = { title: "Feature flags" };

export default async function FlagsPage() {
  const { db } = await adminContext();
  const { data, error } = await db.from("feature_flags").select("key, description, enabled, org_allowlist, updated_at").order("key");
  const flags = (data ?? []) as (FlagFormValues & { updated_at: string })[];

  const orgIds = [...new Set(flags.flatMap((f) => f.org_allowlist))];
  const { data: orgs } = orgIds.length ? await db.from("organizations").select("id, name").in("id", orgIds.slice(0, 1000)) : { data: [] };
  const orgName = new Map(((orgs ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]));

  return (
    <>
      <PageHeader
        title="Feature flags"
        description="Turn features on for everyone, or for chosen workspaces while they're off for everyone else. Code checks them with isFeatureEnabled(key, orgId) from @/lib/flags."
      />

      {error && <p role="alert" className="mb-4 text-sm font-medium text-danger">Couldn&apos;t load flags: {error.message}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,22rem)]">
        <div className="space-y-4">
          {flags.length === 0 ? (
            <EmptyState title="No flags yet">Create one with the form. Unknown keys always read as off.</EmptyState>
          ) : (
            flags.map((f) => (
              <Panel
                key={f.key}
                title={f.key}
                description={f.description ?? undefined}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={f.enabled ? "accent" : "neutral"}>{f.enabled ? "On for everyone" : f.org_allowlist.length ? `On for ${f.org_allowlist.length} workspace${f.org_allowlist.length === 1 ? "" : "s"}` : "Off"}</Badge>
                    <form action={toggleFlag}>
                      <input type="hidden" name="key" value={f.key} />
                      <input type="hidden" name="enabled" value={f.enabled ? "false" : "true"} />
                      <SubmitButton variant="secondary" pendingText="Saving…" aria-label={`${f.enabled ? "Turn off" : "Turn on"} ${f.key} for everyone`}>
                        {f.enabled ? "Turn off" : "Turn on"}
                      </SubmitButton>
                    </form>
                  </div>
                }
              >
                {f.org_allowlist.length > 0 && (
                  <p className="mb-3 text-sm">
                    <span className="font-medium">Allowlist:</span>{" "}
                    {f.org_allowlist.map((id) => orgName.get(id) ?? id).join(", ")}
                  </p>
                )}
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-accent underline underline-offset-2">Edit</summary>
                  <div className="mt-4">
                    <FlagForm flag={f} />
                  </div>
                  <form action={deleteFlag} className="mt-6 border-t border-line pt-4">
                    <input type="hidden" name="key" value={f.key} />
                    <p className="mb-2 text-sm text-ink-muted">Deleting a flag turns the feature off everywhere it was on.</p>
                    <SubmitButton variant="secondary" pendingText="Deleting…" className="text-danger">
                      Delete flag {f.key}
                    </SubmitButton>
                  </form>
                </details>
                <p className="mt-3 text-xs text-ink-muted">Updated {formatDateTime(f.updated_at)}</p>
              </Panel>
            ))
          )}
        </div>

        <Panel title="New flag">
          <FlagForm />
        </Panel>
      </div>
    </>
  );
}
