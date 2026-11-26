import type { Metadata } from "next";
import { Suspense } from "react";
import { getUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashInviteToken, invitationProblem } from "@/lib/team/invitations";
import { Alert } from "@/components/ui/app";
import { LinkButton } from "@/components/ui/button";
import { AuthCard, FormSkeleton, firstParam, type SearchParams } from "@/components/account/auth-card";
import { AcceptForm } from "./accept-form";
import { PROBLEM_TEXT } from "./problems";

export const metadata: Metadata = { title: "Join your team", robots: { index: false } };

export default function InvitePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AuthCard title="Join your team"><FormSkeleton rows={1} /></AuthCard>}>
      <InviteBody searchParams={searchParams} />
    </Suspense>
  );
}

const ROLE: Record<string, string> = { owner: "an owner", admin: "an admin", member: "a member" };

async function InviteBody({ searchParams }: { searchParams: SearchParams }) {
  const token = firstParam((await searchParams).token) ?? "";
  const { data: inv } = token
    ? await createAdminClient()
        .from("invitations")
        .select("email, role, expires_at, accepted_at, organizations(name)")
        .eq("token_hash", hashInviteToken(token))
        .maybeSingle()
    : { data: null };
  const orgName = (inv?.organizations as unknown as { name: string } | null)?.name ?? "the workspace";
  const here = `/auth/invite?token=${encodeURIComponent(token)}`;
  const user = await getUser();

  // Validity apart from the email check, which needs a signed-in user.
  const baseProblem = invitationProblem(inv, inv?.email ?? "");
  if (baseProblem) {
    return (
      <AuthCard title="Join your team">
        <div className="space-y-4">
          <Alert tone="warning" title="We can't use this invitation">
            {PROBLEM_TEXT[baseProblem]}
          </Alert>
          <LinkButton href={user ? "/app" : "/login"} variant="secondary" className="w-full">
            {user ? "Go to the app" : "Log in"}
          </LinkButton>
        </div>
      </AuthCard>
    );
  }

  if (!user) {
    return (
      <AuthCard title={`Join ${orgName}`} intro={`You've been invited as ${ROLE[inv!.role as string] ?? "a member"}. Log in or create an account with ${inv!.email} to accept.`}>
        <div className="flex flex-col gap-3">
          <LinkButton href={`/signup?next=${encodeURIComponent(here)}`} size="lg">
            Create an account
          </LinkButton>
          <LinkButton href={`/login?next=${encodeURIComponent(here)}`} variant="secondary" size="lg">
            I already have an account
          </LinkButton>
        </div>
      </AuthCard>
    );
  }

  const problem = invitationProblem(inv, user.email);
  if (problem) {
    return (
      <AuthCard title={`Join ${orgName}`}>
        <div className="space-y-4">
          <Alert tone="warning" title="Different email address">
            {PROBLEM_TEXT[problem]} You&rsquo;re signed in as {user.email}.
          </Alert>
          <LinkButton href="/app" variant="secondary" className="w-full">
            Go to the app
          </LinkButton>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={`Join ${orgName}`} intro={`You'll join as ${ROLE[inv!.role as string] ?? "a member"}, signed in as ${user.email}.`}>
      <AcceptForm token={token} orgName={orgName} />
    </AuthCard>
  );
}
