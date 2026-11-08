import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MentorDirectoryItem, MentorRequest, MentorRequestList, ProjectEmbed } from "@/lib/platform/contracts";
import type { ApiClient } from "@/lib/platform/client/apiClient";
import { useMentorRequests } from "@/lib/platform/client/hooks/mentoring";
import { askHref, directoryHref, hasOpenSpot, type DirectoryFilters, type DirectoryUrlState } from "@/lib/platform/client/mentor-directory";
import { createRequestFormStore, type ServerRequestForm } from "@/lib/platform/client/mentor-request-form";
import { createMentorRequestsStore } from "@/lib/platform/client/mentor-requests";
import { useModalDialog } from "@/components/platform/overlays/useModalDialog";
import { MentorCardLive, sameStandings, standings } from "./MentorCard";
import { MENTOR_RESULTS_ID } from "./mentor-display";
import OwnRequests from "./OwnRequests";
import RequestForm, { type ConductPrompt } from "./RequestForm";
// oxlint-disable-next-line import/no-unassigned-import -- Mentor connections stylesheet.
import "./mentors.css";

export interface DirectoryRequestsProps {
  userId: string;
  /** This page's path, which the drawer's links and form keep. */
  path: string;
  filters: DirectoryUrlState;
  /** Every listed mentor, whatever the filters: the drawer and suggestions can open any of them. */
  mentors: readonly MentorDirectoryItem[];
  /** The requests this person sent (first page, newest first). */
  ownRequests: MentorRequestList;
  /** The person's own published projects, at their current revisions. */
  projects: readonly ProjectEmbed[];
  /** The habits' prompt; the drawer posts its agreement back to this page with the drawer open. */
  conduct: Omit<ConductPrompt, "action">;
  now: number;
  /** After a send without JavaScript that did not go through: whose drawer, what was written and why. */
  serverForm?: { mentorId: string; form: ServerRequestForm } | null;
  /** A fixture client for the DEV harness. Live pages call the API. */
  api?: ApiClient;
}

/** A card's live part, as the server rendered it: where the island draws it once interactive. */
interface CardSlot {
  mentorId: string;
  element: HTMLElement;
}

// The cards' live parts are taken over before the first paint, so nothing flickers; on the server, nothing runs.
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The directory around the island, where the cards and the results heading are. */
const directoryOf = (island: HTMLElement | null) => island?.closest<HTMLElement>("[data-mentors-directory]") ?? document.body;

/**
 * Community → Mentors' island (screen 05): Your requests, the "Ask for time" drawer, and each mentor
 * card's live part. The directory around it (filters, results, cards) renders on the server with no
 * island (MentorsDirectory.astro). Once interactive, the island draws each card's live part in place
 * (`data-mentor-live`), so "Ask for time" opens the drawer as a dialog and gives way to the request's
 * status once sent, and back once withdrawn. Until then, and always without JavaScript, the cards are
 * links and a drawer named by `?ask=` is a plain panel with a real form.
 */
export default function DirectoryRequests(props: DirectoryRequestsProps) {
  const { userId, path, filters, mentors, projects, conduct, now, api, serverForm = null } = props;
  const headingId = useId();
  const root = useRef<HTMLDivElement>(null);
  // The request the open drawer just sent: once it closes, focus goes to where the request now shows (QA4-18).
  // Only the open drawer's own send counts, so a send that settles after its drawer closed moves nothing.
  const justSent = useRef<MentorRequest | null>(null);
  const drawerFor = useRef<string | null>(null);
  // Until the island is interactive (and always without JavaScript) a drawer named by `?ask=` is a plain panel with a real form.
  const [hydrated, setHydrated] = useState(false);
  const [slots, setSlots] = useState<readonly CardSlot[]>([]);
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
    drawerFor.current = null;
    // "Ask for time" gave way to the request's status on the card: focus that, or the request under Your requests.
    if (request) {
      const onCard = directoryOf(root.current).querySelector<HTMLElement>(`[data-mentor-card="${CSS.escape(request.mentor.id)}"] [data-mentor-standing='waiting']`);
      const inList = root.current?.querySelector<HTMLElement>(`[data-own-request="${CSS.escape(request.id)}"] [data-request-status]`);
      // A mentor filtered out of the grid: their request is under Your requests, which opens to show it.
      if (!onCard) for (let fold = inList?.closest("details"); fold; fold = fold.parentElement?.closest("details")) fold.open = true;
      (onCard ?? inList)?.focus();
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
    userId, mentor: shownMentor, projects, ...(api ? { api } : {}),
    initial: serverForm?.mentorId === shownMentor.person.id ? serverForm.form : null,
  }) : null, [shownMentor, userId, projects, api, serverForm]);

  const ask = useCallback((item: MentorDirectoryItem, from: HTMLElement | null) => {
    if (!hasOpenSpot(item) && serverForm?.mentorId !== item.person.id) return;
    drawerFor.current = item.person.id;
    setActive(item);
    window.history.replaceState(window.history.state, "", askHref(path, base, item.person.id));
    show(from);
  }, [path, base, show, serverForm]);

  // Each card's live part, from here on: the island draws it where the server's stood.
  useBeforePaint(() => {
    const found: CardSlot[] = [];
    for (const element of directoryOf(root.current).querySelectorAll<HTMLElement>("[data-mentor-live]")) {
      const mentorId = element.dataset.mentorLive!;
      // A card for a mentor the island does not know (past the directory's limit) keeps the server's link.
      if (!mentors.some(item => item.person.id === mentorId)) continue;
      element.replaceChildren();
      found.push({ mentorId, element });
    }
    setSlots(found);
    // Only on arrival: from then on the island owns these parts.
  }, []);

  // Once interactive, `?ask=` opens that mentor's drawer as a dialog: a reload, or the return from agreeing to the habits
  // or from a send that did not go through. A `?sent=` notice has been read by then, so a reload does not repeat it.
  useEffect(() => {
    setHydrated(true);
    // Arriving from a filter link: say the results and their filters, and carry on from there (QA4-18).
    if (!asked && window.location.hash === `#${MENTOR_RESULTS_ID}`) {
      directoryOf(root.current).querySelector<HTMLElement>(`#${MENTOR_RESULTS_ID}`)?.focus({ preventScroll: true });
    }
    if (asked) ask(asked, null);
    else if (new URLSearchParams(window.location.search).has("sent")) {
      window.history.replaceState(window.history.state, "", directoryHref(path, base) + window.location.hash);
    }
    // Only on arrival: later changes come from the person's own clicks.
  }, []); // oxlint-disable-line react-hooks/exhaustive-deps

  function sent(request: MentorRequest) {
    if (drawerFor.current === request.mentor.id) justSent.current = request;
    ownRequests.prepend(request);
  }

  return (
    <div ref={root} data-directory-requests>
      <output className="sr-only" aria-live="polite">{announcement}</output>
      <OwnRequests store={ownRequests} now={now} mentors={mentors} onAsk={ask} />

      {slots.map(({ mentorId, element }) => {
        const item = mentors.find(mentor => mentor.person.id === mentorId)!;
        return createPortal(
          <MentorCardLive
            item={item} now={now} open={active?.person.id === mentorId}
            askHref={askHref(path, base, mentorId)} onAsk={ask} standing={standing.get(mentorId) ?? null}
          />,
          element,
          mentorId,
        );
      })}

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
