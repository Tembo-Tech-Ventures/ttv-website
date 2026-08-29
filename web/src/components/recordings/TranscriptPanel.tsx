import { useEffect, useRef } from "react";
import TimestampBadge from "@/components/recordings/TimestampBadge";

export interface TranscriptSegment {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  speaker?: string | null;
}

/**
 * Where the panel should be scrolled to put a segment in its vertical centre,
 * clamped to the scrollable range so the first and last segments don't ask for
 * an out-of-bounds offset.
 */
export function centredScrollTop({
  segmentOffsetTop,
  segmentHeight,
  panelHeight,
  panelScrollHeight,
}: {
  segmentOffsetTop: number;
  segmentHeight: number;
  panelHeight: number;
  panelScrollHeight: number;
}) {
  const centred = segmentOffsetTop - panelHeight / 2 + segmentHeight / 2;
  const furthest = Math.max(0, panelScrollHeight - panelHeight);
  return Math.max(0, Math.min(centred, furthest));
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
  const panelRef = useRef<HTMLDivElement | null>(null);

  /*
   * Scroll the panel, not the page. `scrollIntoView` walks up and scrolls
   * *every* scrollable ancestor including the document, so following along with
   * a video yanked the whole page every few seconds without the viewer touching
   * anything. Positioning the panel's own scrollTop keeps the effect local.
   */
  useEffect(() => {
    const panel = panelRef.current;
    const active = activeRef.current;
    if (!panel || !active) return;

    const top = centredScrollTop({
      segmentOffsetTop: active.offsetTop,
      segmentHeight: active.clientHeight,
      panelHeight: panel.clientHeight,
      panelScrollHeight: panel.scrollHeight,
    });
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panel.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
  }, [activeSegmentId]);

  return (
    <div
      ref={panelRef}
      data-transcript-panel="true"
      className="h-full overflow-y-auto overscroll-contain rounded-md border border-teal/20 bg-dark/40"
    >
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
