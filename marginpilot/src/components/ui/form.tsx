import type { ComponentProps, ReactNode } from "react";

/**
 * Form controls. Every input has a visible <label> tied by id; hints and errors
 * are linked with aria-describedby so screen readers announce them.
 */

const control =
  "block w-full rounded-md border border-ink/25 bg-card px-3 py-2 text-ink placeholder:text-ink-muted/80 focus:border-accent disabled:bg-paper";

export function Field({
  id,
  label,
  hint,
  error,
  children,
  className = "",
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, hint?: unknown, error?: unknown) {
  return [error ? `${id}-error` : null, hint && !error ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
}

type WithField = { id: string; label: ReactNode; hint?: ReactNode; error?: string; fieldClassName?: string };

export function TextInput({ id, label, hint, error, fieldClassName, className = "", ...props }: WithField & ComponentProps<"input">) {
  return (
    <Field id={id} label={label} hint={hint} error={error} className={fieldClassName}>
      <input
        id={id}
        name={props.name ?? id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`${control} min-h-10 ${className}`}
        {...props}
      />
    </Field>
  );
}

export function TextArea({ id, label, hint, error, fieldClassName, className = "", ...props }: WithField & ComponentProps<"textarea">) {
  return (
    <Field id={id} label={label} hint={hint} error={error} className={fieldClassName}>
      <textarea
        id={id}
        name={props.name ?? id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`${control} ${className}`}
        rows={props.rows ?? 4}
        {...props}
      />
    </Field>
  );
}

export function Select({
  id,
  label,
  hint,
  error,
  fieldClassName,
  className = "",
  options,
  ...props
}: WithField & ComponentProps<"select"> & { options: { value: string; label: string }[] }) {
  return (
    <Field id={id} label={label} hint={hint} error={error} className={fieldClassName}>
      <select
        id={id}
        name={props.name ?? id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`${control} min-h-10 ${className}`}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Checkbox({ id, label, hint, error, ...props }: WithField & ComponentProps<"input">) {
  return (
    <div>
      <div className="flex items-start gap-2">
        <input
          id={id}
          name={props.name ?? id}
          type="checkbox"
          aria-describedby={describedBy(id, hint, error)}
          className="mt-1 h-4 w-4 accent-accent"
          {...props}
        />
        <label htmlFor={id} className="text-sm">
          {label}
        </label>
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="ml-6 mt-1 text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="ml-6 mt-1 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Result shape every server action returns, rendered by <FormMessage>. */
export type ActionState = { ok?: boolean; message?: string; fieldErrors?: Record<string, string> } | null;

export function FormMessage({ state }: { state: ActionState }) {
  if (!state?.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={`rounded-md border px-3 py-2 text-sm ${
        state.ok ? "border-accent/30 bg-accent-soft text-accent-strong" : "border-danger/30 bg-red-50 text-danger"
      }`}
    >
      {state.message}
    </p>
  );
}
