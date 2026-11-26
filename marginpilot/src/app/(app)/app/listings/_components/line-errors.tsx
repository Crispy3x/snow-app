import { FormMessage, type ActionState } from "@/components/ui/form";

/** First line as the form message, the rest (per-line errors) as a list. */
export function LineErrors({ state }: { state: ActionState }) {
  if (!state?.message) return null;
  const [head, ...rest] = state.message.split("\n");
  return (
    <div className="grid gap-2">
      <FormMessage state={{ ...state, message: head }} />
      {rest.length > 0 && (
        <ul className="grid gap-1 rounded-md border border-danger/30 bg-red-50 p-3 text-sm text-danger">
          {rest.map((line, i) => (
            <li key={i} className="break-words">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
