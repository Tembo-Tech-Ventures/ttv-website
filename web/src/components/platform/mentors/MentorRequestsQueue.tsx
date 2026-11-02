import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { PiArrowRight, PiCheck, PiPauseCircle } from "react-icons/pi";
import type {
  MentorAvailability, MentorDirectoryItem, MentorRequest, MentorRequestList,
} from "@/lib/platform/contracts";
import type { ApiClient } from "@/lib/platform/client/apiClient";
import { useMentorRequests } from "@/lib/platform/client/hooks/mentoring";
import { createMentorRequestsStore, shownStatus, type MentorRequestsStore } from "@/lib/platform/client/mentor-requests";
import { firstName } from "@/components/channels/channel-format";
import EmbedCard from "@/components/channels/EmbedCard";
import { Avatar, Button, Card, Chip } from "@/components/platform/ui";
import { BUTTON_VARIANTS, FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import {
  capacityView, conversationPath, MENTOR_AVAILABILITY_PATH, mentorStatus, monthName, openingDate, personContext,
  requestMeta, usedShare, waitingText,
} from "./mentor-display";
// oxlint-disable-next-line import/no-unassigned-import -- The embed card's stylesheet (channels.css).
import "@/components/channels/channels.css";
// oxlint-disable-next-line import/no-unassigned-import -- Mentor connections stylesheet.
import "./mentors.css";

export interface MentorRequestsQueueProps {
  /** The requests this mentor received (first page, newest first). */
  initial: MentorRequestList;
  /** Listed mentors this one can suggest instead (the directory never lists the caller). */
  mentors: readonly MentorDirectoryItem[];
  availability: MentorAvailability;
  now: number;
  /** A fixture client for the DEV harness. Live pages call the API. */
  api?: ApiClient;
}

const LINK = cx("inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold pointer-coarse:min-h-11", BUTTON_VARIANTS.quiet, FOCUS_RING);
const FREED = new Set(["REDIRECTED", "DECLINED", "WITHDRAWN"]);

/**
 * Mentoring → Requests (screen 06): who is asking for this mentor's time,
 * with the work attached, and three answers. Accepting opens a conversation
 * in Community; suggesting another mentor hands the person a better-placed
 * name; "Not this month" is one tap and counts against nobody. Every answer
 * shows at once and is put back if the server refuses it.
 */
export default function MentorRequestsQueue({ initial, mentors, availability, now, api }: MentorRequestsQueueProps) {
  const [store] = useState(() => createMentorRequestsStore({ as: "mentor", initial, ...(api ? { api } : {}) }));
  const state = useMentorRequests(store);
  // Grouped as the page arrived, so a request answered here stays where the mentor's eyes are.
  const [waitingIds] = useState(() => new Set(initial.items.filter(item => item.status === "PENDING").map(item => item.id)));
  const waiting = state.items.filter(item => waitingIds.has(item.id));
  const earlier = state.items.filter(item => !waitingIds.has(item.id));
  const stillWaiting = waiting.filter(item => shownStatus(state, item) === "PENDING").length;

  // A spot is held by each waiting request and each one accepted this month: an answer other than
  // accepting frees one, so the rail follows the answers given here without another read.
  const freed = waiting.filter(item => item.status !== "PENDING" && FREED.has(item.status)).length;
  const used = Math.max(0, availability.capacity.used - freed);

  return (
    <div className="mentoring-requests" data-mentor-requests>
      <output className="sr-only" aria-live="polite">{state.announcement}</output>
      <div className="min-w-0">
        <h2 className="font-body text-xl font-bold text-ink-primary" data-waiting-count={stillWaiting}>
          {stillWaiting > 0 ? waitingText(stillWaiting) : "Nothing waiting for you"}
        </h2>
        {waiting.length === 0 ? (
          <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-ink-secondary">
            When someone asks for your time, their request appears here with the work they attached.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {waiting.map(request => <RequestCard key={request.id} store={store} request={request} mentors={mentors} now={now} />)}
          </ul>
        )}

        {earlier.length > 0 && (
          <section aria-labelledby="earlier-requests" className="mt-10">
            <h2 id="earlier-requests" className="font-body text-lg font-bold text-ink-primary">Earlier</h2>
            <ul className="mt-3 flex flex-col gap-3">
              {earlier.map(request => <RequestCard key={request.id} store={store} request={request} mentors={mentors} now={now} compact />)}
            </ul>
          </section>
        )}
        {state.nextCursor !== null && (
          <Button className="mt-4" loading={state.loadingMore} onClick={() => void store.loadMore()}>Show earlier requests</Button>
        )}
      </div>

      <MonthRail availability={availability} used={used} now={now} />
    </div>
  );
}

function RequestCard({ store, request, mentors, now, compact = false }: {
  store: MentorRequestsStore; request: MentorRequest; mentors: readonly MentorDirectoryItem[]; now: number; compact?: boolean;
}) {
  const state = useMentorRequests(store, current => ({
    status: shownStatus(current, request), pending: current.pending[request.id], failed: current.failed[request.id],
  }), (a, b) => a.status === b.status && a.pending === b.pending && a.failed === b.failed);
  const [suggesting, setSuggesting] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const ids = useId();
  const requester = request.requester;
  const name = firstName(requester.name);
  const context = personContext(requester);
  const view = mentorStatus(request, state.status);
  const open = state.status === "PENDING" && !state.pending;

  function answered(run: () => Promise<unknown>) {
    void run();
    // The buttons give way to the answer: keep focus on the request, where the outcome is read.
    statusRef.current?.focus();
  }

  return (
    <Card as="li" aria-labelledby={`${ids}-who`} className="flex flex-col gap-4" data-mentor-request={request.id} data-status={state.status}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <Avatar id={requester.id} name={requester.name} src={requester.avatarUrl ?? undefined} size={compact ? "md" : "lg"} decorative />
        <div className="min-w-0 flex-1">
          <h3 id={`${ids}-who`} className="text-lg leading-snug font-bold break-words text-ink-primary">{requester.name}</h3>
          <p className="text-sm text-ink-secondary">{[context, requestMeta(request, now)].filter(Boolean).join(" · ")}</p>
        </div>
        {!open && <Chip tone={view.tone}>{state.pending ? `${view.label}…` : view.label}</Chip>}
      </div>

      <blockquote className="text-[0.9375rem] leading-relaxed break-words text-ink-primary sm:text-base">
        <span className="sr-only">{name} wrote: </span>“{request.note}”
      </blockquote>
      {request.project && !compact && <div className="max-w-xl"><EmbedCard embed={request.project} /></div>}
      {view.detail && <p className="text-sm text-ink-secondary">{view.detail}</p>}

      <p ref={statusRef} tabIndex={-1} className="sr-only focus:not-sr-only focus:text-sm focus:text-ink-secondary" data-request-outcome>
        {state.pending ? `${view.label}…` : open ? `Waiting for your answer to ${name}` : view.label}
      </p>
      {state.failed && !state.failed.stale && (
        <output className="text-sm font-semibold text-danger-ink">That didn't go through, so nothing changed. Try again.</output>
      )}

      {open && !suggesting && (
        <div ref={actionsRef} className="flex flex-wrap items-center gap-2">
          {/* Each answer names whose request it answers, as the list holds several. */}
          <Button variant="primary" icon={<PiCheck />} aria-describedby={`${ids}-who`} onClick={() => answered(() => store.accept(request.id))}>Accept</Button>
          <Button aria-describedby={`${ids}-who`} onClick={() => setSuggesting(true)} data-suggest-trigger>Suggest another mentor</Button>
          <Button variant="ghost" aria-describedby={`${ids}-who`} onClick={() => answered(() => store.decline(request.id))}>Not this month</Button>
        </div>
      )}
      {open && suggesting && (
        <SuggestMentor
          request={request}
          mentors={mentors}
          now={now}
          onCancel={() => {
            setSuggesting(false);
            requestAnimationFrame(() => actionsRef.current?.querySelector<HTMLElement>("[data-suggest-trigger]")?.focus());
          }}
          onSuggest={(choice) => { setSuggesting(false); answered(() => store.redirect(request.id, choice)); }}
        />
      )}
      {state.status === "ACCEPTED" && request.channelId && (
        <a href={conversationPath(request.channelId)} className={cx(LINK, "w-fit")}>
          Open conversation with {name} <PiArrowRight aria-hidden className="size-4" />
        </a>
      )}
    </Card>
  );
}

function SuggestMentor({ request, mentors, now, onCancel, onSuggest }: {
  request: MentorRequest; mentors: readonly MentorDirectoryItem[]; now: number;
  onCancel: () => void; onSuggest: (choice: { mentorId: string; mentorName: string; note?: string }) => void;
}) {
  const ids = useId();
  const choices = useMemo(() => mentors.filter(item => item.person.id !== request.requester.id && item.person.id !== request.mentor.id), [mentors, request]);
  const [chosen, setChosen] = useState<string>("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const name = firstName(request.requester.name);
  const listRef = useRef<HTMLFieldSetElement>(null);

  // The panel replaces the button that opened it: focus moves to its first choice, or its note when there is none.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("input, textarea")?.focus();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const choice = choices.find(item => item.person.id === chosen);
    if (!choice) {
      setError("Choose a mentor to suggest.");
      return;
    }
    onSuggest({ mentorId: choice.person.id, mentorName: choice.person.name, ...(note.trim() ? { note: note.trim() } : {}) });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-2xl border border-hairline p-4" data-suggest-mentor>
      <fieldset ref={listRef} aria-describedby={error ? `${ids}-error` : undefined}>
        <legend className="text-[0.9375rem] font-semibold text-ink-primary">Who might be better placed for {name}?</legend>
        {choices.length === 0 ? (
          <p className="mt-2 text-sm text-ink-secondary">No other mentors are listed right now.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {choices.map(item => (
              <label key={item.person.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-hairline px-3 py-2 has-checked:border-peach-ink has-checked:bg-primary/10 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-peach-ink">
                <input
                  type="radio" name={`${ids}-mentor`} value={item.person.id} checked={chosen === item.person.id}
                  onChange={() => { setChosen(item.person.id); setError(""); }} className="size-4 accent-peach-ink"
                  aria-labelledby={`${ids}-${item.person.id}-name`} aria-describedby={`${ids}-${item.person.id}-about`}
                />
                <span className="min-w-0 flex-1">
                  <span id={`${ids}-${item.person.id}-name`} className="block text-sm font-semibold break-words text-ink-primary">{item.person.name}</span>
                  <span id={`${ids}-${item.person.id}-about`} className="block text-[0.8125rem] break-words text-ink-secondary">{item.headline} · {capacityView(item.capacity, now).text}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        {error && <p id={`${ids}-error`} className="mt-2 text-sm font-semibold text-danger-ink">{error}</p>}
      </fieldset>
      <div>
        <label htmlFor={`${ids}-note`} className="text-[0.9375rem] font-semibold text-ink-primary">
          A note for {name} <span className="font-normal text-ink-secondary">(optional)</span>
        </label>
        <textarea
          id={`${ids}-note`} rows={2} value={note} maxLength={2000} onChange={event => setNote(event.target.value)}
          className={cx("mt-2 w-full rounded-xl border border-hairline bg-ink-primary/4 px-3.5 py-2.5 text-[0.9375rem] text-ink-primary", FOCUS_RING)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={choices.length === 0}>Send suggestion</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function MonthRail({ availability, used, now }: { availability: MentorAvailability; used: number; now: number }) {
  const { limit } = availability.capacity;
  const full = used >= limit && limit > 0;
  const capacity = { ...availability.capacity, used };
  const opening = availability.capacity.nextOpeningAt;
  return (
    <aside aria-labelledby="mentoring-month" className="flex flex-col gap-4" data-mentoring-rail>
      <h2 id="mentoring-month" className="font-body text-lg font-bold text-ink-primary">Your {monthName(now)}</h2>
      <Card>
        <p className="text-sm text-ink-secondary">Spots used</p>
        <p className="mt-1 text-3xl font-bold text-ink-primary" data-spots-used>{used} of {limit}</p>
        <meter className="sr-only" min={0} max={Math.max(limit, 1)} value={used} aria-label="Spots used this month">{used} of {limit}</meter>
        <div className="mentor-meter mt-3" aria-hidden="true">
          <div className="mentor-meter__fill" style={{ width: `${Math.round(usedShare(capacity) * 100)}%` }} />
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
          {full
            ? opening !== null
              ? `You're full. Members see "Next opening ${openingDate(opening)}" instead of a request button.`
              : "You're full while these requests wait for your answer."
            : `When you're full, members see when your next opening is instead of a request button.`}
        </p>
      </Card>
      <Card>
        <h3 className="text-[0.9375rem] font-bold text-ink-primary">Open to</h3>
        {availability.areas.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Areas you help with">
            {availability.areas.map(area => <li key={area} className="flex"><Chip tone="ring">{area}</Chip></li>)}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink-secondary">No areas listed yet.</p>
        )}
        <p className="mt-4 flex items-center justify-between gap-3 text-sm text-ink-secondary">
          <span className="inline-flex items-center gap-2"><PiPauseCircle aria-hidden className="size-[1.125rem]" />Pause new requests</span>
          <span className="font-semibold text-ink-primary">{availability.paused ? "On" : "Off"}</span>
        </p>
        <a href={MENTOR_AVAILABILITY_PATH} className={cx(LINK, "mt-4 w-fit")}>Edit availability</a>
      </Card>
    </aside>
  );
}
