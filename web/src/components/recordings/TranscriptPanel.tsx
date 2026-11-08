import { useEffect, useRef, type MouseEvent } from "react";
import { Chip, EmptyState, INSET_FOCUS_RING, RAISED, cx } from "@/components/platform/ui";
import { formatTimestamp } from "@/lib/recordings/time-utils";

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

/** A plain click seeks in place; a new tab or window, or any other modified click, follows the link. */
function seeksInPlace(event: MouseEvent<HTMLAnchorElement>) {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
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
  const activeRef = useRef<HTMLAnchorElement | null>(null);
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
      className="h-full overflow-y-auto overscroll-contain rounded-[1.125rem] border border-hairline"
    >
      {segments.length === 0 ? (
        <EmptyState title="No transcript yet" headingLevel={2} className="m-3">
          This session has no transcript lines to jump to. The video still plays.
        </EmptyState>
      ) : (
        <div className="divide-y divide-hairline">
          {segments.map((segment) => {
            const active = segment.id === activeSegmentId;
            const time = formatTimestamp(segment.startTime);
            // One link per line: the time and the words seek to the same moment, so a keyboard
            // stops here once, and the name says where the video will go. As a link to ?t= it
            // still opens the page at that moment without the script.
            return (
              <a
                key={segment.id}
                ref={active ? activeRef : undefined}
                href={`?t=${segment.startTime}`}
                aria-current={active || undefined}
                onClick={(event) => {
                  if (!seeksInPlace(event)) return;
                  event.preventDefault();
                  onSeek(segment.startTime);
                }}
                className={cx(
                  "flex w-full gap-3 border-l-4 px-4 py-3 text-left transition-colors duration-150 motion-reduce:transition-none pointer-coarse:min-h-11",
                  INSET_FOCUS_RING,
                  // No more than a card's lift under the timestamp chip, whose ink is proven only that far.
                  active ? cx("border-ink-primary", RAISED) : "border-transparent hover:bg-ink-primary/4",
                )}
              >
                <Chip className="tabular-nums">
                  <span className="sr-only">Play from </span>
                  {time}
                </Chip>
                <span className="min-w-0 flex-1 text-sm leading-relaxed text-ink-primary">
                  {segment.speaker && (
                    <span className="mb-1 block text-xs font-semibold text-ink-secondary">
                      {segment.speaker}
                    </span>
                  )}
                  {segment.text}
                </span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
