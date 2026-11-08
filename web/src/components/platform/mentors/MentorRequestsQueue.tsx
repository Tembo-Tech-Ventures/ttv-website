import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { PiArrowRight, PiCheck } from "react-icons/pi";
import type { MentorAvailability, MentorDirectoryItem, MentorRequest, MentorRequestList } from "@/lib/platform/contracts";
import type { ApiClient } from "@/lib/platform/client/apiClient";
import { useMentorRequests } from "@/lib/platform/client/hooks/mentoring";
import { createMentorRequestsStore, shownStatus, type MentorRequestsStore } from "@/lib/platform/client/mentor-requests";
import { firstName } from "@/components/channels/channel-format";
import EmbedCard from "@/components/channels/EmbedCard";
import MaskedText from "@/components/channels/MaskedText";
import { requestAttentionRefresh } from "@/components/platform/shell/overlays";
import { Avatar, Button, ButtonLink, Card, ChoiceGroup, Chip, EmptyState, FOCUS_RING, Notice, TextAreaField, cx } from "@/components/platform/ui";
import {
  ANSWERED_PARAM, CHOOSE_MENTOR, DIDNT_GO_THROUGH, NOTE_MAX, PANEL_PARAM, REPORT_REQUIRED, REQUEST_PARAM, requestAnchor, suggestField,
  type AnswerIntent, type AnswerPanel, type ServerAnswer,
} from "./answer-fields";
import { capacityView, conversationHref, MENTOR_REQUESTS_PATH, mentorStatus, personContext, requestMeta, waitingText } from "./mentor-display";
import MentorSpots from "./MentorSpots";
// oxlint-disable-next-line import/no-unassigned-import -- The embed card's stylesheet (channels.css).
import "@/components/channels/channels.css";
// oxlint-disable-next-line import/no-unassigned-import -- Mentor connections stylesheet.
import "./mentors.css";

export interface MentorRequestsQueueProps {
  /** The requests this mentor received (first page, newest first). */
  initial: MentorRequestList;
  /** Listed mentors this one can suggest instead (the directory never lists the caller). */
  mentors: readonly MentorDirectoryItem[];
  /** For the month's spots, which the island draws in the rail once interactive (`data-mentor-spots`). */
  availability: MentorAvailability;
  now: number;
  /** Where the answers' forms post and open their panels without JavaScript: this page. */
  path?: string;
  /** A panel opened through the page's URL without JavaScript (`?request=<id>&answer=decline`). */
  opened?: { requestId: string; panel: AnswerPanel } | null;
  /** An answer posted without JavaScript that did not go through: its card says why, with the panel open again. */
  serverAnswer?: ServerAnswer | null;
  /** A fixture client for the DEV harness. Live pages call the API. */
  api?: ApiClient;
}

/** The one open panel in the list, and whether a press opened it here (focus then moves into it). */
type OpenPanel = { requestId: string; panel: AnswerPanel; pressed: boolean };

const FREED = new Set(["REDIRECTED", "DECLINED", "WITHDRAWN"]);
// The rail's spots are taken over before the first paint, so nothing flickers; on the server, nothing runs.
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Mentoring → Requests (screen 06): who is asking for this mentor's time,
 * with the work attached, and three answers. Accepting opens a conversation
 * in Community; suggesting another mentor hands the person a better-placed
 * name; "Not this month" counts against nobody, with a kind word if the mentor
 * wants to add one. Every answer shows at once and is put back if the server
 * refuses it, and once the server has it the bell and the Mentoring tab count
 * again, so the answered request's notice leaves them (QA4-07).
 *
 * Each answer is a real form, so without JavaScript it posts to the page
 * (answer-post.ts) and a panel opens through the page's URL. The rail around
 * the list renders on the server (MentorMonthRail); once interactive, the
 * island draws its spots, which follow the answers given here.
 */
