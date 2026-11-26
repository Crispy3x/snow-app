"use client";

import { useActionState, useState } from "react";
import { Select, TextArea, TextInput, type ActionState } from "@/components/ui/form";
import { LineErrors } from "../_components/line-errors";
import { SubmitButton } from "@/components/ui/submit-button";
import { createBulkJob } from "./actions";

type SupplierOption = { id: string; name: string; adapter: string };

const radio = "h-4 w-4 accent-accent";

export function BulkForm({ suppliers, floor, storeLabel }: { suppliers: SupplierOption[]; floor: number; storeLabel: string }) {
  const [state, action] = useActionState<ActionState, FormData>(createBulkJob, null);
  const [source, setSource] = useState<"links" | "csv">("links");
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const supplier = suppliers.find((s) => s.id === supplierId);
  const fe = state?.fieldErrors ?? {};
  const placeholder =
    source === "csv"
      ? "sku,title,cost,stock,image_urls\nAB-100,Oak Spice Rack 3 Tier,12.40,25,https://…/1.jpg"
      : supplier?.adapter === "csv_feed"
        ? "csv:AB-100\ncsv:AB-101"
        : "https://mock-supplier.test/p/abc123\nmock:kitchen-42";

  return (
    <form action={action} className="grid gap-5">
      <p className="text-sm text-ink-muted">
        Adding to store: <span className="font-medium text-ink">{storeLabel}</span>
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id="supplierId"
          label="Supplier"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          error={fe.supplierId}
          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
        />
        <TextInput
          id="targetMargin"
          label="Target net margin (%)"
          type="number"
          inputMode="decimal"
          step="0.5"
          min={floor}
          max={80}
          defaultValue={floor}
          error={fe.targetMargin}
          hint={`Your store floor is ${floor}%. Prices are set at the highest ad rate your rules allow.`}
        />
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium">Input</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="radio" name="source" value="links" checked={source === "links"} onChange={() => setSource("links")} className={radio} />
            Supplier links, one per line
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="radio" name="source" value="csv" checked={source === "csv"} onChange={() => setSource("csv")} className={radio} />
            CSV rows
          </label>
        </div>
      </fieldset>

      <TextArea
        id="input"
        label={source === "csv" ? "CSV rows (with a header row)" : "Supplier links"}
        rows={10}
        placeholder={placeholder}
        error={fe.input}
        className="font-mono text-sm"
        hint={
          source === "csv"
            ? "Columns: sku, title, cost, stock, and optionally description, brand, shipping_cost, image_urls (separated by |), category. Or upload a file below."
            : "Retail store and marketplace links (Amazon, Walmart, AliExpress…) are rejected. Up to 500 per batch."
        }
      />
      {source === "csv" && <TextInput id="file" name="file" type="file" accept=".csv,text/csv" label="Or upload a CSV file" error={fe.file} hint="Up to 950 KB. A file replaces the rows pasted above." />}

      <fieldset>
        <legend className="mb-1 text-sm font-medium">When each item is ready</legend>
        <div className="grid gap-2">
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="mode" value="draft" defaultChecked className={`${radio} mt-0.5`} />
            <span>
              <span className="font-medium">Save as drafts</span>
              <span className="block text-ink-muted">Review every AI title and description before anything goes live.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="mode" value="publish" className={`${radio} mt-0.5`} />
            <span>
              <span className="font-medium">Publish to eBay</span>
              <span className="block text-ink-muted">Items that pass the margin guard and have no brand (VeRO) warning go live. Everything else stays a draft.</span>
            </span>
          </label>
        </div>
      </fieldset>

      <LineErrors state={state} />
      <div>
        <SubmitButton pendingText="Starting…">Start batch</SubmitButton>
      </div>
    </form>
  );
}

