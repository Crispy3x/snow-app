"use client";

import { useActionState } from "react";
import { FormMessage, Select, TextInput, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { createDefaultLocation, saveListingDefaults } from "./actions";

type Option = { value: string; label: string };

export function ListingDefaultsForm({
  storeId,
  canEdit,
  fulfillment,
  payment,
  returns,
  locations,
  current,
}: {
  storeId: string;
  canEdit: boolean;
  fulfillment: Option[];
  payment: Option[];
  returns: Option[];
  locations: Option[];
  current: { fulfillment_policy_id: string | null; payment_policy_id: string | null; return_policy_id: string | null; merchant_location_key: string | null };
}) {
  const [state, action] = useActionState<ActionState, FormData>(saveListingDefaults.bind(null, storeId), null);
  const none = (what: string) => [{ value: "", label: `Choose a ${what}` }];
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
        <Select id="fulfillment_policy_id" label="Shipping (fulfillment) policy" defaultValue={current.fulfillment_policy_id ?? ""}
          options={[...none("shipping policy"), ...fulfillment]} />
        <Select id="payment_policy_id" label="Payment policy" defaultValue={current.payment_policy_id ?? ""} options={[...none("payment policy"), ...payment]} />
        <Select id="return_policy_id" label="Return policy" defaultValue={current.return_policy_id ?? ""} options={[...none("return policy"), ...returns]} />
        <Select id="merchant_location_key" label="Ship-from location" defaultValue={current.merchant_location_key ?? ""}
          options={[...none("location"), ...locations]} hint="eBay requires a location on every listing." />
      </fieldset>
      <FormMessage state={state} />
      {canEdit && <SubmitButton pendingText="Saving…">Save listing defaults</SubmitButton>}
    </form>
  );
}

export function CreateLocationForm({ storeId }: { storeId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(createDefaultLocation.bind(null, storeId), null);
  const fe = state?.ok ? {} : (state?.fieldErrors ?? {});
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <TextInput id="postal_code" label="Ship-from postal code" required maxLength={12} autoComplete="postal-code" error={fe.postal_code}
          hint="Usually your supplier's warehouse." />
        <Select id="country" label="Country" defaultValue="US" error={fe.country}
          options={[
            { value: "US", label: "United States" },
            { value: "CA", label: "Canada" },
            { value: "GB", label: "United Kingdom" },
            { value: "AU", label: "Australia" },
            { value: "DE", label: "Germany" },
            { value: "FR", label: "France" },
            { value: "IT", label: "Italy" },
            { value: "ES", label: "Spain" },
          ]} />
        <SubmitButton variant="secondary" pendingText="Creating…">Create default location</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
