/**
 * Markdown-lite for lesson bodies. Parses to a small tree that React renders
 * as text nodes, so nothing is ever injected as HTML. Supported:
 *   blank-line separated paragraphs, "## " / "### " headings, "- " / "* " lists,
 *   "1. " lists, "> " quotes, **bold**, *italic*, `code`, [text](https://link).
 */

export type Inline =
  | { type: "text"; value: string }
  | { type: "strong"; value: string }
  | { type: "em"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; value: string; href: string };

export type Block =
  | { type: "heading"; level: 2 | 3; content: Inline[] }
  | { type: "paragraph"; content: Inline[] }
  | { type: "quote"; content: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] };

/** Only absolute http(s) links and in-app paths are allowed. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^\/(?!\/)[^\s]*$/.test(h)) return h;
  try {
    const url = new URL(h);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const INLINE = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s][^*]*)\*)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const index = m.index ?? 0;
    if (index > last) out.push({ type: "text", value: text.slice(last, index) });
    if (m[2] !== undefined) out.push({ type: "strong", value: m[2] });
    else if (m[3] !== undefined) out.push({ type: "code", value: m[3] });
    else if (m[4] !== undefined) {
      const href = safeHref(m[5]);
      out.push(href ? { type: "link", value: m[4], href } : { type: "text", value: m[4] });
    } else if (m[6] !== undefined) out.push({ type: "em", value: m[6] });
    last = index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  // merge adjacent text nodes
  return out.reduce<Inline[]>((acc, node) => {
    const prev = acc[acc.length - 1];
    if (node.type === "text" && prev?.type === "text") prev.value += node.value;
    else acc.push({ ...node });
    return acc;
  }, []);
}

export function parseLessonBody(body: string | null | undefined): Block[] {
  if (!body) return [];
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = () => {
    if (para.length) blocks.push({ type: "paragraph", content: parseInline(para.join(" ")) });
    if (quote.length) blocks.push({ type: "quote", content: parseInline(quote.join(" ")) });
    if (list) blocks.push({ type: "list", ordered: list.ordered, items: list.items.map(parseInline) });
    para = [];
    quote = [];
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = line.match(/^(#{2,3})\s+(.*)$/);
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const q = line.match(/^>\s?(.*)$/);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length === 2 ? 2 : 3, content: parseInline(heading[2]) });
    } else if (bullet || numbered) {
      const ordered = !!numbered;
      const text = (bullet ?? numbered)![1];
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push(text);
    } else if (q) {
      if (!quote.length) flush();
      quote.push(q[1]);
    } else if (list) {
      // continuation line of the last list item
      list.items[list.items.length - 1] += ` ${line}`;
    } else {
      if (quote.length) flush();
      para.push(line);
    }
  }
  flush();
  return blocks;
}
