"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { Checkbox, FormMessage, TextArea, TextInput, type ActionState } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { PhotoField, usePhoto } from "@/components/proof/photo-field";
import { createTestimonial, updateTestimonial } from "./actions";

export type TestimonialValues = {
  id: string;
  name: string;
  quote: string;
  store_type: string;
  given_on: string;
  permission_given: boolean;
  has_photo: boolean;
  status: string;
};

export function TestimonialForm({ initial, today }: { initial?: TestimonialValues; today: string }) {
  const photo = usePhoto();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(initial ? updateTestimonial : createTestimonial, null);
  const p = initial ? `t-${initial.id.slice(0, 8)}` : "t-new";
  const fe = state?.fieldErrors ?? {};
  const formRef = useRef<HTMLFormElement>(null);
  const { reset } = photo;

  // A new testimonial was added: clear the form for the next one.
  useEffect(() => {
    if (state?.ok && !initial) {
      formRef.current?.reset();
      reset();
    }
  }, [state, initial, reset]);

  return (
    <form
      ref={formRef}
      // onSubmit (not action=) so the fields keep their values when there's an error.
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        photo.apply(fd);
        startTransition(() => formAction(fd));
      }}
      className="space-y-4"
    >
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <TextInput id={`${p}-name`} name="name" label="Name as it will be shown" required maxLength={80} defaultValue={initial?.name} error={fe.name} />
      <TextArea id={`${p}-quote`} name="quote" label="Quote" required rows={4} maxLength={1000} defaultValue={initial?.quote} error={fe.quote} hint="Their words. Don't add revenue figures they didn't state." />
      <TextInput id={`${p}-store-type`} name="store_type" label="Store type" hint="For example: home goods, auto parts." required maxLength={80} defaultValue={initial?.store_type} error={fe.store_type} />
      <TextInput id={`${p}-given-on`} name="given_on" type="date" label="Date given" required max={today} defaultValue={initial?.given_on ?? today} error={fe.given_on} />
      <PhotoField id={`${p}-photo`} photo={photo} serverError={fe.photo} hint={initial?.has_photo ? "Choosing a file replaces the current photo." : "Only with the person's permission."} />
      {initial?.has_photo && <Checkbox id={`${p}-remove-photo`} name="remove_photo" label="Remove the current photo" />}
      <Checkbox
        id={`${p}-permission`}
        name="permission_given"
        label="This person gave written permission to show their name, quote and photo publicly"
        hint="Required before approval. Unticking it on a published testimonial takes it down."
        defaultChecked={initial?.permission_given ?? false}
        error={fe.permission_given}
      />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} aria-disabled={pending}>
        {pending ? "Saving…" : initial ? "Save changes" : "Add to review queue"}
      </Button>
    </form>
  );
}
