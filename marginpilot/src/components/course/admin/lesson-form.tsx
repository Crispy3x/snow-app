"use client";

import { useActionState, useState } from "react";
import { Checkbox, FormMessage, Select, TextArea, TextInput, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { slugify } from "@/lib/course/slug";
import { formatDuration } from "@/lib/course/video";

type SaveLesson = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export type LessonFormValues = {
  id: string;
  module_id: string;
  title: string;
  slug: string;
  summary: string | null;
  body: string | null;
  video_provider: string | null;
  video_ref: string | null;
  duration_seconds: number | null;
  captions_label: string | null;
  is_preview: boolean;
  is_published: boolean;
};

const PROVIDER_OPTIONS = [
  { value: "", label: "No video" },
  { value: "youtube", label: "YouTube" },
  { value: "vimeo", label: "Vimeo" },
  { value: "mux", label: "Mux" },
  { value: "storage", label: "Uploaded file (storage)" },
];

const REF_HINT: Record<string, string> = {
  youtube: "A YouTube link or the 11-character video ID. Use an unlisted video.",
  vimeo: "A Vimeo link or numeric ID. For unlisted videos include the hash (123456789/abcdef1234).",
  mux: "The Mux playback ID. Signed playback is used automatically when the Mux signing key is configured.",
  storage: "Path in the course-resources bucket. Easier: save, then use “Upload video file” below.",
};

export function LessonForm({
  action,
  modules,
  lesson,
  defaultModuleId,
}: {
  action: SaveLesson;
  modules: { id: string; title: string }[];
  lesson?: LessonFormValues;
  defaultModuleId?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const [title, setTitle] = useState(lesson?.title ?? "");
  const [slug, setSlug] = useState(lesson?.slug ?? "");
  const [provider, setProvider] = useState(lesson?.video_provider ?? "");
  const errors = state?.fieldErrors ?? {};
  const autoSlug = title.trim() ? slugify(title) : "";

  return (
    <form action={formAction} className="space-y-5">
      {lesson && <input type="hidden" name="id" value={lesson.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          id="lesson-title"
          name="title"
          label="Title"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={errors.title}
        />
        <TextInput
          id="lesson-slug"
          name="slug"
          label="URL slug"
          maxLength={80}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder={autoSlug}
          hint={slug ? `URL: /app/course/${slug}` : `Leave blank to use “${autoSlug || "generated from the title"}”.`}
          error={errors.slug}
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>

      <Select
        id="lesson-module"
        name="moduleId"
        label="Module"
        defaultValue={lesson?.module_id ?? defaultModuleId ?? modules[0]?.id}
        options={modules.map((m, i) => ({ value: m.id, label: `Module ${i + 1}: ${m.title}` }))}
        hint={lesson ? "Changing the module moves the lesson to the end of that module." : undefined}
        error={errors.moduleId}
      />

      <TextArea
        id="lesson-summary"
        name="summary"
        label="Summary"
        hint="Shown under the lesson title, including to people without course access."
        rows={2}
        maxLength={1000}
        defaultValue={lesson?.summary ?? ""}
        error={errors.summary}
      />

      <TextArea
        id="lesson-body"
        name="body"
        label="Lesson text"
        hint="Plain text. Blank lines start new paragraphs. Supports ## headings, - lists, 1. lists, > quotes, **bold**, *italic*, `code` and [links](https://example.com). HTML is shown as text."
        rows={12}
        defaultValue={lesson?.body ?? ""}
        error={errors.body}
      />

      <fieldset className="space-y-4 rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-semibold">Video</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            id="lesson-provider"
            name="provider"
            label="Video source"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            options={PROVIDER_OPTIONS}
            error={errors.provider}
          />
          <TextInput
            id="lesson-duration"
            name="duration"
            label="Duration"
            placeholder="12:30"
            inputMode="numeric"
            defaultValue={formatDuration(lesson?.duration_seconds) ?? ""}
            hint="Minutes:seconds, or hours:minutes:seconds."
            error={errors.duration}
          />
        </div>
        {provider && (
          <TextInput
            id="lesson-video-ref"
            name="videoRef"
            label={provider === "mux" ? "Playback ID" : provider === "storage" ? "Storage path" : "Video link or ID"}
            defaultValue={lesson?.video_ref ?? ""}
            hint={REF_HINT[provider]}
            error={errors.videoRef}
            autoCapitalize="none"
            spellCheck={false}
          />
        )}
        {provider === "storage" && (
          <TextInput
            id="lesson-captions-label"
            name="captionsLabel"
            label="Captions label"
            placeholder="English"
            maxLength={60}
            defaultValue={lesson?.captions_label ?? ""}
            hint="Name of the captions track in the player. Upload the .vtt file below."
            error={errors.captionsLabel}
          />
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Visibility</legend>
        <Checkbox
          id="lesson-preview"
          name="isPreview"
          label="Free preview"
          hint="Anyone signed in can watch this lesson, even without the course."
          defaultChecked={lesson?.is_preview ?? false}
          error={errors.isPreview}
        />
        <Checkbox
          id="lesson-published"
          name="isPublished"
          label="Published"
          hint="Unpublished lessons are hidden from customers."
          defaultChecked={lesson?.is_published ?? false}
          error={errors.isPublished}
        />
      </fieldset>

      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…">{lesson ? "Save lesson" : "Create lesson"}</SubmitButton>
    </form>
  );
}
