"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { FormMessage, TextInput } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import type { AuthState } from "@/lib/account/auth-state";
import { login, resendConfirmation, sendMagicLink } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [state, action] = useActionState<AuthState, FormData>(login, null);
  const [magicState, magicAction] = useActionState<AuthState, FormData>(sendMagicLink, null);
  const [resendState, resendAction] = useActionState<AuthState, FormData>(resendConfirmation, null);

  if (mode === "magic") {
    return (
      <div className="space-y-4">
        <form action={magicAction} className="space-y-4" noValidate>
          <input type="hidden" name="next" value={next} />
          <TextInput
            id="magic-email"
            name="email"
            type="email"
            label="Email"
            autoComplete="email"
            required
            defaultValue={magicState?.email ?? state?.email}
            error={magicState?.fieldErrors?.email}
            hint="We'll email you a one-time sign-in link."
          />
          <FormMessage state={magicState} />
          <SubmitButton className="w-full" pendingText="Sending link…">
            Email me a sign-in link
          </SubmitButton>
        </form>
        <Button variant="ghost" className="w-full" onClick={() => setMode("password")}>
          Use my password instead
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4" noValidate>
        <input type="hidden" name="next" value={next} />
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
        <div>
          <TextInput
            id="password"
            name="password"
            type="password"
            label="Password"
            autoComplete="current-password"
            required
            error={state?.fieldErrors?.password}
          />
          <p className="mt-2 text-right text-sm">
            <Link href="/forgot-password" className="font-medium text-accent underline underline-offset-2 hover:text-accent-strong">
              Forgot your password?
            </Link>
          </p>
        </div>
        <FormMessage state={state} />
        <SubmitButton className="w-full" pendingText="Signing in…">
          Log in
        </SubmitButton>
      </form>

      {state?.code === "email_not_confirmed" && (
        <form action={resendAction} className="space-y-3 rounded-md border border-line bg-paper p-4">
          <input type="hidden" name="email" value={state.email ?? ""} />
          <input type="hidden" name="next" value={next} />
          <p className="text-sm">Didn&rsquo;t get the email? Check spam, or send a new link to {state.email}.</p>
          <FormMessage state={resendState} />
          <SubmitButton variant="secondary" pendingText="Sending…">
            Resend confirmation email
          </SubmitButton>
        </form>
      )}

      <div className="flex items-center gap-3 text-sm text-ink-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      <Button variant="secondary" className="w-full" onClick={() => setMode("magic")}>
        Email me a sign-in link
      </Button>
    </div>
  );
}
