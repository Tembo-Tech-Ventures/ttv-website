import { useRef, useState } from "react";
import { PiArrowRight, PiCaretDown } from "react-icons/pi";
import type { MentorDirectoryItem, MentorRequest } from "@/lib/platform/contracts";
import { useMentorRequests } from "@/lib/platform/client/hooks/mentoring";
import { hasOpenSpot } from "@/lib/platform/client/mentor-directory";
import { shownStatus, type MentorRequestsStore } from "@/lib/platform/client/mentor-requests";
import { Avatar, Button, ButtonLink, Card, Chip, FOCUS_RING, buttonClass, cx } from "@/components/platform/ui";
import MaskedText from "@/components/channels/MaskedText";
import { capacityView, conversationHref, requesterStatus, requestHasNews, requestMeta, requestsSummary, type StatusView } from "./mentor-display";

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

/**
 * The requests this person sent, newest first, with where each stands. A
 * waiting request can be withdrawn; an accepted one opens its conversation; a
 * suggestion can be asked at once. "Not this month" reads as what it is: the
 * mentor's time, not a verdict. Folded to one line ("Your requests · 1 waiting
 * · 1 accepted") above the directory, so the mentors come first (T06); each
 * mentor's card also says where a request to them stands.
 */
export default function OwnRequests({ store, now, mentors, onAsk }: Props) {
  const state = useMentorRequests(store);
  const statusRefs = useRef(new Map<string, HTMLElement>());
  // Decided on arrival only, so a change while the person reads never folds the list away under them.
  const [newsOnArrival] = useState(() => state.items.some(request => isRecent(request, now) && requestHasNews({ ...request, status: shownStatus(state, request) })));
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
          <span ref={node => { if (node) statusRefs.current.set(request.id, node); else statusRefs.current.delete(request.id); }} tabIndex={-1} className={cx("rounded-full", FOCUS_RING)} data-request-status>
            <Chip tone={view.tone}>{pending ? `${view.label}…` : view.label}</Chip>
          </span>
          <div className="flex flex-wrap gap-2 empty:hidden">
            {status === "PENDING" && !pending && (
              // Named for whose request it withdraws, as there can be several (QA4-18).
              <Button size="sm" onClick={() => withdraw(request)} aria-label={`Withdraw request to ${request.mentor.name}`}>Withdraw</Button>
            )}
            {status === "ACCEPTED" && request.channelId && (
              <ButtonLink
                href={conversationHref(request.channelId)} size="sm" variant="quiet" trailingIcon={<PiArrowRight className="size-4" />}
                aria-describedby={`own-request-${request.id}`}
              >
                Open conversation
              </ButtonLink>
            )}
            {suggested && hasOpenSpot(suggested) && (
              // Quiet, as every row can hold one: the drawer's Send is the page's one primary.
              <Button size="sm" aria-haspopup="dialog" onClick={event => onAsk(suggested, event.currentTarget)}>
                Ask {suggested.person.name}
              </Button>
            )}
          </div>
        </div>
        {(view.detail || request.responseNote || failed) && (
          <div className="flex flex-col gap-1.5 sm:pl-11">
            {view.detail && <p className="text-sm leading-relaxed text-ink-secondary">{view.detail}</p>}
            <NextStep view={view} />
            {suggested && !hasOpenSpot(suggested) && (
              <p className="text-sm text-ink-secondary">{suggested.person.name}: {capacityView(suggested.capacity, now).text}.</p>
            )}
            {request.responseNote && (
              <blockquote className="border-l-2 border-ring/60 pl-3 text-sm leading-relaxed break-words text-ink-secondary">
                <span className="sr-only">{request.mentor.name} wrote: </span><MaskedText text={request.responseNote} />
              </blockquote>
            )}
            {failed && !failed.stale && <p className="text-sm font-semibold text-danger-ink">Couldn't withdraw. Nothing changed; try again.</p>}
          </div>
        )}
      </li>
    );
  }

  const shown = recent.map(request => ({ ...request, status: shownStatus(state, request) }));
  const summary = [requestsSummary(shown), earlier.length > 0 && `${earlier.length}${state.nextCursor !== null ? "+" : ""} earlier`]
    .filter(Boolean).join(" · ");

  return (
    <section aria-labelledby="own-requests-title" className="own-requests mb-5 flex flex-col gap-2" data-own-requests>
      {/* The heading stays outside the summary, which some screen readers read as a button (S3 review nit). */}
      <h2 id="own-requests-title" className="text-[0.9375rem] text-ink-primary">Your requests</h2>
      {/* Open on arrival when a request has news the person came here for: a suggestion, not this month, a check (S3). */}
      <details className="group" open={newsOnArrival || undefined} data-own-requests-fold>
        <summary className={buttonClass({ variant: "quiet", className: "own-requests__summary w-full cursor-pointer" })}>
          <span className="sr-only">Your requests: </span>
          {summary && <span className="min-w-0 font-normal text-ink-secondary" data-own-requests-summary>{summary}</span>}
          <span className="ml-auto inline-flex items-center gap-1 text-ink-secondary" aria-hidden="true">
            <span className="group-open:hidden">Show</span>
            <span className="hidden group-open:inline">Hide</span>
            <PiCaretDown className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
          </span>
        </summary>
      {recent.length > 0 && (
        <Card as="div" padding="sm" className="mt-3 p-0 sm:p-0">
          <ul className="divide-y divide-hairline">{recent.map(row)}</ul>
        </Card>
      )}
      {earlier.length > 0 ? (
        <details className="mt-3" data-own-requests-earlier>
          <summary className={buttonClass({ variant: "ghost", size: "sm", className: "cursor-pointer" })}>
            Earlier ({earlier.length}{state.nextCursor !== null ? "+" : ""})
          </summary>
          <Card as="div" padding="sm" className="mt-2 p-0 sm:p-0">
            <ul className="divide-y divide-hairline">{earlier.map(row)}</ul>
          </Card>
          {more}
        </details>
      ) : more}
      </details>
    </section>
  );
}

/** What a status means for the person and what they can do next, when it says (a check's fixed explanation). */
function NextStep({ view }: { view: StatusView }) {
  if (!view.next && !view.link) return null;
  return (
    <p className="text-sm leading-relaxed text-ink-secondary" data-request-next>
      {view.next}
      {view.link && (
        <>
          {view.next ? " " : ""}
          <a href={view.link.href} className={cx("font-semibold text-peach-ink underline underline-offset-4", FOCUS_RING)}>{view.link.label}</a>
        </>
      )}
    </p>
  );
}
