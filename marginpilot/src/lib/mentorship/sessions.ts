import type { SessionStatus } from "./validation";

/** Grouping and time-window helpers for mentorship sessions. Pure, unit tested. */

export type SessionLike = {
  id: string;
  starts_at: string;
  duration_min: number;
  status: SessionStatus;
  recording_url: string | null;
};

export function sessionEnd(s: Pick<SessionLike, "starts_at" | "duration_min">): number {
  return Date.parse(s.starts_at) + s.duration_min * 60_000;
}

/** Live now: scheduled and between start and end. */
export function isLive(s: SessionLike, now: Date): boolean {
  const t = now.getTime();
  return s.status === "scheduled" && t >= Date.parse(s.starts_at) && t < sessionEnd(s);
}

/**
 * Upcoming: scheduled sessions that haven't ended yet, soonest first.
 * Past: done sessions, or scheduled ones that have ended, newest first.
 * Cancelled future sessions are listed separately so members see the change.
 */
export function groupSessions<T extends SessionLike>(rows: T[], now: Date): { upcoming: T[]; past: T[]; cancelled: T[] } {
  const t = now.getTime();
  const upcoming: T[] = [], past: T[] = [], cancelled: T[] = [];
  for (const s of rows) {
    if (s.status === "cancelled") {
      if (sessionEnd(s) > t) cancelled.push(s);
    } else if (s.status === "scheduled" && sessionEnd(s) > t) upcoming.push(s);
    else past.push(s);
  }
  upcoming.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  past.sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  cancelled.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  return { upcoming, past, cancelled };
}

export function formatSessionTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}
