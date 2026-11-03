import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { PiCheck } from "react-icons/pi";
import {
  MentorRequestFormat,
  type Me, type MentorDirectoryItem, type MentorRequest, type MentorRequestList, type ProjectEmbed,
} from "@/lib/platform/contracts";
import type { ApiClient } from "@/lib/platform/client/apiClient";
import { useMentorRequests } from "@/lib/platform/client/hooks/mentoring";
import {
  askHref, directoryHref, hasOpenSpot, sameArea, type DirectoryFilters, type DirectoryUrlState,
} from "@/lib/platform/client/mentor-directory";
import { createRequestFormStore, type ServerRequestForm } from "@/lib/platform/client/mentor-request-form";
import { createMentorRequestsStore, shownStatus, type MentorRequestsState } from "@/lib/platform/client/mentor-requests";
import { useModalDialog } from "@/components/platform/overlays/useModalDialog";
import { FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import MentorCard, { type MentorCardStanding } from "./MentorCard";
import { AS_YOURSELF, conversationHref, FORMAT_LABELS, MENTOR_RESULTS_ID, requesterStatus, resultsHeading } from "./mentor-display";
import OwnRequests from "./OwnRequests";
import RequestForm, { type ConductPrompt } from "./RequestForm";
// oxlint-disable-next-line import/no-unassigned-import -- Mentor connections stylesheet.
import "./mentors.css";

export interface MentorsDirectoryProps {
  me: Me;
  /** This page's path, which every filter link keeps. */
  path: string;
  filters: DirectoryUrlState;
  /** Every listed mentor, whatever the filters: the drawer and suggestions can open any of them. */
  mentors: readonly MentorDirectoryItem[];
  /** The listed mentors these filters match, as the server returned them. */
  shown: readonly MentorDirectoryItem[];
  /** The area filters to offer. */
  areas: readonly string[];
  /** The requests this person sent (first page, newest first). */
  ownRequests: MentorRequestList;
  /** The person's own published projects, at their current revisions. */
  projects: readonly ProjectEmbed[];
  /** The habits' prompt; the drawer posts its agreement back to this page with the drawer open. */
  conduct: Omit<ConductPrompt, "action">;
  now: number;
  /** After a send without JavaScript that did not go through: whose drawer, what was written and why. */
  serverForm?: { mentorId: string; form: ServerRequestForm } | null;
  /** After a send without JavaScript that did: the new request, named by `?sent=`. */
  sent?: MentorRequest | null;
  /** A fixture client for the DEV harness. Live pages call the API. */
  api?: ApiClient;
}

const PILL = cx(
  "inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-[0.9375rem] font-semibold whitespace-nowrap transition-colors duration-150",
  "motion-reduce:transition-none pointer-coarse:min-h-11", FOCUS_RING,
);
const PILL_ON = "bg-ink-primary text-dark";
const PILL_OFF = "text-ink-secondary hover:bg-ink-primary/7 hover:text-ink-primary";

/** A filter's link lands on the results heading, so a keyboard carries on from the results (QA4-18). */
const toResults = (href: string) => `${href}#${MENTOR_RESULTS_ID}`;

function FilterLink({ href, active, small = false, children }: { href: string; active: boolean; small?: boolean; children: ReactNode }) {
  return (
    <a
      href={toResults(href)} aria-current={active ? "true" : undefined} data-filter-active={active || undefined}
      className={cx(PILL, small && "min-h-9 px-3.5 text-sm", active ? PILL_ON : PILL_OFF)}
    >
      {children}
    </a>
  );
}

/** The directory's filters: plain links that keep the URL, so they work without JavaScript. */
function FilterBar({ path, base, filters, areas }: { path: string; base: DirectoryFilters; filters: DirectoryUrlState; areas: readonly string[] }) {
  const howId = useId();
  return (
    <nav aria-label="Filter mentors" className="flex flex-col gap-3" data-mentor-filters>
      <fieldset className="flex flex-wrap items-center gap-x-1 gap-y-2">
        <legend className="sr-only">Area</legend>
        <FilterLink href={directoryHref(path, base, { area: null })} active={!filters.area}>All</FilterLink>
        {areas.map(area => (
          <FilterLink key={area} href={directoryHref(path, base, { area })} active={Boolean(filters.area && sameArea(filters.area, area))}>{area}</FilterLink>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <fieldset className="flex flex-wrap items-center gap-x-1 gap-y-2" aria-labelledby={howId}>
          <span id={howId} className="mr-2 text-sm text-ink-secondary">How</span>
          <FilterLink small href={directoryHref(path, base, { format: null })} active={!filters.format}>Any</FilterLink>
          {MentorRequestFormat.options.map(format => (
            <FilterLink small key={format} href={directoryHref(path, base, { format })} active={filters.format === format}>{FORMAT_LABELS[format]}</FilterLink>
          ))}
        </fieldset>
        <a
          href={toResults(directoryHref(path, base, { available: !filters.available }))}
          aria-current={filters.available ? "true" : undefined}
          className={cx(PILL, "border", filters.available ? "border-transparent bg-ink-primary text-dark" : "border-hairline text-ink-primary hover:bg-ink-primary/7")}
          data-filter-available
        >
          {/* The check is drawn only while the filter is on, so it never looks on when it is off (QA4-14). */}
          {filters.available && <PiCheck aria-hidden className="size-4" />}
          Has open spots
        </a>
      </div>
    </nav>
  );
}

function NoMentors({ path, filtered }: { path: string; filtered: boolean }) {
  return (
    <div className="mt-8 rounded-[1.125rem] border border-dashed border-hairline p-6 text-ink-secondary" data-mentors-empty>
      {filtered ? (
        <p>
          No mentors match these filters right now.{" "}
          <a href={toResults(path)} className={cx("font-semibold text-peach-ink underline underline-offset-4", FOCUS_RING)}>Show every mentor</a>
        </p>
      ) : (
        <p>No mentors are listed yet. Mentors appear here once they've set out their availability.</p>
      )}
    </div>
  );
}

/**
 * Where this person already stands with each mentor, from their own requests (QA4-12): a request still waiting
 * (or being checked) shows its status where "Ask for time" would be, since a second one would be refused, and
 * an accepted one leads to its conversation. Newest first, so the latest request to a mentor decides.
 */
export function standings(state: Pick<MentorRequestsState, "items" | "pending">): ReadonlyMap<string, MentorCardStanding> {
  const found = new Map<string, MentorCardStanding>();
  for (const request of state.items) {
    const status = shownStatus(state, request);
    const id = request.mentor.id;
    if (status === "PENDING") {
      found.set(id, { kind: "waiting", label: requesterStatus(request, status).label });
    } else if (status === "ACCEPTED" && request.channelId && !found.has(id)) {
      found.set(id, { kind: "conversation", href: conversationHref(request.channelId) });
    }
  }
  return found;
}

/**
 * Community → Mentors (screen 05): the directory, its filters (plain links,
 * held in the URL), the requests this person sent, and the "Ask for time"
 * drawer. Server-rendered, so the directory reads without JavaScript; asking
 * needs it.
 */
function sameStandings(a: ReadonlyMap<string, MentorCardStanding>, b: ReadonlyMap<string, MentorCardStanding>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, value] of a) {
    const other = b.get(id);
    if (!other || JSON.stringify(other) !== JSON.stringify(value)) return false;
  }
  return true;
}

export default function MentorsDirectory(props: MentorsDirectoryProps) {
  const { me, path, filters, mentors, shown, areas, projects, conduct, now, api, serverForm = null, sent: sentNow = null } = props;
  const headingId = useId();
  const root = useRef<HTMLDivElement>(null);
  // The request a send just made: once its drawer closes, focus goes to where it now shows (QA4-18).
  const justSent = useRef<MentorRequest | null>(null);
  // Until the island is interactive (and always without JavaScript) a drawer named by `?ask=` is a plain panel with a real form.
  const [hydrated, setHydrated] = useState(false);
  // The filters alone: following a filter, or closing the drawer, drops `?ask=`.
  const base: DirectoryFilters = useMemo(
    () => ({ area: filters.area, format: filters.format, available: filters.available }),
    [filters.area, filters.format, filters.available],
  );
  const [ownRequests] = useState(() => createMentorRequestsStore({ as: "requester", initial: props.ownRequests, ...(api ? { api } : {}) }));
  const [active, setActive] = useState<MentorDirectoryItem | null>(null);
  // Agreeing in one drawer holds for every drawer after it on this page (QA4-05).
  const [agreed, setAgreed] = useState(conduct.agreed);
  const agreedOnce = useCallback(() => setAgreed(true), []);
  const closed = useCallback(() => {
    setActive(null);
    window.history.replaceState(window.history.state, "", directoryHref(path, base) + window.location.hash);
    const request = justSent.current;
    justSent.current = null;
    // "Ask for time" gave way to the request's status on the card: focus that, or the request under Your requests.
    if (request) {
      const where = root.current?.querySelector<HTMLElement>(`[data-mentor-card="${CSS.escape(request.mentor.id)}"] [data-mentor-standing='waiting']`)
        ?? root.current?.querySelector<HTMLElement>(`[data-own-request="${CSS.escape(request.id)}"] [data-request-status]`);
      where?.focus();
    }
  }, [path, base]);
  const dialog = useModalDialog(closed);
  const { show } = dialog;
  const announcement = useMentorRequests(ownRequests, state => state.announcement);
  const standing = useMentorRequests(ownRequests, standings, sameStandings);

  // A full mentor's drawer opens only to say why a send without JavaScript just did not go through.
  const asked = filters.ask
    ? mentors.find(item => item.person.id === filters.ask && (hasOpenSpot(item) || serverForm?.mentorId === item.person.id)) ?? null
    : null;
  const shownMentor = hydrated ? active : asked;
  const form = useMemo(() => shownMentor ? createRequestFormStore({
    userId: me.user.id, mentor: shownMentor, projects, ...(api ? { api } : {}),
    initial: serverForm?.mentorId === shownMentor.person.id ? serverForm.form : null,
  }) : null, [shownMentor, me.user.id, projects, api, serverForm]);

  const ask = useCallback((item: MentorDirectoryItem, from: HTMLElement | null) => {
    if (!hasOpenSpot(item) && serverForm?.mentorId !== item.person.id) return;
    // A send that finished after its drawer closed left no close to move focus for: a new drawer starts clean.
    justSent.current = null;
    setActive(item);
    window.history.replaceState(window.history.state, "", askHref(path, base, item.person.id));
    show(from);
  }, [path, base, show, serverForm]);

  // Once interactive, `?ask=` opens that mentor's drawer as a dialog: a reload, or the return from agreeing to the habits
  // or from a send that did not go through. A `?sent=` notice has been read by then, so a reload does not repeat it.
  useEffect(() => {
    setHydrated(true);
    // Arriving from a filter link: say the results and their filters, and carry on from there (QA4-18).
    if (!asked && window.location.hash === `#${MENTOR_RESULTS_ID}`) {
      root.current?.querySelector<HTMLElement>(`#${MENTOR_RESULTS_ID}`)?.focus({ preventScroll: true });
    }
    if (asked) ask(asked, null);
    else if (new URLSearchParams(window.location.search).has("sent")) {
      window.history.replaceState(window.history.state, "", directoryHref(path, base) + window.location.hash);
    }
    // Only on arrival: later changes come from the person's own clicks.
  }, []); // oxlint-disable-line react-hooks/exhaustive-deps

  function sent(request: MentorRequest) {
    justSent.current = request;
    ownRequests.prepend(request);
  }

  const filtered = Boolean(filters.area || filters.format || filters.available);

  return (
    <div ref={root} className="mentors-directory" data-mentors-directory>
      <output className="sr-only" aria-live="polite">{announcement}</output>
      {sentNow && (
        <output className="mb-6 block rounded-2xl border border-ring/40 bg-ring/8 px-4 py-3 text-[0.9375rem] text-ink-primary" data-request-sent-notice>
          Request sent to {sentNow.mentor.name}. It's under Your requests while it waits, and you can withdraw it there.
          Some requests get a check from TTV before they reach a mentor; if yours does, it says so there.
        </output>
      )}
      {me.capabilities.isInstitution && (
        <p className="mb-6 rounded-2xl border border-hairline px-4 py-3 text-[0.9375rem] text-ink-secondary" data-mentors-as-yourself>
          {AS_YOURSELF}
        </p>
      )}
      <OwnRequests store={ownRequests} now={now} mentors={mentors} onAsk={ask} />

      <FilterBar path={path} base={base} filters={filters} areas={areas} />

      {/* Filter links land here (`#mentor-results`), so the next Tab reaches the first mentor (QA4-18). */}
      <h2
        id={MENTOR_RESULTS_ID} tabIndex={-1}
        className="mt-6 mb-3 scroll-mt-40 font-body text-[0.9375rem] font-semibold text-ink-secondary focus:outline-none"
        data-mentor-results
      >
        {resultsHeading(shown.length, filters, areas)}
      </h2>
      {shown.length > 0 ? (
        <ul className="mentor-grid" data-mentor-grid>
          {shown.map(item => (
            <MentorCard
              key={item.person.id} item={item} now={now} open={active?.person.id === item.person.id}
              askHref={askHref(path, base, item.person.id)} onAsk={ask} standing={standing.get(item.person.id) ?? null}
            />
          ))}
        </ul>
      ) : (
        <NoMentors path={path} filtered={filtered} />
      )}

      {!hydrated && shownMentor && form && (
        <section aria-labelledby={headingId} className="mentor-drawer mentor-drawer--static" data-mentor-drawer-static>
          <div className="mentor-drawer__sheet">
            <RequestForm
              store={form} mentor={shownMentor} projects={projects} headingId={headingId}
              conduct={{ ...conduct, agreed, action: askHref(path, base, shownMentor.person.id) }}
              action={askHref(path, base, shownMentor.person.id)} closeHref={directoryHref(path, base)}
              onClose={() => {}} onSent={sent}
            />
          </div>
        </section>
      )}
      <dialog {...dialog.props} aria-labelledby={hydrated ? headingId : undefined} className="mentor-drawer" data-mentor-drawer>
        {hydrated && active && form && (
          <div className="mentor-drawer__sheet">
            <RequestForm
              key={active.person.id}
              store={form}
              mentor={active}
              projects={projects}
              conduct={{ ...conduct, agreed, action: askHref(path, base, active.person.id) }}
              action={askHref(path, base, active.person.id)}
              headingId={headingId}
              onAgreed={agreedOnce}
              onClose={dialog.hide}
              onSent={sent}
            />
          </div>
        )}
      </dialog>
    </div>
  );
}
