"use client";

import { useActionState } from "react";
import { FormMessage, TextInput } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { AuthState } from "@/lib/account/auth-state";
import { requestPasswordReset } from "./actions";

export function ForgotForm() {
  const [state, action] = useActionState<AuthState, FormData>(requestPasswordReset, null);
  return (
    <form action={action} className="space-y-4" noValidate>
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
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingText="Sending…">
        Email me a reset link
      </SubmitButton>
    </form>
  );
}
