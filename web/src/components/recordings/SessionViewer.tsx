import { useEffect, useId, useMemo, useRef, useState } from "react";
import TranscriptPanel, {
  type TranscriptSegment,
} from "@/components/recordings/TranscriptPanel";

/** HTMLMediaElement.NETWORK_NO_SOURCE: the browser gave up on the source. */
const NETWORK_NO_SOURCE = 3;
/** HTMLMediaElement.HAVE_NOTHING: nothing about the media is known yet. */
const HAVE_NOTHING = 0;
/** How long a retry may hang (a stalled connection answers neither way) before it counts as failed again. */
export const RETRY_TIMEOUT_MS = 15_000;

export default function SessionViewer({
  videoUrl,
  title,
  segments,
  initialTime = 0,
  titleAs: Title = "h2",
}: {
  videoUrl: string;
  title: string;
  segments: TranscriptSegment[];
  initialTime?: number;
  /** In the spaces shell the session's title is the page's one h1. */
  titleAs?: "h1" | "h2";
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const retryRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const [currentTime, setCurrentTime] = useState(initialTime);
  /**
   * Whether the video could load. Without a failed state the player just sat
   * at 0:00 and said nothing. While retrying, the message and its button stay
   * put, so keyboard focus is not dropped on the page.
   */
  const [media, setMedia] = useState<"ok" | "failed" | "retrying">("ok");
  const failed = media !== "ok";

  const activeSegment = useMemo(() => {
    return (
      segments.find(
        (segment) =>
          currentTime >= segment.startTime && currentTime < segment.endTime
      ) ?? null
    );
  }, [currentTime, segments]);

  useEffect(() => {
    if (videoRef.current && initialTime > 0) {
      videoRef.current.currentTime = initialTime;
    }
  }, [initialTime]);

  /* The source may have failed before hydration attached onError: ask the element. */
  useEffect(() => {
    const video = videoRef.current;
    if (video && (video.error || video.networkState === NETWORK_NO_SOURCE)) setMedia("failed");
  }, []);

  const seek = (seconds: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = seconds;
    videoRef.current.play().catch(() => undefined);
  };

  const retry = () => {
    if (media !== "failed") return;
    setMedia("retrying");
    videoRef.current?.load();
  };

  /* A retry that never hears back must not leave the button stuck on "Trying again…". */
  useEffect(() => {
    if (media !== "retrying") return;
    const timer = setTimeout(() => {
      if ((videoRef.current?.readyState ?? HAVE_NOTHING) === HAVE_NOTHING) setMedia("failed");
    }, RETRY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [media]);

  /* Loaded after all (metadata is enough to play): hand focus from the retry button to the player it brought back. */
  const focusPlayer = useRef(false);
  const loaded = () => {
    if (media === "ok") return;
    focusPlayer.current = document.activeElement === retryRef.current;
    setMedia("ok");
  };

  /* After the render that shows the player again; it cannot take focus while hidden. */
  useEffect(() => {
    if (media !== "ok" || !focusPlayer.current) return;
    focusPlayer.current = false;
    videoRef.current?.focus();
  }, [media]);

  return (
    <div className="grid min-h-[70vh] gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
      <section className="min-w-0 space-y-4">
        <div className="relative overflow-hidden rounded-md border border-teal/20 bg-black">
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            aria-labelledby={titleId}
            className={failed ? "invisible aspect-video w-full bg-black" : "aspect-video w-full bg-black"}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onError={() => setMedia("failed")}
            onLoadedMetadata={loaded}
            onLoadedData={loaded}
          >
            <track kind="captions" srcLang="en" label="English" />
          </video>
          <div
            data-video-unavailable={failed || undefined}
            className={failed ? "absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center" : "sr-only"}
          >
            {/* Always present, so a screen reader hears the message when it appears. */}
            <output className="block max-w-md text-sm leading-relaxed text-ink-secondary">
              {failed && "This recording can’t be played right now. The transcript still has everything that was said."}
            </output>
            {failed && (
              <button
                ref={retryRef}
                type="button"
                onClick={retry}
                aria-disabled={media === "retrying" || undefined}
                className="min-h-11 rounded-md border border-white/40 px-4 text-sm font-semibold text-white hover:bg-teal/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-disabled:cursor-wait aria-disabled:opacity-70"
              >
                {media === "retrying" ? "Trying again…" : "Try again"}
              </button>
            )}
          </div>
        </div>
        <div>
          <Title id={titleId} className="text-xl font-semibold text-white">{title}</Title>
          <p className="mt-1 text-sm text-ink-muted">
            Use the transcript to jump to a moment in the session.
          </p>
        </div>
      </section>

      <aside className="min-h-[420px] lg:max-h-[72vh]">
        <TranscriptPanel
          segments={segments}
          activeSegmentId={activeSegment?.id ?? null}
          onSeek={seek}
        />
      </aside>
    </div>
  );
}
