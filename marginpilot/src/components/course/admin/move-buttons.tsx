import { buttonClasses } from "@/components/ui/button";

/**
 * Keyboard-accessible reordering: two real submit buttons in one form. The clicked
 * button's name/value says the direction. Disabled at the ends of the list.
 */
export function MoveButtons({
  action,
  id,
  label,
  isFirst,
  isLast,
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
  label: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  const cls = buttonClasses("secondary", "md", "px-3");
  return (
    <form action={action} className="flex gap-1">
      <input type="hidden" name="id" value={id} />
      <button type="submit" name="direction" value="up" disabled={isFirst} className={cls}>
        Move up<span className="sr-only"> {label}</span>
      </button>
      <button type="submit" name="direction" value="down" disabled={isLast} className={cls}>
        Move down<span className="sr-only"> {label}</span>
      </button>
    </form>
  );
}