export default function MentorRequestsQueue({
  initial, mentors, availability, now, path = MENTOR_REQUESTS_PATH, opened = null, serverAnswer = null, api,
}: MentorRequestsQueueProps) {
  const root = useRef<HTMLDivElement>(null);
  const [store] = useState(() => createMentorRequestsStore({ as: "mentor", initial, ...(api ? { api } : {}) }));
  const state = useMentorRequests(store);
  // Grouped as the page arrived, so a request answered here stays where the mentor's eyes are.
  // A request the mentor reported is closed for them (an open check), so it is not waiting for an answer.
  const [waitingIds] = useState(() => new Set(initial.items.filter(item => item.status === "PENDING" && item.check !== "reported").map(item => item.id)));
  const waiting = state.items.filter(item => waitingIds.has(item.id));
  const earlier = state.items.filter(item => !waitingIds.has(item.id));
  const stillWaiting = waiting.filter(item => shownStatus(state, item) === "PENDING" && item.check !== "reported").length;
  // One panel open at a time, so its Send is the view's one primary action: every card's answers are quiet.
  const [open, setOpen] = useState<OpenPanel | null>(() => {
    const first = serverAnswer?.panel ? { requestId: serverAnswer.requestId, panel: serverAnswer.panel } : opened;
    return first ? { ...first, pressed: false } : null;
  });
  // The server's refusal stays on its card until the mentor answers that request again.
  const [refused, setRefused] = useState(serverAnswer);
  const [hydrated, setHydrated] = useState(false);
  const [spots, setSpots] = useState<HTMLElement | null>(null);

  // A spot is held by each waiting request and each one accepted this month: an answer other than
  // accepting frees one, and so does a report (an open check holds no spot), so the rail follows the
  // answers given here without another read.
  const freed = waiting.filter(item => (item.status !== "PENDING" && FREED.has(item.status)) || item.check === "reported").length;
  const used = Math.max(0, availability.capacity.used - freed);

  useBeforePaint(() => {
    setHydrated(true);
    // The rail's spots, from here on: the island draws them where the server's stood.
    const element = root.current?.closest("[data-mentor-requests]")?.querySelector<HTMLElement>("[data-mentor-spots]") ?? null;
    element?.replaceChildren();
    setSpots(element);
    // A panel named in the URL is open now, and an answer's notice has been read: a reload repeats neither.
    const url = new URL(window.location.href);
    if ([REQUEST_PARAM, PANEL_PARAM, ANSWERED_PARAM].some(key => url.searchParams.has(key))) {
      for (const key of [REQUEST_PARAM, PANEL_PARAM, ANSWERED_PARAM]) url.searchParams.delete(key);
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
    // Only on arrival: from then on the island owns the spots.
  }, []);

  const card = (request: MentorRequest, compact = false) => (
    <RequestCard
      key={request.id} store={store} request={request} mentors={mentors} now={now} path={path} compact={compact} hydrated={hydrated}
      open={open?.requestId === request.id ? open : null}
      refused={refused?.requestId === request.id ? refused : null}
      onPanel={(panel) => setOpen(panel ? { requestId: request.id, panel, pressed: true } : null)}
      onAnswering={() => {
        if (refused?.requestId === request.id) setRefused(null);
      }}
    />
  );

  return (
    <div ref={root} className="min-w-0" data-mentor-requests-list>
      <output className="sr-only" aria-live="polite">{state.announcement}</output>
      {waiting.length === 0 ? (
        <div data-waiting-count={0}>
          <EmptyState title="Nothing waiting for you" headingLevel={2}>
            When someone asks for your time, their request appears here with the work they attached.
          </EmptyState>
        </div>
      ) : (
        <>
          <h2 className="text-xl text-ink-primary" data-waiting-count={stillWaiting}>
            {stillWaiting > 0 ? waitingText(stillWaiting, state.nextCursor !== null) : "Nothing waiting for you"}
          </h2>
          <ul className="mt-4 flex flex-col gap-4">{waiting.map(request => card(request))}</ul>
        </>
      )}

      {earlier.length > 0 && (
        <section aria-labelledby="earlier-requests" className="mt-10">
          <h2 id="earlier-requests" className="text-lg text-ink-primary">Earlier</h2>
          <ul className="mt-3 flex flex-col gap-3">{earlier.map(request => card(request, true))}</ul>
        </section>
      )}
      {state.nextCursor !== null && (
        <Button className="mt-4" loading={state.loadingMore} onClick={() => void store.loadMore()}>Show earlier requests</Button>
      )}
      {spots && createPortal(<MentorSpots availability={availability} used={used} />, spots)}
    </div>
  );
}

function RequestCard({ store, request, mentors, now, path, compact, hydrated, open, refused, onPanel, onAnswering }: {
  store: MentorRequestsStore; request: MentorRequest; mentors: readonly MentorDirectoryItem[]; now: number; path: string; compact: boolean;
  hydrated: boolean;
  /** This card's open panel, if the list's one open panel is here. */
  open: OpenPanel | null;
  /** Why an answer posted to the page without JavaScript did not go through. */
  refused: ServerAnswer | null;
  onPanel: (panel: AnswerPanel | null) => void;
  /** An answer is on its way from this card. */
  onAnswering: () => void;
}) {
  const state = useMentorRequests(store, current => ({
    status: shownStatus(current, request), pending: current.pending[request.id], failed: current.failed[request.id],
  }), (a, b) => a.status === b.status && a.pending === b.pending && a.failed === b.failed);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requester = request.requester;
  const name = firstName(requester.name);
  const whoId = requestAnchor(request.id);
  const context = personContext(requester);
  const view = mentorStatus(request, state.status);
  const answerable = state.status === "PENDING" && !state.pending && request.check !== "reported";

  function answered<T>(run: () => Promise<T>): Promise<T> {
    onAnswering();
    const result = run();
    // The buttons give way to the answer: focus stays on this request (its heading), and the live
    // region says how it went.
    headingRef.current?.focus();
    // Answered (or reported), the request's notice no longer counts: the bell and the tab read again.
    void result.then(done => {
      if (done) requestAttentionRefresh();
      return done;
    }, () => null);
    return result;
  }

  return (
    <Card as="li" aria-labelledby={whoId} className="flex flex-col gap-4" data-mentor-request={request.id} data-status={state.status}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <Avatar id={requester.id} name={requester.name} src={requester.avatarUrl ?? undefined} size={compact ? "md" : "lg"} decorative />
        <div className="min-w-0 flex-1">
          <h3
            ref={headingRef} tabIndex={-1} id={whoId}
            className={cx("w-fit max-w-full rounded-sm text-lg leading-snug font-bold break-words text-ink-primary", FOCUS_RING)}
            data-request-heading
          >
            {requester.name}
          </h3>
          <p className="text-sm text-ink-secondary">{[context, requestMeta(request, now)].filter(Boolean).join(" · ")}</p>
        </div>
        {!answerable && <Chip tone={view.tone}>{state.pending ? `${view.label}…` : view.label}</Chip>}
      </div>

      <blockquote className="text-[0.9375rem] leading-relaxed break-words text-ink-primary sm:text-base">
        <span className="sr-only">{name} wrote: </span>“<MaskedText text={request.note} />”
      </blockquote>
      {request.project && !compact && <div className="max-w-xl"><EmbedCard embed={request.project} /></div>}
      {view.detail && <p className="text-sm text-ink-secondary">{view.detail}</p>}

      {/* The live region has said it already; this keeps it in view beside the request. */}
      {state.failed && !state.failed.stale ? (
        <Notice tone="danger" announce="none">{DIDNT_GO_THROUGH}</Notice>
      ) : refused && (
        <div data-request-answer-error={request.id}>
          <Notice tone="danger" focusOnLoad>{refused.failure}</Notice>
        </div>
      )}

      {/* Mounted while the server's request waits, and only hidden while an answer is on its way, so a
          suggestion or report that fails comes back with what the mentor wrote. */}
      {request.status === "PENDING" && request.check !== "reported" && (
        <RequestAnswers
          store={store} request={request} mentors={mentors} now={now} path={path} whoId={whoId} busy={!answerable} hydrated={hydrated}
          open={open} draft={refused?.panel ? refused : null} onPanel={onPanel} onAnswer={answered}
        />
      )}
      {state.status === "ACCEPTED" && request.channelId && (
        <ButtonLink href={conversationHref(request.channelId)} trailingIcon={<PiArrowRight className="size-4" />} className="w-fit">
          Open conversation with {name}
        </ButtonLink>
      )}
    </Card>
  );
}

/** What every answer's form carries: what it does, and to which request. */
function AnswerFields({ intent, requestId }: { intent: AnswerIntent; requestId: string }) {
  return (
    <>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="requestId" value={requestId} />
    </>
  );
}

/** A panel sits in its card as a part of it, under a hairline, never as a card of its own. */
const PANEL = "flex flex-col gap-4 border-t border-hairline pt-4";

interface PanelProps {
  request: MentorRequest;
  path: string;
  name: string;
  /** A press opened the panel here: focus moves into it. */
  pressed: boolean;
  hydrated: boolean;
  /** What was written before a post without JavaScript did not go through. */
  draft: ServerAnswer | null;
  onCancel: () => void;
}

/** The three answers and a report, and the panels that replace them: a suggestion, "Not this month", or a report. */
function RequestAnswers({ store, request, mentors, now, path, whoId, busy, hydrated, open, draft, onPanel, onAnswer }: {
  store: MentorRequestsStore; request: MentorRequest; mentors: readonly MentorDirectoryItem[]; now: number; path: string;
  /** The request's heading, which every answer names. */
  whoId: string;
  /** An answer is on its way: nothing here can be pressed, and the panels keep their drafts. */
  busy: boolean;
  hydrated: boolean;
  open: OpenPanel | null;
  draft: ServerAnswer | null;
  onPanel: (panel: AnswerPanel | null) => void;
  onAnswer: <T>(run: () => Promise<T>) => Promise<T>;
}) {
  const actionsRef = useRef<HTMLDivElement>(null);
  const name = firstName(request.requester.name);
  const backToAnswers = (trigger: AnswerPanel) => {
    onPanel(null);
    requestAnimationFrame(() => actionsRef.current?.querySelector<HTMLElement>(`[data-answer-trigger="${trigger}"]`)?.focus());
  };
  // Without JavaScript each opens its panel through the page's URL; with it, in place.
  const opens = (panel: AnswerPanel) => ({
    type: "submit" as const, name: PANEL_PARAM, value: panel, "aria-describedby": whoId, "data-answer-trigger": panel,
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      onPanel(panel);
    },
  });
  const panel = { request, path, name, pressed: open?.pressed ?? false, hydrated, draft: draft?.panel === open?.panel ? draft : null };

  return (
    <div hidden={busy}>
      {open === null && (
        <div ref={actionsRef} className="flex flex-wrap items-center gap-2">
          <form method="post" action={path} className="contents" onSubmit={(event) => { event.preventDefault(); void onAnswer(() => store.accept(request.id)); }}>
            <AnswerFields intent="accept" requestId={request.id} />
            {/* Each answer names whose request it answers, as the list holds several. Quiet on every card. */}
            <Button type="submit" icon={<PiCheck />} aria-describedby={whoId}>Accept</Button>
          </form>
          <form method="get" action={`${path}#${whoId}`} className="contents">
            <input type="hidden" name={REQUEST_PARAM} value={request.id} />
            <Button {...opens("suggest")}>Suggest another mentor</Button>
            <Button variant="ghost" {...opens("decline")}>Not this month</Button>
            <Button variant="ghost" size="sm" className="sm:ml-auto" {...opens("report")}>Report this request</Button>
          </form>
        </div>
      )}
      {open?.panel === "suggest" && (
        <SuggestMentor
          {...panel}
          mentors={mentors}
          now={now}
          onCancel={() => backToAnswers("suggest")}
          onSuggest={(choice) => { void onAnswer(() => store.redirect(request.id, choice)); }}
        />
      )}
      {open?.panel === "decline" && (
        <DeclineRequest
          {...panel}
          onCancel={() => backToAnswers("decline")}
          onDecline={(note) => { void onAnswer(() => store.decline(request.id, note || undefined)); }}
        />
      )}
      {open?.panel === "report" && (
        <ReportRequest
          {...panel}
          onCancel={() => backToAnswers("report")}
          onReport={(reason) => { void onAnswer(() => store.report(request.id, reason)); }}
        />
      )}
    </div>
  );
}

