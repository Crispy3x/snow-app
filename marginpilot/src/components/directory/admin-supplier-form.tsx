"use client";

import { useActionState } from "react";
import { Checkbox, FormMessage, Select, TextArea, TextInput, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { CONTACT_LABEL, CONTACT_METHODS, type DirectorySupplier } from "@/lib/directory/types";
import { saveDirectorySupplier } from "@/app/(admin)/admin/directory/actions";

const CONTACT_HINT: Record<string, string> = {
  email: "e.g. wholesale@supplier-domain.com",
  phone: "With country code, e.g. +1 555 010 0000",
  whatsapp: "Number with country code",
  telegram: "@username or https://t.me/username",
  portal: "Address of their wholesale sign-up or login page",
};

/** Create (no supplier) or edit a directory entry. Every field is typed in by an admin. */
export function AdminSupplierForm({ supplier, today }: { supplier?: DirectorySupplier; today: string }) {
  const [state, action] = useActionState<ActionState, FormData>(saveDirectorySupplier, null);
  const fe = state?.fieldErrors ?? {};
  const s = supplier;
  return (
    <form action={action} className="grid gap-6" noValidate>
      {s && <input type="hidden" name="id" value={s.id} />}

      <fieldset className="grid gap-4">
        <legend className="mb-2 font-display text-lg font-semibold">Supplier</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput id="name" label="Name" required maxLength={120} defaultValue={s?.name} error={fe.name} />
          <TextInput
            id="website"
            label="Website"
            defaultValue={s?.website ?? ""}
            error={fe.website}
            hint="The supplier's own site. Retail stores and marketplaces are rejected."
            inputMode="url"
          />
        </div>
        <TextInput
          id="categories"
          label="Categories"
          defaultValue={s?.categories.join(", ") ?? ""}
          error={fe.categories}
          hint="Comma-separated, e.g. Home & Kitchen, Pet supplies. Sellers filter by these."
        />
        <TextArea id="description" label="Description" defaultValue={s?.description ?? ""} error={fe.description} rows={4} maxLength={2000} />
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-2 font-display text-lg font-semibold">Contact (shown only to entitled plans)</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            id="contact_method"
            label="Contact method"
            defaultValue={s?.contact_method ?? "email"}
            error={fe.contact_method}
            options={CONTACT_METHODS.map((m) => ({ value: m, label: CONTACT_LABEL[m] }))}
          />
          <TextInput
            id="contact_value"
            label="Contact details"
            required
            defaultValue={s?.contact_value ?? ""}
            error={fe.contact_value}
            hint={Object.values(CONTACT_HINT).join(" · ")}
          />
        </div>
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-2 font-display text-lg font-semibold">Shipping</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <TextInput id="ships_from" label="Ships from" defaultValue={s?.ships_from ?? ""} error={fe.ships_from} hint="Country or region" />
          <TextInput
            id="typical_handling_days"
            label="Typical handling (business days)"
            inputMode="numeric"
            defaultValue={s?.typical_handling_days ?? ""}
            error={fe.typical_handling_days}
          />
          <TextInput
            id="typical_delivery_days"
            label="Typical delivery (days)"
            inputMode="numeric"
            defaultValue={s?.typical_delivery_days ?? ""}
            error={fe.typical_delivery_days}
          />
          <TextInput id="min_order" label="Minimum order" defaultValue={s?.min_order ?? ""} error={fe.min_order} hint='e.g. "None" or "$100 first order"' />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Checkbox id="us_warehouse" label="Has a US warehouse" defaultChecked={s?.us_warehouse} />
          <Checkbox id="accepts_dropship" label="Accepts drop shipping orders" defaultChecked={s?.accepts_dropship} />
          <Checkbox id="blind_shipping" label="Blind shipping (no supplier branding or invoice in the box)" defaultChecked={s?.blind_shipping} />
          <Checkbox id="provides_tracking" label="Provides tracking numbers" defaultChecked={s?.provides_tracking} />
          <Checkbox id="csv_feed_available" label="Provides a CSV price list or feed" defaultChecked={s?.csv_feed_available} />
        </div>
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-2 font-display text-lg font-semibold">Review</legend>
        <TextArea
          id="notes"
          label="Notes for sellers"
          defaultValue={s?.notes ?? ""}
          error={fe.notes}
          rows={4}
          maxLength={4000}
          hint="What you checked and anything sellers should know. Shown on the supplier page."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            id="verified_on"
            type="date"
            label="Verified on"
            max={today}
            defaultValue={s?.verified_on ?? ""}
            error={fe.verified_on}
            hint="The date you confirmed this is a wholesale supplier and the details are current. Required to publish."
          />
          <Select
            id="status"
            label="Status"
            defaultValue={s?.status ?? "draft"}
            error={fe.status}
            options={[
              { value: "draft", label: "Draft (hidden)" },
              { value: "published", label: "Published" },
              { value: "archived", label: "Archived (hidden)" },
            ]}
          />
        </div>
      </fieldset>

      <FormMessage state={state} />
      <div>
        <SubmitButton pendingText="Saving…">{s ? "Save changes" : "Create supplier"}</SubmitButton>
      </div>
    </form>
  );
}
