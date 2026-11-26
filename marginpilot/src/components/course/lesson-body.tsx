import type { ReactNode } from "react";
import { parseLessonBody, type Inline } from "@/lib/course/markdown";

/**
 * Renders an admin-written lesson body from the markdown-lite tree. Every string is
 * rendered as a React text node (escaped); there is no raw HTML path.
 */

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case "strong":
        return <strong key={i}>{n.value}</strong>;
      case "em":
        return <em key={i}>{n.value}</em>;
      case "code":
        return (
          <code key={i} className="rounded bg-paper px-1 py-0.5 font-mono text-[0.9em]">
            {n.value}
          </code>
        );
      case "link": {
        const external = /^https?:/.test(n.href);
        return (
          <a
            key={i}
            href={n.href}
            className="font-medium text-accent underline underline-offset-2 hover:text-accent-strong"
            {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
          >
            {n.value}
            {external && <span className="sr-only"> (opens in a new tab)</span>}
          </a>
        );
      }
      default:
        return <span key={i}>{n.value}</span>;
    }
  });
}

export function LessonBody({ body }: { body: string | null }) {
  const blocks = parseLessonBody(body);
  if (blocks.length === 0) return null;
  return (
    <div className="max-w-prose space-y-4 leading-relaxed">
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading":
            return b.level === 2 ? (
              <h2 key={i} className="pt-2 text-xl font-semibold">
                {renderInline(b.content)}
              </h2>
            ) : (
              <h3 key={i} className="pt-1 text-lg font-semibold">
                {renderInline(b.content)}
              </h3>
            );
          case "quote":
            return (
              <blockquote key={i} className="border-l-4 border-line pl-4 text-ink-muted">
                {renderInline(b.content)}
              </blockquote>
            );
          case "list": {
            const items = b.items.map((item, j) => <li key={j}>{renderInline(item)}</li>);
            return b.ordered ? (
              <ol key={i} className="list-decimal space-y-1 pl-6">
                {items}
              </ol>
            ) : (
              <ul key={i} className="list-disc space-y-1 pl-6">
                {items}
              </ul>
            );
          }
          default:
            return <p key={i}>{renderInline(b.content)}</p>;
        }
      })}
    </div>
  );
}
