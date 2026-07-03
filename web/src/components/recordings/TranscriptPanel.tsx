import { useEffect, useRef } from "react";
import TimestampBadge from "@/components/recordings/TimestampBadge";

export interface TranscriptSegment {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  speaker?: string | null;
}

export default function TranscriptPanel({
  segments,
  activeSegmentId,
  onSeek,
}: {
  segments: TranscriptSegment[];
  activeSegmentId: string | null;
  onSeek: (seconds: number) => void;
}) {
  const activeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeSegmentId]);

  return (
    <div className="h-full overflow-y-auto rounded-md border border-teal/20 bg-dark/40">
      {segments.length === 0 ? (
        <div className="p-6 text-sm text-white/50">Transcript is not available yet.</div>
      ) : (
        <div className="divide-y divide-teal/10">
          {segments.map((segment) => {
            const active = segment.id === activeSegmentId;
            return (
              <div
                key={segment.id}
                ref={active ? activeRef : undefined}
                className={`flex gap-3 px-4 py-3 text-left transition-colors ${
                  active
                    ? "border-l-4 border-primary bg-teal/25"
                    : "border-l-4 border-transparent hover:bg-teal/10"
                }`}
              >
                <TimestampBadge
                  seconds={segment.startTime}
                  onClick={() => onSeek(segment.startTime)}
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left text-sm leading-relaxed text-white/85"
                  onClick={() => onSeek(segment.startTime)}
                >
                  {segment.speaker && (
                    <span className="mb-1 block text-xs font-semibold uppercase text-white/45">
                      {segment.speaker}
                    </span>
                  )}
                  {segment.text}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
