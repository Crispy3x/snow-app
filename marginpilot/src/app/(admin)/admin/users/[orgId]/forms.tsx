"use client";

import { useActionState } from "react";
import { FormMessage, Select, TextInput, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { grantCredits, setCreditOverride, setPlanOverride, setUserAdmin } from "../actions";

const PLAN_OPTIONS = [
  { value: "none", label: "No plan" },
  { value: "starter", label: "Starter" },
  { value: "professional", label: "Professional" },
  { value: "mentorship", label: "Mentorship" },
];

export function PlanForm({ orgId, plan }: { orgId: string; plan: string }) {
  const [state, action] = useActionState<ActionState, FormData>(setPlanOverride, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="orgId" value={orgId} />
      <Select id="plan" label="Plan (manual override)" defaultValue={plan} options={PLAN_OPTIONS} error={state?.fieldErrors?.plan} />
      <TextInput
        id="plan-note"
        name="note"
        label="Reason"
        hint="Saved to the audit log, for example: comped for beta feedback."
        required
        maxLength={300}
        error={state?.fieldErrors?.note}
      />
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…">Override plan</SubmitButton>
    </form>
  );
}

export function GrantForm({ orgId }: { orgId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(grantCredits, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="orgId" value={orgId} />
      <TextInput
        id="grant-amount"
        name="amount"
        type="number"
        inputMode="numeric"
        min={1}
        max={100000}
        step={1}
        required
        label="Credits to grant this month"
        error={state?.fieldErrors?.amount}
      />
      <TextInput id="grant-note" name="note" label="Note (optional)" maxLength={300} />
      <FormMessage state={state} />
      <SubmitButton pendingText="Granting…">Grant credits</SubmitButton>
    </form>
  );
}

export function OverrideForm({ orgId, value }: { orgId: string; value: number | null }) {
  const [state, action] = useActionState<ActionState, FormData>(setCreditOverride, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="orgId" value={orgId} />
      <TextInput
        id="override-value"
        name="value"
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        defaultValue={value ?? ""}
        label="Extra credits every month"
        hint="Added to the plan allowance each month. Leave empty to remove."
        error={state?.fieldErrors?.value}
      />
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingText="Saving…">
        Save extra monthly credits
      </SubmitButton>
    </form>
  );
}

export function AdminToggle({ orgId, userId, isAdmin, email }: { orgId: string; userId: string; isAdmin: boolean; email: string }) {
  const [state, action] = useActionState<ActionState, FormData>(setUserAdmin, null);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="makeAdmin" value={isAdmin ? "false" : "true"} />
      <SubmitButton variant="secondary" pendingText="Saving…" aria-label={`${isAdmin ? "Remove admin access from" : "Make admin:"} ${email}`}>
        {isAdmin ? "Remove admin" : "Make admin"}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
