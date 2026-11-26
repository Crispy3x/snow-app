"use client";

import { useActionState, useEffect, useRef } from "react";
import { FormMessage, TextArea, TextInput, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";

type SaveModule = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Create (no `module`) or edit a module's title and summary. */
export function ModuleForm({
  action,
  module,
}: {
  action: SaveModule;
  module?: { id: string; title: string; summary: string | null };
}) {
  const [state, formAction] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const prefix = module ? `module-${module.id}` : "module-new";

  useEffect(() => {
    if (state?.ok && !module) formRef.current?.reset();
  }, [state, module]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      {module && <input type="hidden" name="id" value={module.id} />}
      <TextInput
        id={`${prefix}-title`}
        name="title"
        label="Module title"
        defaultValue={module?.title}
        required
        maxLength={200}
        error={state?.fieldErrors?.title}
      />
      <TextArea
        id={`${prefix}-summary`}
        name="summary"
        label="Summary"
        hint="One or two sentences shown under the module title."
        defaultValue={module?.summary ?? ""}
        rows={2}
        maxLength={2000}
        error={state?.fieldErrors?.summary}
      />
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…">{module ? "Save module" : "Add module"}</SubmitButton>
    </form>
  );
}
