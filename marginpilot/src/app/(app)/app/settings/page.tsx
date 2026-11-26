import { getAppContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader, Panel } from "@/components/ui/app";
import { DeleteAccountForm, PasswordForm, ProfileForm, WorkspaceForm } from "./settings-forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await getAppContext();
  const admin = createAdminClient();

  // Workspaces this user owns: deleting the account deletes these too.
  const { data: owned } = await admin.from("organizations").select("id, name, plan, memberships(count)").eq("owner_id", ctx.user.id);
  const ownedList = (owned ?? []).map((o) => ({
    id: o.id as string,
    name: o.name as string,
    paid: o.plan !== "none",
    members: ((o.memberships as unknown as { count: number }[] | null)?.[0]?.count ?? 1) as number,
  }));

  return (
    <>
      <PageHeader title="Settings" description="Your profile, password and workspace." />
      <div className="space-y-6">
        <Panel title="Profile">
          <ProfileForm fullName={ctx.user.fullName ?? ""} email={ctx.user.email} />
        </Panel>

        <Panel title="Password">
          <PasswordForm />
        </Panel>

        <Panel title="Workspace" description={ctx.role === "owner" ? "The name your team sees." : "Only the owner can rename the workspace."}>
          {ctx.role === "owner" ? <WorkspaceForm name={ctx.org.name} /> : <p className="font-medium">{ctx.org.name}</p>}
        </Panel>

        <Panel title="Delete account" className="border-danger/40">
          <div className="max-w-2xl space-y-3 text-sm">
            <p>This permanently deletes your login and can&rsquo;t be undone.</p>
            {ownedList.length > 0 && (
              <>
                <p>It also deletes the workspaces you own, with their connected eBay stores, listings, orders and history:</p>
                <ul className="list-disc space-y-1 pl-5">
                  {ownedList.map((o) => (
                    <li key={o.id}>
                      <span className="font-medium">{o.name}</span>
                      {o.members > 1 && ` (${o.members - 1} other ${o.members - 1 === 1 ? "person loses" : "people lose"} access)`}
                      {o.paid && ". Its subscription is cancelled immediately, with no further charges."}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p>Your eBay listings themselves stay on eBay.</p>
          </div>
          <div className="mt-5">
            <DeleteAccountForm />
          </div>
        </Panel>
      </div>
    </>
  );
}
