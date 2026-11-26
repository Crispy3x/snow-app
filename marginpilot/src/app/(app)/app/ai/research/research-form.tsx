"use client";

import { useActionState } from "react";
import { FormMessage, TextInput, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { runResearch } from "./actions";

export function ResearchForm() {
  const [state, action] = useActionState<ActionState, FormData>(runResearch, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4">
      <TextInput id="query" label="Niche or keyword" placeholder="e.g. cast iron cookware accessories" required maxLength={200} error={fe.query} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextInput id="priceMin" label="Min selling price (optional)" type="number" inputMode="decimal" min={0} step="0.01" error={fe.priceMin} />
        <TextInput id="priceMax" label="Max selling price (optional)" type="number" inputMode="decimal" min={0} step="0.01" error={fe.priceMax} />
        <TextInput id="targetMargin" label="Target net margin % (optional)" type="number" inputMode="decimal" min={1} max={90} step="0.1" error={fe.targetMargin} />
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingText="Researching… this can take a minute or two">Run research</SubmitButton>
      </div>
    </form>
  );
}
