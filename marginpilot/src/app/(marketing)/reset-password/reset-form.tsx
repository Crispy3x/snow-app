"use client";

import { useActionState } from "react";
import { FormMessage, TextInput } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { AuthState } from "@/lib/account/auth-state";
import { resetPassword } from "./actions";

export function ResetForm() {
  const [state, action] = useActionState<AuthState, FormData>(resetPassword, null);
  return (
    <form action={action} className="space-y-4" noValidate>
      <TextInput
        id="password"
        name="password"
        type="password"
        label="New password"
        autoComplete="new-password"
        required
        minLength={8}
        hint="At least 8 characters."
        error={state?.fieldErrors?.password}
      />
      <TextInput
        id="confirm"
        name="confirm"
        type="password"
        label="Confirm new password"
        autoComplete="new-password"
        required
        error={state?.fieldErrors?.confirm}
      />
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingText="Saving…">
        Save new password
      </SubmitButton>
    </form>
  );
}
