"use client";

import { useActionState } from "react";
import { FormMessage, TextInput, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateScreenshotDetails } from "../../actions";

export type ScreenshotDetails = {
  id: string;
  caption: string;
  store_label: string;
  range_start: string;
  range_end: string;
  captured_on: string;
};

export function DetailsForm({ shot, today }: { shot: ScreenshotDetails; today: string }) {
  const [state, action] = useActionState<ActionState, FormData>(updateScreenshotDetails, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={shot.id} />
      <TextInput id="d-caption" name="caption" label="Caption" required maxLength={200} defaultValue={shot.caption} error={fe.caption} />
      <TextInput id="d-store" name="store_label" label="Store label" required maxLength={80} defaultValue={shot.store_label} error={fe.store_label} />
      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <legend className="mb-1 text-sm font-medium">Date range shown</legend>
        <TextInput id="d-start" name="range_start" type="date" label="From" required max={today} defaultValue={shot.range_start} error={fe.range_start} />
        <TextInput id="d-end" name="range_end" type="date" label="To" required max={today} defaultValue={shot.range_end} error={fe.range_end} />
      </fieldset>
      <TextInput id="d-captured" name="captured_on" type="date" label="Date captured" required max={today} defaultValue={shot.captured_on} error={fe.captured_on} />
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingText="Saving…">
        Save details
      </SubmitButton>
    </form>
  );
}
