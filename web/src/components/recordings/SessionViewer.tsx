import { useEffect, useMemo, useRef, useState } from "react";
import TranscriptPanel, {
  type TranscriptSegment,
} from "@/components/recordings/TranscriptPanel";

export default function SessionViewer({
  videoUrl,
  title,
  segments,
  initialTime = 0,
}: {
  videoUrl: string;
  title: string;
  segments: TranscriptSegment[];
  initialTime?: number;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(initialTime);

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

  const seek = (seconds: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = seconds;
    videoRef.current.play().catch(() => undefined);
  };

  return (
    <div className="grid min-h-[70vh] gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
      <section className="min-w-0 space-y-4">
        <div className="overflow-hidden rounded-md border border-teal/20 bg-black">
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            className="aspect-video w-full bg-black"
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          >
            <track kind="captions" srcLang="en" label="English" />
          </video>
        </div>
        <div>
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm text-white/55">
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
