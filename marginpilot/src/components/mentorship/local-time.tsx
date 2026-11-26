"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * A date and time in the viewer's own time zone. The server renders UTC (it can't
 * know the viewer's zone); after hydration the browser re-renders in local time.
 */
export function LocalTime({ iso, withWeekday = true }: { iso: string; withWeekday?: boolean }) {
  const isClient = useSyncExternalStore(noop, () => true, () => false);
  const opts: Intl.DateTimeFormatOptions = {
    ...(withWeekday ? { weekday: "short" } : {}),
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...(isClient ? {} : { timeZone: "UTC" }),
  };
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {new Date(iso).toLocaleString("en-US", opts)}
    </time>
  );
}
