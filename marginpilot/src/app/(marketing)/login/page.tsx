import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { safeNext } from "@/lib/account/redirect";
import { Alert } from "@/components/ui/app";
import { AuthCard, FormSkeleton, firstParam, type SearchParams } from "@/components/account/auth-card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

const ERRORS: Record<string, { title: string; body: string }> = {
  link_invalid: {
    title: "That link has expired or was already used",
    body: "Email links work once and expire after an hour. Log in below, or ask for a new link.",
  },
  no_workspace: {
    title: "We couldn't find a workspace for your account",
    body: "If you were removed from a team, ask the owner to invite you again, or contact support.",
  },
};

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AuthCard title="Log in"><FormSkeleton /></AuthCard>}>
      <LoginBody searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginBody({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = safeNext(firstParam(sp.next));
  const errorKey = firstParam(sp.error);
  const error = errorKey ? ERRORS[errorKey] : undefined;

  // Signed-in visitors skip the form (except when the app sent them here because something is wrong).
  if (errorKey !== "no_workspace" && (await getUser())) redirect(next);

  const invite = next.startsWith("/auth/invite");
  const signupHref = next !== "/app" ? `/signup?next=${encodeURIComponent(next)}` : "/signup";

  return (
    <AuthCard
      title="Log in"
      intro={invite ? "Log in, or create an account, to accept your team invitation." : "Welcome back."}
      footer={
        <p>
          New here?{" "}
          <Link href={signupHref} className="font-medium text-accent underline underline-offset-2 hover:text-accent-strong">
            {invite ? "Create an account" : "Start your free trial"}
          </Link>
        </p>
      }
    >
      {error && (
        <div className="mb-4">
          <Alert tone="warning" title={error.title}>
            {error.body}
          </Alert>
        </div>
      )}
      <LoginForm next={next} />
    </AuthCard>
  );
}