/** Moves focus to the panel's first field when a press opened it. */
function useFocusOnOpen(pressed: boolean) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (pressed) formRef.current?.querySelector<HTMLElement>("input:not([type=hidden]), textarea")?.focus();
  }, [pressed]);
  return formRef;
}

/** A panel's Cancel: back to the answers in place, or without JavaScript, the page without the panel. */
function Cancel({ path, request, hydrated, onCancel }: Pick<PanelProps, "path" | "request" | "hydrated" | "onCancel">) {
  return hydrated
    ? <Button onClick={onCancel}>Cancel</Button>
    : <ButtonLink href={`${path}#${requestAnchor(request.id)}`}>Cancel</ButtonLink>;
}

const text = (form: HTMLFormElement, field: string) => String(new FormData(form).get(field) ?? "").trim();

/**
 * "Not this month" (QA4-03): one more press sends it as it is; a kind word is optional, and the person
 * asking reads it with the answer ("try again in December", or who else might help).
 */
function DeclineRequest({ request, path, name, pressed, hydrated, draft, onCancel, onDecline }: PanelProps & { onDecline: (note: string) => void }) {
  const formRef = useFocusOnOpen(pressed);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onDecline(text(event.currentTarget, "note"));
  }

  return (
    <form ref={formRef} method="post" action={path} onSubmit={submit} noValidate className={PANEL} data-decline-request>
      <AnswerFields intent="decline" requestId={request.id} />
      <TextAreaField
        id={`${request.id}-decline-note`} name="note" label={`A note for ${name}`} optional rows={2} maxLength={NOTE_MAX} defaultValue={draft?.note}
        hint={`${name} sees it with your answer. For example, when you might have time, or who else could help. It's fine to send it without one.`}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary">Send: not this month</Button>
        <Cancel path={path} request={request} hydrated={hydrated} onCancel={onCancel} />
      </div>
    </form>
  );
}

