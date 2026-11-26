import { canManage, getAppContext } from "@/lib/auth";
import { usage } from "@/lib/limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { Alert, DataTable, EmptyState, PageHeader, Panel, TextLink, td, th } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { Meter } from "@/components/ui/charts";
import { SubmitButton } from "@/components/ui/submit-button";
import { InviteForm } from "./invite-form";
import { RemoveMemberButton } from "./remove-member-button";
import { revokeInvitation } from "./actions";

export const metadata = { title: "Team" };

type Role = "owner" | "admin" | "member";
const ROLE_TONE: Record<Role, "accent" | "neutral" | "amber"> = { owner: "accent", admin: "neutral", member: "neutral" };
const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member" };
const isExpired = (iso: string) => Date.parse(iso) <= Date.now();
const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function TeamPage() {
  const ctx = await getAppContext();
  const manage = canManage(ctx.role);
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: memberRows } = await supabase
    .from("memberships")
    .select("user_id, role, created_at")
    .eq("org_id", ctx.org.id)
    .order("created_at");
  const members = (memberRows ?? []) as { user_id: string; role: Role; created_at: string }[];
  const ids = members.map((m) => m.user_id);

  // Names and emails of people in this org only (profiles RLS shows just your own row).
  const [{ data: profiles }, emails] = await Promise.all([
    admin.from("profiles").select("id, full_name").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
    Promise.all(ids.map(async (id) => [id, (await admin.auth.admin.getUserById(id)).data.user?.email ?? ""] as const)),
  ]);
  const nameOf = new Map((profiles ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? ""]));
  const emailOf = new Map(emails);

  const { data: inviteRows } = manage
    ? await supabase
        .from("invitations")
        .select("id, email, role, expires_at")
        .eq("org_id", ctx.org.id)
        .is("accepted_at", null)
        .order("expires_at", { ascending: false })
    : { data: [] };
  const invitations = (inviteRows ?? []) as { id: string; email: string; role: Role; expires_at: string }[];

  const used = await usage(ctx.org.id);
  const seatLimit = ctx.plan?.limits.seats ?? 0;

  return (
    <>
      <PageHeader title="Team" description={`People who can work in ${ctx.org.name}.`} />

      <div className="space-y-6">
        {!ctx.plan ? (
          <Alert tone="warning" title="Choose a plan to invite your team">
            Team seats come with your plan. <TextLink href="/app/billing">See plans</TextLink>
          </Alert>
        ) : (
          <Panel>
            <Meter label="Team seats" used={used.seats} max={seatLimit} />
            {used.seats >= seatLimit && (
              <p className="mt-2 text-sm text-ink-muted">
                Every seat on your {ctx.plan.name} plan is in use. <TextLink href="/app/billing">Upgrade for more seats</TextLink>
              </p>
            )}
          </Panel>
        )}

        {manage && ctx.plan && (
          <Panel title="Invite someone" description="They'll get a link to join this workspace. Admins can invite people and manage billing.">
            <InviteForm />
          </Panel>
        )}

        <section aria-labelledby="members-heading" className="space-y-3">
          <h2 id="members-heading" className="text-lg font-semibold">
            Members
          </h2>
          <DataTable caption="Workspace members">
            <thead>
              <tr>
                <th className={th}>Name</th>
                <th className={th}>Email</th>
                <th className={th}>Role</th>
                <th className={th}>Joined</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const self = m.user_id === ctx.user.id;
                const name = nameOf.get(m.user_id) || emailOf.get(m.user_id) || "Unknown";
                const canRemove =
                  m.role !== "owner" && (self || (manage && (m.role !== "admin" || ctx.role === "owner")));
                return (
                  <tr key={m.user_id}>
                    <td className={td}>
                      {name}
                      {self && <span className="ml-2 text-ink-muted">(you)</span>}
                    </td>
                    <td className={`${td} break-all`}>{emailOf.get(m.user_id)}</td>
                    <td className={td}>
                      <Badge tone={ROLE_TONE[m.role]}>{ROLE_LABEL[m.role]}</Badge>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{date(m.created_at)}</td>
                    <td className={`${td} text-right`}>{canRemove && <RemoveMemberButton userId={m.user_id} name={name} self={self} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </section>

        {manage && (
          <section aria-labelledby="invites-heading" className="space-y-3">
            <h2 id="invites-heading" className="text-lg font-semibold">
              Pending invitations
            </h2>
            {invitations.length === 0 ? (
              <EmptyState title="No pending invitations">Invitations you send appear here until they&rsquo;re accepted.</EmptyState>
            ) : (
              <DataTable caption="Pending invitations">
                <thead>
                  <tr>
                    <th className={th}>Email</th>
                    <th className={th}>Role</th>
                    <th className={th}>Expires</th>
                    <th className={th}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((inv) => {
                    const expired = isExpired(inv.expires_at);
                    return (
                      <tr key={inv.id}>
                        <td className={`${td} break-all`}>{inv.email}</td>
                        <td className={td}>{ROLE_LABEL[inv.role]}</td>
                        <td className={`${td} whitespace-nowrap`}>
                          {expired ? <Badge tone="danger">Expired</Badge> : date(inv.expires_at)}
                        </td>
                        <td className={`${td} text-right`}>
                          <form action={revokeInvitation}>
                            <input type="hidden" name="invitationId" value={inv.id} />
                            <SubmitButton variant="ghost" pendingText="Removing…" aria-label={`Cancel invitation for ${inv.email}`}>
                              {expired ? "Remove" : "Cancel invite"}
                            </SubmitButton>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </DataTable>
            )}
          </section>
        )}
      </div>
    </>
  );
}
