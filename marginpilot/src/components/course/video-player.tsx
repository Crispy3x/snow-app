import "server-only";
import { iframeSrc, parseVideoRef } from "@/lib/course/video";
import { muxTokenFromEnv } from "@/lib/course/mux-token";
import { signedMediaUrl } from "@/lib/course/data";
import { StorageVideo } from "./storage-video";

/**
 * Picks the player for a lesson's provider. Only render this after the viewer's
 * entitlement has been checked: it signs Mux tokens and storage URLs.
 */
export async function VideoPlayer({
  lesson,
  resumeAt,
  trackProgress,
}: {
  lesson: {
    id: string;
    title: string;
    video_provider: string | null;
    video_ref: string | null;
    duration_seconds: number | null;
    captions_path: string | null;
    captions_label: string | null;
  };
  resumeAt: number;
  trackProgress: boolean;
}) {
  const video = parseVideoRef(lesson.video_provider, lesson.video_ref);
  if (!video) {
    return lesson.video_provider ? (
      <p className="rounded-lg border border-line bg-card p-4 text-sm text-ink-muted">
        The video for this lesson isn&rsquo;t available right now.
      </p>
    ) : null;
  }

  if (video.provider === "storage") {
    const [src, captionsUrl] = await Promise.all([
      signedMediaUrl(video.path, lesson.duration_seconds),
      lesson.captions_path ? signedMediaUrl(lesson.captions_path, lesson.duration_seconds) : Promise.resolve(null),
    ]);
    if (!src) {
      return (
        <p className="rounded-lg border border-line bg-card p-4 text-sm text-ink-muted">
          The video file for this lesson couldn&rsquo;t be loaded. Try again in a moment.
        </p>
      );
    }
    return (
      <StorageVideo
        src={src}
        title={lesson.title}
        lessonId={lesson.id}
        resumeAt={resumeAt}
        trackProgress={trackProgress}
        captionsUrl={captionsUrl}
        captionsLabel={lesson.captions_label}
      />
    );
  }

  let token: string | null = null;
  if (video.provider === "mux") {
    try {
      token = muxTokenFromEnv(video.playbackId);
    } catch {
      token = null; // misconfigured key: fall back to public playback rather than failing the page
    }
  }
  const src = iframeSrc(video, token);
  if (!src) return null;
  const resume = video.provider === "youtube" && resumeAt > 5 ? `&start=${resumeAt}` : "";

  return (
    <div className="aspect-video w-full overflow-hidden rounded-lg bg-ink">
      <iframe
        src={`${src}${resume}`}
        title={`Lesson video: ${lesson.title}`}
        className="h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
      />
    </div>
  );
}
