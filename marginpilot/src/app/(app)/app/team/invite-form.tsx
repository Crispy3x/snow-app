"use client";

import { useActionState, useState } from "react";
import { FormMessage, Select, TextInput } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { inviteMember, type InviteState } from "./actions";

export function InviteForm() {
  const [state, action] = useActionState<InviteState, FormData>(inviteMember, null);
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-start" noValidate>
        <TextInput id="invite-email" name="email" type="email" label="Email" autoComplete="off" required error={state?.fieldErrors?.email} />
        <Select
          id="invite-role"
          name="role"
          label="Role"
          defaultValue="member"
          options={[
            { value: "member", label: "Member" },
            { value: "admin", label: "Admin (can invite and manage billing)" },
          ]}
          error={state?.fieldErrors?.role}
        />
        <div className="sm:pt-6">
          <SubmitButton pendingText="Inviting…" className="w-full sm:w-auto">
            Send invite
          </SubmitButton>
        </div>
      </form>
      <FormMessage state={state} />
      {state?.link && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <TextInput
            id="invite-link"
            label="Invitation link"
            readOnly
            value={state.link}
            fieldClassName="flex-1"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(state.link!);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      )}
    </div>
  );
}
