"use client";

import { useActionState } from "react";
import { Checkbox, FormMessage, TextArea, TextInput, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveFlag } from "./actions";

export type FlagFormValues = { key: string; description: string | null; enabled: boolean; org_allowlist: string[] };

/** Create (no initial value) or edit a flag. Field ids are prefixed so several forms can share a page. */
export function FlagForm({ flag }: { flag?: FlagFormValues }) {
  const [state, action] = useActionState<ActionState, FormData>(saveFlag, null);
  const p = flag ? `flag-${flag.key}` : "new-flag";
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="mode" value={flag ? "update" : "create"} />
      {flag ? (
        <input type="hidden" name="key" value={flag.key} />
      ) : (
        <TextInput
          id={`${p}-key`}
          name="key"
          label="Key"
          hint="Used in code: isFeatureEnabled(&quot;key&quot;, orgId). Lowercase, e.g. bulk_lister.v2"
          required
          autoComplete="off"
          spellCheck={false}
          error={state?.fieldErrors?.key}
        />
      )}
      <TextInput
        id={`${p}-description`}
        name="description"
        label="Description"
        defaultValue={flag?.description ?? ""}
        maxLength={300}
        error={state?.fieldErrors?.description}
      />
      <Checkbox id={`${p}-enabled`} name="enabled" label="On for everyone" defaultChecked={flag?.enabled ?? false} />
      <TextArea
        id={`${p}-allowlist`}
        name="allowlist"
        label="Workspace allowlist"
        hint="Workspace IDs that get the feature even while it's off for everyone. One per line or comma-separated. Copy IDs from Users and plans."
        rows={3}
        defaultValue={flag?.org_allowlist.join("\n") ?? ""}
        spellCheck={false}
        className="font-mono text-xs"
        error={state?.fieldErrors?.allowlist}
      />
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…">{flag ? "Save flag" : "Create flag"}</SubmitButton>
    </form>
  );
}
