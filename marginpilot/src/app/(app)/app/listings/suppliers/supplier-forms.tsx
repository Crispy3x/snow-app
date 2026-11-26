"use client";

import { useActionState, useState } from "react";
import { Checkbox, Select, TextInput, type ActionState } from "@/components/ui/form";
import { LineErrors } from "../_components/line-errors";
import { SubmitButton } from "@/components/ui/submit-button";
import { addSupplier, uploadPriceList } from "./actions";

export function AddSupplierForm() {
  const [state, action] = useActionState<ActionState, FormData>(addSupplier, null);
  const [adapter, setAdapter] = useState("csv_feed");
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput id="name" label="Supplier name" required maxLength={80} error={fe.name} placeholder="e.g. Midwest Home Wholesale" />
        <Select
          id="adapter"
          label="Type"
          value={adapter}
          onChange={(e) => setAdapter(e.target.value)}
          error={fe.adapter}
          options={[
            { value: "csv_feed", label: "Wholesale price list (CSV)" },
            { value: "mock", label: "Mock supplier (for testing)" },
          ]}
        />
      </div>
      {adapter === "csv_feed" && (
        <TextInput
          id="file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          label="Price list (CSV)"
          error={fe.file}
          hint="Columns: sku, title, cost, stock, and optionally description, brand, shipping_cost, image_urls (separated by |), url, category. Up to 950 KB."
        />
      )}
      <Checkbox
        id="attested"
        label="I have a wholesale relationship with this supplier (an account or agreement to buy at wholesale for resale). It is not a retail store or marketplace."
        error={fe.attested}
        required
      />
      <LineErrors state={state} />
      <div>
        <SubmitButton pendingText="Adding…">Add supplier</SubmitButton>
      </div>
    </form>
  );
}

export function UploadPriceListForm({ supplierId, name }: { supplierId: string; name: string }) {
  const [state, action] = useActionState<ActionState, FormData>(uploadPriceList, null);
  const id = `file-${supplierId}`;
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="supplierId" value={supplierId} />
      <TextInput id={id} name="file" type="file" accept=".csv,text/csv" label={`New price list for ${name}`} required />
      <LineErrors state={state} />
      <div>
        <SubmitButton variant="secondary" pendingText="Uploading…">Upload and replace</SubmitButton>
      </div>
    </form>
  );
}
