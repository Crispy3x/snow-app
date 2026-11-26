"use client";

import { useActionState } from "react";
import { FormMessage, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { acceptInvitation } from "./actions";

export function AcceptForm({ token, orgName }: { token: string; orgName: string }) {
  const [state, action] = useActionState<ActionState, FormData>(acceptInvitation, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <FormMessage state={state} />
      <SubmitButton className="w-full" size="lg" pendingText="Joining…">
        Join {orgName}
      </SubmitButton>
    </form>
  );
}
