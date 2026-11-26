"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { Checkbox, FormMessage, TextArea, TextInput, type ActionState } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { PhotoField, usePhoto } from "@/components/proof/photo-field";
import { submitTestimonial } from "./actions";

export function TestimonialSubmitForm({ today, defaultName }: { today: string; defaultName: string }) {
  const photo = usePhoto();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(submitTestimonial, null);
  const formRef = useRef<HTMLFormElement>(null);
  const { reset } = photo;
  const fe = state?.fieldErrors ?? {};

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      reset();
    }
  }, [state, reset]);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        photo.apply(fd);
        startTransition(() => formAction(fd));
      }}
      className="space-y-4"
    >
      <TextInput id="ts-name" name="name" label="Your name as you'd like it shown" required maxLength={80} defaultValue={defaultName} autoComplete="name" error={fe.name} hint="A first name and initial is fine." />
      <TextArea
        id="ts-quote"
        name="quote"
        label="What would you tell another seller?"
        required
        rows={5}
        maxLength={1000}
        error={fe.quote}
        hint="In your own words. Only include numbers you're happy to share and can back up."
      />
      <TextInput id="ts-store-type" name="store_type" label="What kind of store do you run?" required maxLength={80} error={fe.store_type} hint="For example: home goods, auto parts, collectibles." />
      <TextInput id="ts-date" name="given_on" type="date" label="Date" required max={today} defaultValue={today} error={fe.given_on} />
      <PhotoField id="ts-photo" photo={photo} serverError={fe.photo} hint="A photo of you, shown small next to your quote. Leave it out if you prefer." />
      <Checkbox
        id="ts-permission"
        name="permission_given"
        required
        label="I give permission for my name, quote, store type and photo (if added) to be shown publicly on this website"
        hint="Required to submit. You can withdraw it later from this page."
        error={fe.permission_given}
      />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} aria-disabled={pending}>
        {pending ? "Sending…" : "Send for review"}
      </Button>
    </form>
  );
}
