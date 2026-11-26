import type { Metadata } from "next";
import { Suspense } from "react";
import { getUser } from "@/lib/auth";
import { Alert } from "@/components/ui/app";
import { LinkButton } from "@/components/ui/button";
import { AuthCard, FormSkeleton } from "@/components/account/auth-card";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <AuthCard title="Choose a new password">
      <Suspense fallback={<FormSkeleton />}>
        <ResetBody />
      </Suspense>
    </AuthCard>
  );
}

async function ResetBody() {
  const user = await getUser();
  if (!user) {
    return (
      <div className="space-y-4">
        <Alert tone="warning" title="This reset link has expired">
          Reset links work once and expire after an hour. Ask for a new one and use the latest email.
        </Alert>
        <LinkButton href="/forgot-password" className="w-full">
          Send a new reset link
        </LinkButton>
      </div>
    );
  }
  return (
    <>
      <p className="mb-4 text-sm text-ink-muted">Signed in as {user.email}.</p>
      <ResetForm />
    </>
  );
}
