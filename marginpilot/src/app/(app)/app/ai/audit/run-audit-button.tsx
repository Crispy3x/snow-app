"use client";

import { useActionState } from "react";
import { FormMessage, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { requestAudit } from "./actions";

export function RunAuditButton({ disabled }: { disabled?: boolean }) {
  const [state, action] = useActionState<ActionState>(requestAudit, null);
  return (
    <form action={action} className="grid gap-2">
      <div>
        <SubmitButton pendingText="Starting…" disabled={disabled}>
          {disabled ? "Audit running…" : "Run audit"}
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
