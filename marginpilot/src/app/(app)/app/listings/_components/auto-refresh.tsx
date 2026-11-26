"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** Refreshes the server-rendered page every few seconds while `active`, plus a manual button. */
export function AutoRefresh({ active, intervalMs = 3000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!active || paused) return;
    const t = setInterval(() => start(() => router.refresh()), intervalMs);
    return () => clearInterval(t);
  }, [active, paused, intervalMs, router]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" onClick={() => start(() => router.refresh())} disabled={pending}>
        {pending ? "Refreshing…" : "Refresh"}
      </Button>
      {active && (
        <Button variant="ghost" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
          {paused ? "Resume auto-refresh" : "Pause auto-refresh"}
        </Button>
      )}
      <span className="sr-only" role="status">
        {active && !paused ? "Updating automatically" : ""}
      </span>
    </div>
  );
}
