import { useEffect, useId, useMemo, useRef, useState } from "react";
import TranscriptPanel, {
  type TranscriptSegment,
} from "@/components/recordings/TranscriptPanel";

/** HTMLMediaElement.NETWORK_NO_SOURCE: the browser gave up on the source. */
const NETWORK_NO_SOURCE = 3;

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
  const titleId = useId();
  const [currentTime, setCurrentTime] = useState(initialTime);
  /** The video could not load. Without this the player just sat at 0:00 and said nothing. */
  const [failed, setFailed] = useState(false);

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
    if (video && (video.error || video.networkState === NETWORK_NO_SOURCE)) setFailed(true);
  }, []);

  const seek = (seconds: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = seconds;
    videoRef.current.play().catch(() => undefined);
  };

  const retry = () => {
    setFailed(false);
    videoRef.current?.load();
  };

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
            onError={() => setFailed(true)}
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
                type="button"
                onClick={retry}
                className="min-h-11 rounded-md border border-teal/40 px-4 text-sm font-semibold text-white hover:bg-teal/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Try again
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
