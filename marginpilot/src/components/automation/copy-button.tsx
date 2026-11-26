"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Copies text to the clipboard and says so. */
export function CopyButton({ text, label = "Copy address" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied("done");
        } catch {
          setCopied("failed");
        }
        setTimeout(() => setCopied("idle"), 2500);
      }}
    >
      <span aria-live="polite">{copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : label}</span>
    </Button>
  );
}