/**
 * "Report this request" (B-4.1 checks): for a note that shouldn't be here, not for a request the mentor
 * would rather not take ("Not this month" is that). TTV checks it, and it closes for the mentor meanwhile;
 * the person asking sees only that it is being checked, never who opened the check.
 */
function ReportRequest({ request, path, name, pressed, hydrated, draft, onCancel, onReport }: PanelProps & { onReport: (reason: string) => void }) {
  const formRef = useFocusOnOpen(pressed);
  const [error, setError] = useState(draft?.error ?? "");
  const id = `${request.id}-report-reason`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = text(event.currentTarget, "reason");
    if (!reason) {
      setError(REPORT_REQUIRED);
      event.currentTarget.querySelector<HTMLTextAreaElement>(`#${CSS.escape(id)}`)?.focus();
      return;
    }
    onReport(reason);
  }

  return (
    <form ref={formRef} method="post" action={path} onSubmit={submit} onChange={() => setError("")} noValidate className={PANEL} data-report-request>
      <AnswerFields intent="report" requestId={request.id} />
      <TextAreaField
        id={id} name="reason" label="What's wrong with this request?" rows={3} maxLength={NOTE_MAX} required defaultValue={draft?.note}
        error={error || undefined}
        hint={`For a note that breaks how we talk to each other. TTV checks it, and it closes for you meanwhile. ${name} sees only that it's being checked, not that you reported it. If you'd just rather not take it, "Not this month" is enough.`}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary">Send report</Button>
        <Cancel path={path} request={request} hydrated={hydrated} onCancel={onCancel} />
      </div>
    </form>
  );
}

