"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Checkbox, FormMessage, TextArea, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { buttonClasses } from "@/components/ui/button";
import { addToMySuppliers, saveNote, type AddSupplierState } from "@/app/(app)/app/directory/actions";

export function NoteForm({ id, note }: { id: string; note: string | null }) {
  const [state, action] = useActionState<ActionState, FormData>(saveNote, null);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="id" value={id} />
      <TextArea
        id="note"
        label="Private note"
        hint="Only people in your workspace see this, e.g. your account number, rep name or terms."
        defaultValue={note ?? ""}
        maxLength={4000}
        rows={4}
        error={state?.fieldErrors?.note}
      />
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingText="Saving…">Save note</SubmitButton>
      </div>
    </form>
  );
}

export function AddToSuppliersForm({ id, name, linkedSupplierId }: { id: string; name: string; linkedSupplierId: string | null }) {
  const [state, action] = useActionState<AddSupplierState, FormData>(addToMySuppliers, null);
  const added = linkedSupplierId ?? (state?.ok ? state.supplierId : null);
  if (added) {
    return (
      <div className="grid gap-3">
        {state?.message && <FormMessage state={state} />}
        {!state?.message && <p className="text-sm">{name} is in your suppliers.</p>}
        <p className="text-sm text-ink-muted">
          Next: get your wholesale price list from {name} as a CSV and upload it on the Suppliers page.
        </p>
        <div>
          <Link href="/app/listings/suppliers" className={buttonClasses("primary")}>
            Upload their price list
          </Link>
        </div>
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="id" value={id} />
      <Checkbox
        id="attested"
        label={`I have, or am opening, a wholesale account with ${name} to buy at wholesale for resale. I won't buy from a retail store or marketplace to ship to my buyers.`}
        required
        error={state?.fieldErrors?.attested}
      />
      {state && !state.fieldErrors && <FormMessage state={state} />}
      <div>
        <SubmitButton pendingText="Adding…">Add to my suppliers</SubmitButton>
      </div>
    </form>
  );
}
