/**
 * Course completion bar. Same look as the UI kit's Meter, but always in the accent
 * colour: Meter turns amber/red near its maximum (a usage warning), which would read
 * as a problem when someone is close to finishing the course.
 */
export function CourseProgress({ completed, total }: { completed: number; total: number }) {
  const ratio = total > 0 ? Math.min(1, completed / total) : 0;
  const label = "Lessons completed";
  return (
    <div>
      <div className="flex justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-ink-muted">
          {completed} of {total} ({Math.round(ratio * 100)}%)
        </span>
      </div>
      <div
        className="mt-1 h-2 rounded bg-line"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
        aria-valuetext={`${completed} of ${total} lessons completed`}
      >
        <div className="h-2 rounded bg-accent" style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
