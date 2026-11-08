import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/platform/ui";
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
  labelledBy,
  segments,
  initialTime = 0,
}: {
  videoUrl: string;
  /** The id of the page's h1, the session's title, which names the video. */
  labelledBy: string;
  segments: TranscriptSegment[];
  initialTime?: number;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const unavailableRef = useRef<HTMLDivElement | null>(null);
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

  /* A retry that never hears back must not leave the button stuck working. */
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
    focusPlayer.current = Boolean(unavailableRef.current?.contains(document.activeElement));
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
      <section className="min-w-0">
        {/* The box keeps its 16:9 before the video knows its size, so nothing below it moves. */}
        <div className="relative aspect-video overflow-hidden rounded-[1.125rem] border border-hairline bg-ground">
          <video
            ref={videoRef}
            // A media fragment starts at ?t= even before (or without) the script.
            src={initialTime > 0 ? `${videoUrl}#t=${initialTime}` : videoUrl}
            controls
            playsInline
            aria-labelledby={labelledBy}
            className={failed ? "invisible size-full" : "size-full"}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onError={() => setMedia("failed")}
            onLoadedMetadata={loaded}
            onLoadedData={loaded}
          >
            <track kind="captions" srcLang="en" label="English" />
          </video>
          <div
            ref={unavailableRef}
            data-video-unavailable={failed || undefined}
            className={failed ? "absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center" : "sr-only"}
          >
            {/* Always present, so a screen reader hears the message when it appears. */}
            <output className="block max-w-md text-sm leading-relaxed text-ink-secondary">
              {failed && "This recording can’t be played right now. The transcript still has everything that was said."}
            </output>
            {failed && (
              <Button variant="quiet" onClick={retry} loading={media === "retrying"}>
                Try again
              </Button>
            )}
          </div>
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
