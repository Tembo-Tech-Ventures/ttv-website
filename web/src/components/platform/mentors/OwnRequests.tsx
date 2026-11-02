import { useRef } from "react";
import { PiArrowRight } from "react-icons/pi";
import type { MentorDirectoryItem, MentorRequest } from "@/lib/platform/contracts";
import { useMentorRequests } from "@/lib/platform/client/hooks/mentoring";
import { hasOpenSpot } from "@/lib/platform/client/mentor-directory";
import { shownStatus, type MentorRequestsStore } from "@/lib/platform/client/mentor-requests";
import { Avatar, Button, Card, Chip } from "@/components/platform/ui";
import { BUTTON_VARIANTS, FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import { capacityView, conversationHref, requesterStatus, requestMeta } from "./mentor-display";

interface Props {
  store: MentorRequestsStore;
  now: number;
  /** Listed mentors, so a suggestion can be asked straight away. */
  mentors: readonly MentorDirectoryItem[];
  onAsk: (item: MentorDirectoryItem, from: HTMLButtonElement) => void;
}

/** How long an answered request stays in view before it folds under "Earlier". */
export const RECENT_DAYS = 14;

/** Still waiting (as the server last said), or answered within the last RECENT_DAYS. */
export function isRecent(request: MentorRequest, now: number): boolean {
  return request.status === "PENDING" || now - request.updatedAt < RECENT_DAYS * 86_400_000;
}

const LINK = cx("inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[0.8125rem] font-semibold pointer-coarse:min-h-11", BUTTON_VARIANTS.quiet, FOCUS_RING);

/**
 * The requests this person sent, newest first, with where each stands. A
 * waiting request can be withdrawn; an accepted one opens its conversation; a
 * suggestion can be asked at once. "Not this month" reads as what it is: the
 * mentor's time, not a verdict.
 */
export default function OwnRequests({ store, now, mentors, onAsk }: Props) {
  const state = useMentorRequests(store);
  const statusRefs = useRef(new Map<string, HTMLElement>());
  if (state.items.length === 0) return null;
  // Waiting requests and what changed lately stay in view; older answers fold under "Earlier", so the directory
  // stays near the top for someone who has asked for months.
  const recent = state.items.filter(request => isRecent(request, now));
  const earlier = state.items.filter(request => !isRecent(request, now));

  const more = state.nextCursor !== null && (
    <Button className="mt-4" loading={state.loadingMore} onClick={() => void store.loadMore()}>Show earlier requests</Button>
  );

  function withdraw(request: MentorRequest) {
    void store.withdraw(request.id);
    // The button goes with the waiting state: keep focus on the request's status.
    statusRefs.current.get(request.id)?.focus();
  }

  function row(request: MentorRequest) {
    const status = shownStatus(state, request);
    const view = requesterStatus(request, status);
    const failed = state.failed[request.id];
    const pending = state.pending[request.id];
    const suggested = status === "REDIRECTED" && request.redirectedTo
      ? mentors.find(item => item.person.id === request.redirectedTo!.id) : undefined;
    return (
      <li key={request.id} className="flex flex-col gap-2 px-4 py-3.5 sm:px-5" data-own-request={request.id} data-status={status}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Avatar id={request.mentor.id} name={request.mentor.name} src={request.mentor.avatarUrl ?? undefined} size="md" mentor decorative />
          <div className="min-w-0 flex-1 basis-48">
            <p id={`own-request-${request.id}`} className="text-[0.9375rem] font-semibold break-words text-ink-primary">{request.mentor.name}</p>
            <p className="text-[0.8125rem] text-ink-secondary">{requestMeta(request, now)}</p>
          </div>
          <span ref={node => { if (node) statusRefs.current.set(request.id, node); else statusRefs.current.delete(request.id); }} tabIndex={-1} className="focus:outline-none" data-request-status>
            <Chip tone={view.tone}>{pending ? `${view.label}…` : view.label}</Chip>
          </span>
          <div className="flex flex-wrap gap-2 empty:hidden">
            {status === "PENDING" && !pending && (
              <Button size="sm" onClick={() => withdraw(request)} aria-describedby={`own-request-${request.id}`}>Withdraw</Button>
            )}
            {status === "ACCEPTED" && request.channelId && (
              <a href={conversationHref(request.channelId)} className={LINK} aria-describedby={`own-request-${request.id}`}>
                Open conversation <PiArrowRight aria-hidden className="size-4" />
              </a>
            )}
            {suggested && hasOpenSpot(suggested) && (
              <Button size="sm" variant="primary" aria-haspopup="dialog" onClick={event => onAsk(suggested, event.currentTarget)}>
                Ask {suggested.person.name}
              </Button>
            )}
          </div>
        </div>
        {(view.detail || request.responseNote || failed) && (
          <div className="flex flex-col gap-1.5 sm:pl-11">
            {view.detail && <p className="text-sm leading-relaxed text-ink-secondary">{view.detail}</p>}
            {suggested && !hasOpenSpot(suggested) && (
              <p className="text-sm text-ink-secondary">{suggested.person.name}: {capacityView(suggested.capacity, now).text}.</p>
            )}
            {request.responseNote && (
              <blockquote className="border-l-2 border-ring/60 pl-3 text-sm leading-relaxed break-words text-ink-secondary">
                <span className="sr-only">{request.mentor.name} wrote: </span>{request.responseNote}
              </blockquote>
            )}
            {failed && !failed.stale && <p className="text-sm font-semibold text-danger-ink">Couldn't withdraw. Nothing changed; try again.</p>}
          </div>
        )}
      </li>
    );
  }

  return (
    <section aria-labelledby="own-requests-title" className="mb-10" data-own-requests>
      <h2 id="own-requests-title" className="font-body text-lg font-bold text-ink-primary">Your requests</h2>
      {recent.length > 0 && (
        <Card as="div" padding="sm" className="mt-3 p-0 sm:p-0">
          <ul className="divide-y divide-hairline">{recent.map(row)}</ul>
        </Card>
      )}
      {earlier.length > 0 ? (
        <details className="mt-3" data-own-requests-earlier>
          <summary className={cx("inline-flex min-h-11 cursor-pointer items-center rounded-lg px-1 text-sm font-semibold text-ink-secondary hover:text-ink-primary", FOCUS_RING)}>
            Earlier ({earlier.length}{state.nextCursor !== null ? "+" : ""})
          </summary>
          <Card as="div" padding="sm" className="mt-2 p-0 sm:p-0">
            <ul className="divide-y divide-hairline">{earlier.map(row)}</ul>
          </Card>
          {more}
        </details>
      ) : more}
    </section>
  );
}
