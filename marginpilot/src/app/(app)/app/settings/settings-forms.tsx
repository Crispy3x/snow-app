"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FormMessage, TextInput, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { changePassword, deleteAccount, renameWorkspace, updateProfile } from "./actions";

export function ProfileForm({ fullName, email }: { fullName: string; email: string }) {
  const [state, action] = useActionState<ActionState, FormData>(updateProfile, null);
  return (
    <form action={action} className="max-w-md space-y-4">
      <TextInput id="fullName" name="fullName" label="Full name" autoComplete="name" required maxLength={120} defaultValue={fullName} error={state?.fieldErrors?.fullName} />
      <TextInput id="email" label="Email" type="email" value={email} readOnly disabled hint="Contact support to change the email you sign in with." />
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…">Save name</SubmitButton>
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState<ActionState, FormData>(changePassword, null);
  return (
    <form action={action} className="max-w-md space-y-4" key={state?.ok ? "done" : "form"}>
      <TextInput id="current" name="current" type="password" label="Current password" autoComplete="current-password" required error={state?.fieldErrors?.current} />
      <TextInput
        id="new-password"
        name="password"
        type="password"
        label="New password"
        autoComplete="new-password"
        required
        minLength={8}
        hint="At least 8 characters."
        error={state?.fieldErrors?.password}
      />
      <TextInput id="confirm-password" name="confirm" type="password" label="Confirm new password" autoComplete="new-password" required error={state?.fieldErrors?.confirm} />
      <FormMessage state={state} />
      <SubmitButton pendingText="Changing…">Change password</SubmitButton>
    </form>
  );
}

export function WorkspaceForm({ name }: { name: string }) {
  const [state, action] = useActionState<ActionState, FormData>(renameWorkspace, null);
  return (
    <form action={action} className="max-w-md space-y-4">
      <TextInput id="workspaceName" name="workspaceName" label="Workspace name" required maxLength={120} defaultValue={name} error={state?.fieldErrors?.workspaceName} />
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…">Save workspace name</SubmitButton>
    </form>
  );
}

export function DeleteAccountForm() {
  const [state, action] = useActionState<ActionState, FormData>(deleteAccount, null);
  return (
    <form action={action} className="max-w-md space-y-4">
      <TextInput
        id="confirm-delete"
        name="confirm"
        label={
          <>
            Type <span className="font-mono font-semibold">DELETE</span> to confirm
          </>
        }
        autoComplete="off"
        spellCheck={false}
        required
        error={state?.fieldErrors?.confirm}
      />
      <FormMessage state={state} />
      <DangerSubmit />
    </form>
  );
}

/** Red submit button (the shared kit has no destructive variant). */
function DangerSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-10 items-center justify-center rounded-md bg-danger px-4 text-sm font-semibold text-white transition-colors hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Deleting…" : "Delete my account"}
    </button>
  );
}
