import TimestampBadge from "@/components/recordings/TimestampBadge";
import type { ChatCitation } from "@/lib/chat/types";

interface ChatSourcesProps {
  citations: ChatCitation[];
}

export function ChatSources({ citations }: ChatSourcesProps) {
  if (citations.length === 0) return null;

  return (
    <details className="group mt-4 border-t border-white/10 pt-3">
      <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-[0.16em] text-primary/80">
        {citations.length} session source{citations.length === 1 ? "" : "s"}
      </summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {citations.map((citation, index) => (
          <article
            key={`${citation.recordingId}-${citation.startTime}-${index}`}
            className="rounded-xl border border-primary/15 bg-black/15 p-3"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <TimestampBadge
                seconds={citation.startTime}
                href={`/dashboard/sessions/${citation.recordingId}?t=${Math.floor(citation.startTime)}`}
              />
              <span className="min-w-0 truncate text-xs font-semibold text-white/75">
                {citation.title}
              </span>
            </div>
            <p className="line-clamp-3 text-xs leading-relaxed text-white/50">
              {citation.text}
            </p>
          </article>
        ))}
      </div>
    </details>
  );
}
