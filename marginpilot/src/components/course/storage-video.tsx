"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Native <video> for lessons hosted in Supabase storage. Resumes from the saved
 * position and reports progress to /app/course/progress: every 15 seconds of
 * playback, on pause, when the tab is hidden (sendBeacon) and on end (marks complete).
 */

const PROGRESS_URL = "/app/course/progress";
const SAVE_EVERY_SECONDS = 15;

function send(body: Record<string, unknown>, beacon = false) {
  const payload = JSON.stringify(body);
  // text/plain keeps sendBeacon a simple request; the handler checks Origin and parses JSON.
  if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon(PROGRESS_URL, new Blob([payload], { type: "text/plain;charset=UTF-8" }));
    return Promise.resolve();
  }
  return fetch(PROGRESS_URL, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8" },
    body: payload,
    keepalive: true,
  }).then(
    () => undefined,
    () => undefined,
  );
}

export function StorageVideo({
  src,
  title,
  lessonId,
  resumeAt,
  trackProgress,
  captionsUrl,
  captionsLabel,
}: {
  src: string;
  title: string;
  lessonId: string;
  resumeAt: number;
  trackProgress: boolean;
  captionsUrl: string | null;
  captionsLabel: string | null;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const lastSent = useRef(resumeAt);
  const router = useRouter();

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const position = () => Math.floor(video.currentTime || 0);
    const save = (beacon = false) => {
      if (!trackProgress) return;
      const p = position();
      if (p === lastSent.current) return;
      lastSent.current = p;
      void send({ lessonId, position: p }, beacon);
    };

    const onLoaded = () => {
      if (resumeAt > 5 && (!video.duration || resumeAt < video.duration - 5)) video.currentTime = resumeAt;
    };
    const onTime = () => {
      if (Math.abs(position() - lastSent.current) >= SAVE_EVERY_SECONDS) save();
    };
    const onPause = () => save();
    const onEnded = () => {
      if (!trackProgress) return;
      lastSent.current = position();
      void send({ lessonId, position: position(), completed: true }).then(() => router.refresh());
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") save(true);
    };
    const onPageHide = () => save(true);

    if (video.readyState >= 1) onLoaded();
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [lessonId, resumeAt, trackProgress, router]);

  return (
    <video
      ref={ref}
      controls
      preload="metadata"
      playsInline
      crossOrigin="anonymous"
      className="aspect-video w-full rounded-lg bg-ink"
      aria-label={`Lesson video: ${title}`}
    >
      <source src={src} />
      {captionsUrl && <track kind="captions" src={captionsUrl} srcLang="en" label={captionsLabel || "English"} default />}
      Your browser can&rsquo;t play this video.{" "}
      <a href={src} className="underline">
        Download it instead
      </a>
      .
    </video>
  );
}
