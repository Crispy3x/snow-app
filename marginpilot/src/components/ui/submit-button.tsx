"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";
import { buttonClasses } from "./button";

/** Submit button that disables itself and says so while the form's action runs. */
export function SubmitButton({
  children,
  pendingText = "Working…",
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"button"> & {
  pendingText?: string;
  variant?: Parameters<typeof buttonClasses>[0];
  size?: Parameters<typeof buttonClasses>[1];
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || props.disabled} aria-disabled={pending} className={buttonClasses(variant, size, className)} {...props}>
      {pending ? pendingText : children}
    </button>
  );
}
