"use client";

import { useActionState, type ReactNode } from "react";
import { FormMessage, type ActionState } from "@/components/ui/form";

/**
 * A <form> bound to a server action that returns ActionState, with the result
 * message rendered in place. Buttons can pass name="intent" value="..." to
 * tell the action which row or operation was chosen.
 */
export function ActionForm({
  action,
  children,
  className = "",
  messageFirst = false,
  "aria-label": ariaLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  messageFirst?: boolean;
  "aria-label"?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className={className} aria-label={ariaLabel}>
      {messageFirst && (
        <div aria-live="polite" className={state?.message ? "mb-4" : ""}>
          <FormMessage state={state} />
        </div>
      )}
      {children}
      {!messageFirst && (
        <div aria-live="polite" className={state?.message ? "mt-3" : ""}>
          <FormMessage state={state} />
        </div>
      )}
    </form>
  );
}
