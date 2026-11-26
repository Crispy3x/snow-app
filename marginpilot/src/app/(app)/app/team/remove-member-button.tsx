"use client";

import { useActionState } from "react";
import type { ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { removeMember } from "./actions";

export function RemoveMemberButton({ userId, name, self }: { userId: string; name: string; self: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(removeMember, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const q = self ? "Leave this workspace? You'll lose access to its stores." : `Remove ${name} from this workspace?`;
        if (!window.confirm(q)) e.preventDefault();
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <SubmitButton variant="ghost" pendingText={self ? "Leaving…" : "Removing…"} aria-label={self ? "Leave workspace" : `Remove ${name}`}>
        {self ? "Leave" : "Remove"}
      </SubmitButton>
      {state?.message && (
        <p role={state.ok ? "status" : "alert"} className={`mt-1 text-sm ${state.ok ? "text-accent-strong" : "text-danger"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
