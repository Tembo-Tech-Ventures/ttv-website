import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
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
import { createMentorRequestsStore } from "@/lib/platform/client/mentor-requests";
import { useModalDialog } from "@/components/platform/overlays/useModalDialog";
import { FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import MentorCard from "./MentorCard";
import { FORMAT_LABELS, NEEDS_MEMBER } from "./mentor-display";
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
  /**
   * The person has a member account (a community profile or a cohort place), which asking needs
   * (B-4.1, #304). Without one the directory still reads, with no "Ask for time".
   */
  canAsk: boolean;
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

function FilterLink({ href, active, small = false, children }: { href: string; active: boolean; small?: boolean; children: ReactNode }) {
  return (
    <a
      href={href} aria-current={active ? "true" : undefined} data-filter-active={active || undefined}
      className={cx(PILL, small && "min-h-9 px-3.5 text-sm", active ? PILL_ON : PILL_OFF)}
    >
      {children}
    </a>
  );
}

/**
 * Community → Mentors (screen 05): the directory, its filters (plain links,
 * held in the URL), the requests this person sent, and the "Ask for time"
 * drawer. Server-rendered, so the directory reads without JavaScript; asking
 * needs it.
 */
export default function MentorsDirectory(props: MentorsDirectoryProps) {
  const { me, path, filters, mentors, shown, areas, projects, conduct, now, api, canAsk, serverForm = null, sent: sentNow = null } = props;
  const headingId = useId();
  // Until the island is interactive (and always without JavaScript) a drawer named by `?ask=` is a plain panel with a real form.
  const [hydrated, setHydrated] = useState(false);
  // The filters alone: following a filter, or closing the drawer, drops `?ask=`.
  const base: DirectoryFilters = useMemo(
    () => ({ area: filters.area, format: filters.format, available: filters.available }),
    [filters.area, filters.format, filters.available],
  );
  const [ownRequests] = useState(() => createMentorRequestsStore({ as: "requester", initial: props.ownRequests, ...(api ? { api } : {}) }));
  const [active, setActive] = useState<MentorDirectoryItem | null>(null);
  const closed = useCallback(() => {
    setActive(null);
    window.history.replaceState(window.history.state, "", directoryHref(path, base) + window.location.hash);
  }, [path, base]);
  const dialog = useModalDialog(closed);
  const { show } = dialog;
  const announcement = useMentorRequests(ownRequests, state => state.announcement);

  // A full mentor's drawer opens only to say why a send without JavaScript just did not go through.
  const asked = filters.ask
    ? mentors.find(item => item.person.id === filters.ask && ((canAsk && hasOpenSpot(item)) || serverForm?.mentorId === item.person.id)) ?? null
    : null;
  const shownMentor = hydrated ? active : asked;
  const form = useMemo(() => shownMentor ? createRequestFormStore({
    userId: me.user.id, mentor: shownMentor, projects, ...(api ? { api } : {}),
    initial: serverForm?.mentorId === shownMentor.person.id ? serverForm.form : null,
  }) : null, [shownMentor, me.user.id, projects, api, serverForm]);

  const ask = useCallback((item: MentorDirectoryItem, from: HTMLElement | null) => {
    if (!(canAsk && hasOpenSpot(item)) && serverForm?.mentorId !== item.person.id) return;
    setActive(item);
    window.history.replaceState(window.history.state, "", askHref(path, base, item.person.id));
    show(from);
  }, [path, base, show, serverForm, canAsk]);

  // Once interactive, `?ask=` opens that mentor's drawer as a dialog: a reload, or the return from agreeing to the habits
  // or from a send that did not go through. A `?sent=` notice has been read by then, so a reload does not repeat it.
  useEffect(() => {
    setHydrated(true);
    if (asked) ask(asked, null);
    else if (new URLSearchParams(window.location.search).has("sent")) {
      window.history.replaceState(window.history.state, "", directoryHref(path, base) + window.location.hash);
    }
    // Only on arrival: later changes come from the person's own clicks.
  }, []); // oxlint-disable-line react-hooks/exhaustive-deps

  function sent(request: MentorRequest) {
    ownRequests.prepend(request);
  }

  const filtered = Boolean(filters.area || filters.format || filters.available);

  return (
    <div className="mentors-directory" data-mentors-directory>
      <output className="sr-only" aria-live="polite">{announcement}</output>
      {sentNow && (
        <output className="mb-6 block rounded-2xl border border-ring/40 bg-ring/8 px-4 py-3 text-[0.9375rem] text-ink-primary" data-request-sent-notice>
          Request sent to {sentNow.mentor.name}. It's under Your requests while it waits, and you can withdraw it there.
        </output>
      )}
      {!canAsk && (
        <p className="mb-6 rounded-2xl border border-hairline px-4 py-3 text-[0.9375rem] text-ink-secondary" data-mentors-need-member>
          {NEEDS_MEMBER} You can still read who mentors here and what they help with.
        </p>
      )}
      <OwnRequests store={ownRequests} now={now} mentors={mentors} onAsk={ask} />

      <nav aria-label="Filter mentors" className="flex flex-col gap-3" data-mentor-filters>
        <fieldset className="flex flex-wrap items-center gap-x-1 gap-y-2">
          <legend className="sr-only">Area</legend>
          <FilterLink href={directoryHref(path, base, { area: null })} active={!filters.area}>All</FilterLink>
          {areas.map(area => (
            <FilterLink key={area} href={directoryHref(path, base, { area })} active={Boolean(filters.area && sameArea(filters.area, area))}>{area}</FilterLink>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <fieldset className="flex flex-wrap items-center gap-x-1 gap-y-2" aria-labelledby={`${headingId}-how`}>
            <span id={`${headingId}-how`} className="mr-2 text-sm text-ink-secondary">How</span>
            <FilterLink small href={directoryHref(path, base, { format: null })} active={!filters.format}>Any</FilterLink>
            {MentorRequestFormat.options.map(format => (
              <FilterLink small key={format} href={directoryHref(path, base, { format })} active={filters.format === format}>{FORMAT_LABELS[format]}</FilterLink>
            ))}
          </fieldset>
          <a
            href={directoryHref(path, base, { available: !filters.available })}
            aria-current={filters.available ? "true" : undefined}
            className={cx(PILL, "border", filters.available ? "border-transparent bg-ink-primary text-dark" : "border-hairline text-ink-primary hover:bg-ink-primary/7")}
            data-filter-available
          >
            <PiCheck aria-hidden className={cx("size-4", !filters.available && "opacity-40")} />
            Has open spots
          </a>
        </div>
      </nav>

      <h2 className="sr-only">{filtered ? "Mentors matching your filters" : "All mentors"}</h2>
      {shown.length > 0 ? (
        <ul className="mentor-grid" data-mentor-grid>
          {shown.map(item => (
            <MentorCard key={item.person.id} item={item} now={now} open={active?.person.id === item.person.id} canAsk={canAsk} onAsk={ask} />
          ))}
        </ul>
      ) : (
        <div className="mt-8 rounded-[1.125rem] border border-dashed border-hairline p-6 text-ink-secondary" data-mentors-empty>
          {filtered ? (
            <p>
              No mentors match these filters right now.{" "}
              <a href={path} className={cx("font-semibold text-peach-ink underline underline-offset-4", FOCUS_RING)}>Show every mentor</a>
            </p>
          ) : (
            <p>No mentors are listed yet. Mentors appear here once they've set out their availability.</p>
          )}
        </div>
      )}

      {!hydrated && shownMentor && form && (
        <section aria-labelledby={headingId} className="mentor-drawer mentor-drawer--static" data-mentor-drawer-static>
          <div className="mentor-drawer__sheet">
            <RequestForm
              store={form} mentor={shownMentor} projects={projects} headingId={headingId}
              conduct={{ ...conduct, action: askHref(path, base, shownMentor.person.id) }}
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
              conduct={{ ...conduct, action: askHref(path, base, active.person.id) }}
              action={askHref(path, base, active.person.id)}
              headingId={headingId}
              onClose={dialog.hide}
              onSent={sent}
            />
          </div>
        )}
      </dialog>
    </div>
  );
}
