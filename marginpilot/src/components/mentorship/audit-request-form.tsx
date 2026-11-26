"use client";

import { useActionState } from "react";
import { FormMessage, Select, TextArea, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { requestAudit } from "@/app/(app)/app/mentorship/actions";

export function AuditRequestForm({ stores, defaultStoreId }: { stores: { id: string; label: string }[]; defaultStoreId: string | null }) {
  const [state, action] = useActionState<ActionState, FormData>(requestAudit, null);
  if (state?.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="grid gap-4">
      <Select
        id="store_id"
        label="Store to audit"
        defaultValue={defaultStoreId ?? stores[0]?.id}
        options={stores.map((s) => ({ value: s.id, label: s.label }))}
        error={state?.fieldErrors?.store_id}
      />
      <TextArea
        id="seller_notes"
        label="What should we look at? (optional)"
        hint="e.g. listings that stopped selling, a category you're testing, margin questions."
        rows={4}
        maxLength={4000}
        error={state?.fieldErrors?.seller_notes}
      />
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingText="Requesting…">Request this week&apos;s audit</SubmitButton>
      </div>
    </form>
  );
}