function SuggestMentor({ request, path, name, pressed, hydrated, draft, mentors, now, onCancel, onSuggest }: PanelProps & {
  mentors: readonly MentorDirectoryItem[]; now: number;
  onSuggest: (choice: { mentorId: string; mentorName: string; note?: string }) => void;
}) {
  // The panel replaces the button that opened it: focus moves to its first choice, or its note when there is none.
  const formRef = useFocusOnOpen(pressed);
  const choices = useMemo(() => mentors.filter(item => item.person.id !== request.requester.id && item.person.id !== request.mentor.id), [mentors, request]);
  const [error, setError] = useState(draft?.error ?? "");
  const field = suggestField(request.id);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosen = text(event.currentTarget, field);
    const choice = choices.find(item => item.person.id === chosen);
    if (!choice) {
      setError(CHOOSE_MENTOR);
      return;
    }
    const note = text(event.currentTarget, "note");
    onSuggest({ mentorId: choice.person.id, mentorName: choice.person.name, ...(note ? { note } : {}) });
  }

  return (
    <form ref={formRef} method="post" action={path} onSubmit={submit} onChange={() => setError("")} noValidate className={PANEL} data-suggest-mentor>
      <AnswerFields intent="redirect" requestId={request.id} />
      <ChoiceGroup
        name={field} label={`Who might be better placed for ${name}?`} required error={error || undefined}
        defaultValue={draft?.mentorId ?? undefined}
        hint={choices.length === 0 ? "No other mentors are listed right now." : undefined}
        options={choices.map(item => ({ value: item.person.id, label: item.person.name, hint: `${item.headline} · ${capacityView(item.capacity, now).text}` }))}
      />
      <TextAreaField id={`${request.id}-suggest-note`} name="note" label={`A note for ${name}`} optional rows={2} maxLength={NOTE_MAX} defaultValue={draft?.note} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={choices.length === 0}>Send suggestion</Button>
        <Cancel path={path} request={request} hydrated={hydrated} onCancel={onCancel} />
      </div>
    </form>
  );
}
