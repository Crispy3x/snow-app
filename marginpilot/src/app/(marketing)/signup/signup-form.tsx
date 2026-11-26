"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormMessage, Select, TextInput } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/app";
import type { AuthState } from "@/lib/account/auth-state";
import { signup } from "./actions";

export function SignupForm({
  plan,
  next,
  planOptions,
  submitLabel,
}: {
  plan: string;
  next: string;
  planOptions: { value: string; label: string }[];
  submitLabel: string;
}) {
  const [state, action] = useActionState<AuthState, FormData>(signup, null);

  if (state?.ok && state.code === "confirm") {
    return (
      <Alert tone="success" title="Confirm your email">
        <p>{state.message}</p>
        <p className="mt-2">The link expires in 24 hours. Didn&rsquo;t get it? Check spam, then log in to resend it.</p>
      </Alert>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      <TextInput id="fullName" name="fullName" label="Full name" autoComplete="name" required maxLength={120} error={state?.fieldErrors?.fullName} />
      <TextInput
        id="email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
        defaultValue={state?.email}
        error={state?.fieldErrors?.email}
      />
      <TextInput
        id="password"
        name="password"
        type="password"
        label="Password"
        autoComplete="new-password"
        required
        minLength={8}
        hint="At least 8 characters."
        error={state?.fieldErrors?.password}
      />
      {!next && <Select id="plan" name="plan" label="Plan" defaultValue={plan} options={planOptions} error={state?.fieldErrors?.plan} />}
      <FormMessage state={state} />
      {state?.code === "exists" && (
        <p className="text-sm">
          <Link href="/login" className="font-medium text-accent underline underline-offset-2 hover:text-accent-strong">
            Go to log in
          </Link>
        </p>
      )}
      <SubmitButton className="w-full" size="lg" pendingText="Creating your account…">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
