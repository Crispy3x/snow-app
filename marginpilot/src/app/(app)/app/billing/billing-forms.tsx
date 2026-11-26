"use client";

import { useActionState } from "react";
import { FormMessage, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { choosePlan, openPortal } from "./actions";

export function PlanForm({
  plan,
  label,
  variant = "primary",
  confirmText,
  pendingText = "Opening checkout…",
}: {
  plan: string;
  label: string;
  pendingText?: string;
  variant?: "primary" | "secondary";
  confirmText?: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(choosePlan, null);
  return (
    <form
      action={action}
      className="space-y-2"
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      <input type="hidden" name="plan" value={plan} />
      <SubmitButton variant={variant} className="w-full" pendingText={pendingText}>
        {label}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function PortalForm() {
  const [state, action] = useActionState<ActionState>(openPortal, null);
  return (
    <form action={action} className="space-y-2">
      <SubmitButton variant="secondary" pendingText="Opening…">
        Manage billing
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
