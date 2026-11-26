"use client";

import { useActionState } from "react";
import { FormMessage, TextInput, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { renameStore } from "./actions";

export function RenameForm({ storeId, label }: { storeId: string; label: string }) {
  const [state, action] = useActionState<ActionState, FormData>(renameStore, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="storeId" value={storeId} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <TextInput
          id={`label-${storeId}`}
          name="label"
          label="Store name in MarginPilot"
          defaultValue={label}
          maxLength={60}
          required
          fieldClassName="flex-1"
          error={state?.ok ? undefined : state?.fieldErrors?.label}
        />
        <SubmitButton variant="secondary" pendingText="Saving…">
          Save name
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
