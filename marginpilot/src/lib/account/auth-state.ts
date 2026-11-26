import type { ActionState } from "@/components/ui/form";

/** ActionState plus an optional machine-readable code (e.g. "email_not_confirmed") and echoed email. */
export type AuthState = (NonNullable<ActionState> & { code?: string; email?: string }) | null;

/** First issue per field from a zod error, in the shape FormMessage/TextInput expect. */
export function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? "form");
    out[k] ??= i.message;
  }
  return out;
}
