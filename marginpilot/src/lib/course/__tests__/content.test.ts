import { describe, expect, it } from "vitest";
import { parseLessonBody, parseInline, safeHref } from "../markdown";
import { courseCompletion, flattenOutline, neighbours, pickContinueLesson, sanitizePosition } from "../progress";
import { formatDuration, iframeSrc, parseDurationInput, parseVideoRef } from "../video";

describe("parseVideoRef", () => {
  it("accepts YouTube IDs and URLs", () => {
    expect(parseVideoRef("youtube", "dQw4w9WgXcQ")).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
    expect(parseVideoRef("youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
    expect(parseVideoRef("youtube", "https://youtu.be/dQw4w9WgXcQ")).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
    expect(parseVideoRef("youtube", "javascript:alert(1)")).toBeNull();
  });

  it("accepts Vimeo IDs, unlisted hashes and URLs", () => {
    expect(parseVideoRef("vimeo", "123456789")).toEqual({ provider: "vimeo", id: "123456789", hash: null });
    expect(parseVideoRef("vimeo", "https://vimeo.com/123456789/abcdef1234")).toEqual({ provider: "vimeo", id: "123456789", hash: "abcdef1234" });
    expect(parseVideoRef("vimeo", "https://player.vimeo.com/video/123456789?h=abcdef1234")).toEqual({
      provider: "vimeo",
      id: "123456789",
      hash: "abcdef1234",
    });
  });

  it("accepts Mux playback IDs and rejects junk", () => {
    expect(parseVideoRef("mux", "a4nOgmxGWg6gULfcBbAa00gXyfcwPnAFldF8RdsNyk8M")).toEqual({
      provider: "mux",
      playbackId: "a4nOgmxGWg6gULfcBbAa00gXyfcwPnAFldF8RdsNyk8M",
    });
    expect(parseVideoRef("mux", "\"><script>")).toBeNull();
  });

  it("rejects storage path traversal", () => {
    expect(parseVideoRef("storage", "lesson/video/a.mp4")).toEqual({ provider: "storage", path: "lesson/video/a.mp4" });
    expect(parseVideoRef("storage", "../secret")).toBeNull();
  });

  it("builds iframe URLs", () => {
    expect(iframeSrc({ provider: "mux", playbackId: "abc" }, "t.k.n")).toBe("https://player.mux.com/abc?playback-token=t.k.n");
    expect(iframeSrc({ provider: "vimeo", id: "1", hash: "ff" })).toBe("https://player.vimeo.com/video/1?dnt=1&h=ff");
  });
});

describe("durations", () => {
  it("formats and parses", () => {
    expect(formatDuration(725)).toBe("12:05");
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatDuration(null)).toBeNull();
    expect(parseDurationInput("12:05")).toBe(725);
    expect(parseDurationInput("1:02:03")).toBe(3723);
    expect(parseDurationInput("90")).toBe(90);
    expect(parseDurationInput("")).toBeNull();
    expect(parseDurationInput("abc")).toBeNaN();
  });
});

describe("markdown-lite", () => {
  it("parses blocks", () => {
    const blocks = parseLessonBody("## Fees\n\nFirst line\nsame paragraph\n\n- one\n- two\n\n1. a\n2. b\n\n> note");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "list", "quote"]);
    expect(blocks[1]).toEqual({ type: "paragraph", content: [{ type: "text", value: "First line same paragraph" }] });
  });

  it("keeps HTML as text and drops unsafe links", () => {
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ type: "text", value: "<img src=x onerror=alert(1)>" }]);
    expect(parseInline("[x](javascript:alert(1))").some((n) => n.type === "link")).toBe(false);
    expect(parseInline("[x](javascript:void)")).toEqual([{ type: "text", value: "x" }]);
    expect(parseInline("**bold** and [eBay](https://www.ebay.com)")).toEqual([
      { type: "strong", value: "bold" },
      { type: "text", value: " and " },
      { type: "link", value: "eBay", href: "https://www.ebay.com/" },
    ]);
    expect(safeHref("//evil.com")).toBeNull();
    expect(safeHref("/app/billing")).toBe("/app/billing");
  });
});

describe("progress", () => {
  const modules = [
    { id: "m2", title: "B", summary: null, position: 2 },
    { id: "m1", title: "A", summary: null, position: 1 },
  ];
  const l = (id: string, module_id: string, position: number) => ({
    id,
    module_id,
    slug: id,
    title: id,
    position,
    duration_seconds: null,
    is_preview: false,
  });
  const ordered = flattenOutline(modules, [l("b1", "m2", 1), l("a2", "m1", 2), l("a1", "m1", 1), l("orphan", "mX", 1)]);

  it("orders by module then lesson and drops orphans", () => {
    expect(ordered.map((x) => x.id)).toEqual(["a1", "a2", "b1"]);
  });

  it("computes completion and neighbours", () => {
    const progress = [{ lesson_id: "a1", completed_at: "2026-11-01", last_position_seconds: 0, updated_at: "2026-11-01" }];
    expect(courseCompletion(ordered, progress)).toEqual({ completed: 1, total: 3, percent: 33 });
    expect(neighbours(ordered, "a2").prev?.id).toBe("a1");
    expect(neighbours(ordered, "a2").next?.id).toBe("b1");
  });

  it("continues the most recent unfinished lesson, else the first incomplete", () => {
    expect(pickContinueLesson(ordered, [])?.lesson.id).toBe("a1");
    const progress = [
      { lesson_id: "a1", completed_at: "2026-11-01", last_position_seconds: 0, updated_at: "2026-11-03" },
      { lesson_id: "b1", completed_at: null, last_position_seconds: 95, updated_at: "2026-11-02" },
    ];
    expect(pickContinueLesson(ordered, progress)).toMatchObject({ lesson: { id: "b1" }, resumeAt: 95 });
    const allDone = ordered.map((x) => ({ lesson_id: x.id, completed_at: "d", last_position_seconds: 0, updated_at: "d" }));
    expect(pickContinueLesson(ordered, allDone)).toBeNull();
  });

  it("sanitizes reported positions", () => {
    expect(sanitizePosition(12.7, 600)).toBe(12);
    expect(sanitizePosition(-1, 600)).toBeNull();
    expect(sanitizePosition("x", 600)).toBeNull();
    expect(sanitizePosition(99999, 600)).toBe(660);
  });
});
