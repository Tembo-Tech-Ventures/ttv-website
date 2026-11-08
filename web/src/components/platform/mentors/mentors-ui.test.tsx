// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MASKED_CONTACT, ROUTES, WORTH_ANOTHER_LOOK_LIMIT, type MentorDirectoryItem, type MentorRequestList } from "@/lib/platform/contracts";
import { acceptedMentorRequest } from "@/lib/platform/fixtures";
import { ATTENTION_REFRESH_EVENT } from "@/components/platform/shell/overlays";
import { availability, FIXTURE_NOW, meByPersona, mentors, people, pendingMentorRequest, worthAnotherLook } from "@/lib/platform/fixtures";
import { filterDirectory, NO_FILTERS, parseDirectoryUrl } from "@/lib/platform/client/mentor-directory";
import { createMentoringMock } from "@/lib/platform/client/mentoring.mock";
import type { MockReply } from "@/lib/platform/client/mockTransport";
import { MASKED_NOTE } from "@/components/channels/MaskedText";
import MentorMonthRail from "./MentorMonthRail";
import MentorRequestsQueue, { type MentorRequestsQueueProps } from "./MentorRequestsQueue";
import DirectoryRequests, { type DirectoryRequestsProps } from "./DirectoryRequests";
import { menuAlignment, wireFilterMenus } from "./filter-menus";
import { standings } from "./MentorCard";
import MentorDirectoryList, { splitAreas, TOP_AREAS, type MentorDirectoryListProps } from "./MentorDirectoryList";
import { isRecent, RECENT_DAYS } from "./OwnRequests";

const PATH = "/dashboard/community/mentors";
const conduct = { version: 1, habitsHref: "/dashboard/community/conduct", canAgree: true };

let root: Root;
let container: HTMLDivElement;
/** The directory's island, mounted into the page the server rendered (see `page`). */
let island: Root | null = null;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.history.replaceState(null, "", PATH);
});
afterEach(async () => {
  await act(async () => { island?.unmount(); root.unmount(); });
  island = null;
  container.remove();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

const q = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const all = (selector: string) => Array.from(container.querySelectorAll<HTMLElement>(selector));
const text = (selector: string) => q(selector)?.textContent ?? "";
const settle = () => act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });

async function directoryProps(options: {
  conductAgreed?: boolean; failure?: (request: Request) => MockReply | undefined; search?: string;
} = {}) {
  const mock = createMentoringMock({
    conductAgreed: options.conductAgreed, ...(options.failure ? { failure: options.failure } : {}),
  });
  const filters = parseDirectoryUrl(new URLSearchParams(options.search ?? ""));
  const [list, own] = await Promise.all([
    mock.api.call(ROUTES.listMentors, { query: {} }),
    mock.api.call(ROUTES.listMentorRequests, { query: { as: "requester" } }),
  ]);
  const props: DirectoryRequestsProps = {
    userId: meByPersona.wanjiku.user.id, path: PATH, filters, mentors: list.items, ownRequests: own, projects: mock.projects,
    now: FIXTURE_NOW, api: mock.api,
    conduct: { ...conduct, agreed: options.conductAgreed !== false, agree: vi.fn(async () => { mock.agreeConduct(); }) },
  };
  const base = { area: filters.area, format: filters.format, available: filters.available };
  const listProps: MentorDirectoryListProps = {
    path: PATH, filters: base, areas: ["Code review", "Career"], shown: filterDirectory(list.items, base),
    standings: standings({ items: own.items, pending: {} }), now: FIXTURE_NOW,
  };
  return { props, list: listProps, mock };
}

/** The page as MentorsDirectory.astro renders it on the server: the island, then the directory. */
function Page({ props, list }: { props: DirectoryRequestsProps; list: MentorDirectoryListProps }) {
  return <div data-mentors-directory><div data-island><DirectoryRequests {...props} /></div><MentorDirectoryList {...list} /></div>;
}

/** The page without JavaScript: its server render only. */
function serverPage(props: DirectoryRequestsProps, list: MentorDirectoryListProps) {
  const html = renderToString(<Page props={props} list={list} />);
  container.innerHTML = html;
  return html;
}

/** The page once interactive: the server's directory, with the island hydrated into its place. */
async function livePage(props: DirectoryRequestsProps, list: MentorDirectoryListProps) {
  serverPage(props, list);
  const mount = q("[data-island]")!;
  mount.replaceChildren();
  island = createRoot(mount);
  await act(async () => island!.render(<DirectoryRequests {...props} />));
}

const card = (item: MentorDirectoryItem) => q(`[data-mentor-card="${item.person.id}"]`)!;
const [david, mercy, joseph, samuel] = mentors.items;

describe("the mentor directory", () => {
  it("reads without JavaScript: cards, capacity, filters and the person's own requests", async () => {
    const { props, list } = await directoryProps({ search: "?area=Career&available=true" });
    const html = serverPage(props, { ...list, shown: mentors.items });
    expect(all("[data-mentor-card]")).toHaveLength(4);
    expect(card(david).textContent).toContain("2 of 3 spots open in November");
    // Wanjiku's request to David is still waiting, so his card says that where "Ask for time" would be (QA4-12).
    expect(card(david).querySelector("[data-ask-mentor]")).toBeNull();
    expect(card(david).querySelector("[data-mentor-standing='waiting']")?.textContent).toBe("Waiting for David");
    const askJoseph = card(joseph).querySelector("[data-ask-mentor]")!;
    expect(askJoseph.textContent).toBe("Ask for time");
    expect(askJoseph.getAttribute("aria-label")).toBe("Ask for time with Joseph Mutua");
    // A plain link until the island is interactive: it opens no dialog yet.
    expect(askJoseph.getAttribute("href")).toBe(`${PATH}?area=Career&available=true&ask=${joseph.person.id}`);
    expect(askJoseph.hasAttribute("aria-haspopup")).toBe(false);
    // Mercy is full: the next opening, and no button that does nothing.
    expect(card(mercy).textContent).toContain("Next opening 1 December");
    expect(card(mercy).querySelector("[data-mentor-full]")?.textContent).toBe("Full this month");
    expect(card(mercy).querySelector("button")).toBeNull();
    // Filters are links held in the URL; the views they name are the current page, and the toggle says it is on.
    expect(all("[data-mentor-filters] a[aria-current='page']").map((link) => link.textContent)).toEqual(["Career", "Any format"]);
    expect(q("[data-filter-available]")!.getAttribute("aria-current")).toBe("true");
    expect(q("[data-mentor-filters] [data-pill-nav]")!.getAttribute("aria-label")).toBe("Area");
    // Each lands on the results heading, which says what the filters chose (QA4-18).
    expect(q<HTMLAnchorElement>("[data-filter-available]")!.getAttribute("href")).toBe(`${PATH}?area=Career#mentor-results`);
    expect(all("[data-mentor-filters] a").every((link) => link.getAttribute("href")!.endsWith("#mentor-results"))).toBe(true);
    const results = q("h2[data-mentor-results]")!;
    expect(results.id).toBe("mentor-results");
    expect(results.textContent).toBe("4 mentors · Career · Has open spots");
    // An h2 in the kit's own type: no weight or face of its own.
    expect(results.className).not.toMatch(/font-(semibold|body)/);
    expect(all("[data-own-request]").map((row) => row.dataset.status)).toEqual(["PENDING", "ACCEPTED"]);
    expect(html).not.toContain("<dialog open");
    // One peach action at most, and none until a drawer is open: every card's "Ask for time" is quiet.
    expect(all("[data-variant='primary']")).toHaveLength(0);
    expect(all("[data-ask-mentor]").every((link) => link.dataset.variant === "quiet")).toBe(true);
  });

  it("leads to the conversation for a mentor who accepted, when nothing else is waiting with them", async () => {
    const { props, list } = await directoryProps();
    const own = { items: [acceptedMentorRequest], nextCursor: null };
    serverPage({ ...props, ownRequests: own }, { ...list, standings: standings({ items: own.items, pending: {} }) });
    const conversation = card(david).querySelector<HTMLAnchorElement>("[data-mentor-standing='conversation']")!;
    expect(conversation.textContent).toBe("Open your conversation with David ");
    expect(conversation.getAttribute("href")).toBe(`/dashboard/community/dm/${acceptedMentorRequest.channelId}`);
    // Asking again for another time is still fine.
    expect(card(david).querySelector("[data-ask-mentor]")).not.toBeNull();
    // Under Your requests, the conversation is a small quiet link-button.
    const open = q<HTMLAnchorElement>(`[data-own-request="${acceptedMentorRequest.id}"] a[href^='/dashboard/community/dm/']`)!;
    expect(open.textContent).toBe("Open conversation");
    expect([open.dataset.variant, open.dataset.size]).toEqual(["quiet", "sm"]);
    const state = { items: [acceptedMentorRequest], pending: {} };
    expect(standings(state).get(david.person.id)).toEqual({ kind: "conversation", href: `/dashboard/community/dm/${acceptedMentorRequest.channelId}` });
    // A newer request waiting with the same mentor wins, and a held one says so.
    const held = { ...pendingMentorRequest, check: "waiting" as const };
    expect(standings({ items: [held, acceptedMentorRequest], pending: {} }).get(david.person.id)).toEqual({ kind: "waiting", label: "Waiting for a check" });
    // Withdrawn (even while the server decides) frees the card again, back to its conversation.
    expect(standings({ items: [pendingMentorRequest, acceptedMentorRequest], pending: { [pendingMentorRequest.id]: { action: "withdraw", status: "WITHDRAWN" } } })
      .get(david.person.id)?.kind).toBe("conversation");
  });

  it("explains a held request kindly, with what happens next, and a way on once it wasn't sent (QA4-02)", async () => {
    const { props, list } = await directoryProps();
    const held = { ...pendingMentorRequest, check: "waiting" as const };
    serverPage({ ...props, ownRequests: { items: [held], nextCursor: null } }, list);
    const row = q(`[data-own-request="${held.id}"]`)!;
    expect(row.textContent).toContain("Waiting for a check before it's sent.");
    expect(row.querySelector("[data-request-next]")!.textContent).toBe(
      "Some requests get a check from TTV before they reach a mentor. It isn't a judgement on you, and there's nothing you need to do. You'll get a notice when it's done.",
    );
    expect(row.textContent).not.toMatch(/declin/i);
    const unsent = { ...pendingMentorRequest, status: "WITHDRAWN" as const, check: "not_sent" as const };
    serverPage({ ...props, ownRequests: { items: [unsent], nextCursor: null } }, list);
    const next = q(`[data-own-request="${unsent.id}"] [data-request-next]`)!;
    expect(next.textContent).toContain("You can ask again with a new note, or ask another mentor.");
    expect(next.querySelector("a")!.getAttribute("href")).toBe("/dashboard/community/conduct");
    // Withdraw says whose request it withdraws.
    serverPage(props, list);
    expect(q(`[data-own-request="${pendingMentorRequest.id}"] button`)!.getAttribute("aria-label")).toBe("Withdraw request to David Kamau");
  });

  it("puts every filter on one row: the top areas, the rest under More areas, and how as one menu (T06)", async () => {
    const areas = ["API design", "Python", "Accessibility", "Career advice", "Code review", "CSS", "Data modelling", "Kotlin"];
    const { props, list } = await directoryProps({ search: "?area=Kotlin" });
    serverPage(props, { ...list, areas });
    const nav = q("[data-mentor-filters]")!;
    const row = Array.from(nav.querySelectorAll<HTMLElement>("[data-pill-nav] a")).map((link) => link.textContent);
    // The chosen area shows on the row even though few mentors offer it.
    expect(row).toEqual(["All", ...areas.slice(0, TOP_AREAS), "Kotlin"]);
    const menus = Array.from(nav.querySelectorAll<HTMLDetailsElement>("details[data-filter-menu]"));
    expect(menus.map((menu) => menu.querySelector("summary")!.textContent)).toEqual(["More areas", "Any format"]);
    expect(Array.from(menus[0]!.querySelectorAll("a")).map((link) => link.textContent)).toEqual(areas.slice(TOP_AREAS, -1));
    // Closed until asked, and still plain links that land on the results.
    expect(menus.every((menu) => !menu.open)).toBe(true);
    expect(Array.from(menus[1]!.querySelectorAll("a")).map((link) => link.getAttribute("href"))).toEqual([
      `${PATH}?area=Kotlin#mentor-results`, `${PATH}?area=Kotlin&format=WRITTEN_REVIEW#mentor-results`,
      `${PATH}?area=Kotlin&format=CALL_30_MIN#mentor-results`, `${PATH}?area=Kotlin&format=QUICK_QUESTION#mentor-results`,
    ]);
    expect(splitAreas(areas.slice(0, 3), null)).toEqual({ shown: areas.slice(0, 3), more: [] });
  });

  it("hangs a filter menu from whichever edge keeps it inside the row (B1)", () => {
    const row = { left: 20, right: 370 };
    // First on a wrapped line: from its start, never past the row's start.
    expect(menuAlignment({ left: 20, right: 158 }, 208, row)).toBe("start");
    // At the row's end: from its end edge.
    expect(menuAlignment({ left: 250, right: 370 }, 208, row)).toBe("end");
    // Neither fits: its start, where the reading begins.
    expect(menuAlignment({ left: 100, right: 200 }, 400, row)).toBe("start");
  });

  it("closes a filter menu on Escape, back to its button, and on a press elsewhere", async () => {
    const { props, list } = await directoryProps();
    serverPage(props, list);
    const unwire = wireFilterMenus(q("[data-mentor-filters]")!);
    const menu = q<HTMLDetailsElement>("details[data-filter-menu]")!;
    menu.open = true;
    menu.querySelector("a")!.focus();
    menu.querySelector("a")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(menu.querySelector("summary"));
    menu.open = true;
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(menu.open).toBe(false);
    unwire();
    menu.open = true;
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(menu.open).toBe(true);
  });

  it("opens Your requests on arrival when a request has news: a suggestion, not this month or a check (S3)", async () => {
    const { props, list } = await directoryProps();
    const redirected = { ...pendingMentorRequest, id: "redirected", status: "REDIRECTED" as const, redirectedTo: people.joseph, updatedAt: FIXTURE_NOW };
    serverPage({ ...props, ownRequests: { items: [redirected, ...props.ownRequests.items.slice(1)], nextCursor: null } }, list);
    expect(q<HTMLDetailsElement>("[data-own-requests-fold]")!.open).toBe(true);
    expect(text("[data-own-requests-summary]")).toBe("1 with a suggestion · 1 accepted");
    // The heading is its own, in the flow above the summary, never painted over it (WCAG 1.4.12).
    const heading = q("[data-own-requests] > h2")!;
    expect(heading.textContent).toBe("Your requests");
    expect(heading.className).not.toMatch(/absolute|font-(bold|body)/);
    expect(heading.nextElementSibling).toBe(q("[data-own-requests-fold]"));
    expect(q("[data-own-requests-fold] summary h2")).toBeNull();
    // The suggestion is quiet: the drawer's Send is the page's one primary.
    const askSuggested = Array.from(q("[data-own-request='redirected']")!.querySelectorAll("button")).find((button) => button.textContent === "Ask Joseph Mutua")!;
    expect(askSuggested.dataset.variant).toBe("quiet");
  });

  it("folds Your requests to one line that says where they stand, and opens on request (T06)", async () => {
    const { props, list } = await directoryProps();
    await livePage(props, list);
    const fold = q<HTMLDetailsElement>("[data-own-requests-fold]")!;
    expect(fold.open).toBe(false);
    const summary = fold.querySelector("summary")!;
    expect(summary.textContent).toContain("Your requests: ");
    // A kit button, never peach words.
    expect(summary.className).toContain("bg-ink-primary/6");
    expect(summary.innerHTML).not.toContain("peach");
    expect(text("[data-own-requests-summary]")).toBe("1 waiting · 1 accepted");
    await act(async () => { summary.click(); });
    expect(fold.open).toBe(true);
    expect(all("[data-own-request]")).toHaveLength(2);
  });

  it("shows the mentor's reply with contact details masked as the channels' note (T03)", async () => {
    const { props, list } = await directoryProps();
    const declined = { ...pendingMentorRequest, id: "declined-masked", status: "DECLINED" as const, responseNote: `Not this month. Text me on ${MASKED_CONTACT}` };
    serverPage({ ...props, ownRequests: { items: [declined], nextCursor: null } }, list);
    const reply = q("[data-own-request='declined-masked'] blockquote")!;
    expect(reply.textContent).not.toContain(MASKED_CONTACT);
    expect(reply.querySelector(".channel-masked[role=note]")!.textContent).toBe(MASKED_NOTE);
  });

  it("keeps waiting and recent requests in view, and folds older answers under Earlier", async () => {
    const { props, list } = await directoryProps();
    const old = { ...pendingMentorRequest, id: "old-declined", status: "DECLINED" as const, createdAt: FIXTURE_NOW - 40 * 86_400_000, updatedAt: FIXTURE_NOW - 30 * 86_400_000 };
    const oldPending = { ...pendingMentorRequest, id: "old-pending", mentor: people.samuel, createdAt: FIXTURE_NOW - 30 * 86_400_000, updatedAt: FIXTURE_NOW - 30 * 86_400_000 };
    serverPage({ ...props, ownRequests: { items: [...props.ownRequests.items, oldPending, old], nextCursor: null } }, list);
    const earlier = q("[data-own-requests-earlier]")!;
    expect(earlier.querySelector("summary")!.textContent).toBe("Earlier (1)");
    // A ghost button, the kit's way out of the way.
    expect(earlier.querySelector("summary")!.className).toContain("hover:bg-ink-primary/7");
    expect(earlier.querySelectorAll("[data-own-request]")).toHaveLength(1);
    expect(earlier.querySelector("[data-own-request='old-declined']")).not.toBeNull();
    // Still waiting, however long ago it was asked, stays in view with its Withdraw.
    expect(q("[data-own-requests-fold] > div [data-own-request='old-pending']")).not.toBeNull();
    expect(isRecent(oldPending, FIXTURE_NOW)).toBe(true);
    expect(isRecent(old, FIXTURE_NOW)).toBe(false);
    expect(isRecent({ ...old, updatedAt: FIXTURE_NOW - (RECENT_DAYS - 1) * 86_400_000 }, FIXTURE_NOW)).toBe(true);
  });

  it("says when nothing matches, with the way back to every mentor, and when nobody is listed yet", async () => {
    const { props, list } = await directoryProps({ search: "?format=QUICK_QUESTION" });
    serverPage(props, { ...list, shown: [] });
    const empty = q("[data-mentors-empty] [data-empty-state]")!;
    expect(empty.querySelector("h3")!.textContent).toBe("No mentors match these filters");
    const back = empty.querySelector<HTMLAnchorElement>("a")!;
    expect([back.textContent, back.getAttribute("href"), back.dataset.variant]).toEqual(["Show every mentor", `${PATH}#mentor-results`, "quiet"]);
    expect(text("[data-mentor-results]")).toBe("0 mentors · Quick question");
    serverPage(props, { ...list, filters: NO_FILTERS, shown: [] });
    expect(text("[data-mentors-empty] h3")).toBe("No mentors listed yet");
    expect(q("[data-mentors-empty] a")).toBeNull();
  });

  it("opens the drawer on the note, keeps it in the URL, and returns focus to the button on close", async () => {
    const { props, list } = await directoryProps();
    await livePage(props, list);
    const ask = card(joseph).querySelector<HTMLAnchorElement>("[data-ask-mentor]")!;
    // Interactive now: the card's link opens a dialog.
    expect(ask.getAttribute("aria-haspopup")).toBe("dialog");
    ask.focus();
    await act(async () => ask.click());
    const dialog = q<HTMLDialogElement>("[data-mentor-drawer]")!;
    expect(dialog.open).toBe(true);
    expect(window.location.search).toBe(`?ask=${encodeURIComponent(joseph.person.id)}`);
    expect(dialog.textContent).toContain("Ask Joseph for time");
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
    expect(ask.getAttribute("aria-expanded")).toBe("true");
    // Still quiet while its drawer is open: the drawer's Send is the one primary.
    expect(ask.dataset.variant).toBe("quiet");
    expect(all("[data-variant='primary']").map((button) => button.textContent)).toEqual(["Send request"]);
    // Joseph offers calls and quick questions only, and the first is chosen; the kit's radios, each with its hint.
    expect(Array.from(dialog.querySelectorAll<HTMLInputElement>("input[name=format]")).map((input) => [input.value, input.checked])).toEqual([
      ["CALL_30_MIN", true], ["QUICK_QUESTION", false],
    ]);
    expect(dialog.querySelector("fieldset[data-field='format'] legend")!.textContent).toBe("How");
    expect(dialog.querySelector("[data-field$='-note'] label")!.textContent).toBe("What would you like help with?");
    await act(async () => dialog.close());
    expect(window.location.search).toBe("");
    expect(document.activeElement).toBe(ask);
  });

  it("opens the drawer from ?ask= on arrival, but never for a full mentor", async () => {
    const { props, list } = await directoryProps({ search: `?ask=${joseph.person.id}` });
    await livePage(props, list);
    expect(q<HTMLDialogElement>("[data-mentor-drawer]")!.open).toBe(true);
    await act(async () => island!.unmount());
    island = null;
    const full = await directoryProps({ search: `?ask=${mercy.person.id}` });
    await livePage(full.props, full.list);
    expect(q<HTMLDialogElement>("[data-mentor-drawer]")!.open).toBe(false);
  });

  it("renders the drawer named by ?ask= as a plain form until the page is interactive", async () => {
    const { props, list } = await directoryProps({ search: `?ask=${joseph.person.id}` });
    serverPage(props, list);
    const panel = q("[data-mentor-drawer-static]")!;
    const form = panel.querySelector("form")!;
    expect([form.getAttribute("method"), form.getAttribute("action")]).toEqual(["post", `${PATH}?ask=${joseph.person.id}`]);
    // Close and Cancel are the way out: ghost links back to the directory.
    const close = panel.querySelector<HTMLAnchorElement>("a[aria-label='Close']")!;
    const cancel = Array.from(panel.querySelectorAll("a")).find((link) => link.textContent === "Cancel")!;
    expect([close.getAttribute("href"), close.dataset.variant, cancel.getAttribute("href"), cancel.dataset.variant]).toEqual([PATH, "ghost", PATH, "ghost"]);
    expect(panel.querySelectorAll("[data-variant='primary']")).toHaveLength(1);
    // The kit's fields: a labelled note and radios, each format with its hint.
    expect(panel.querySelector("textarea[name=note]")!.getAttribute("aria-describedby")).toMatch(/-note-hint$/);
    expect(panel.querySelector("#format-CALL_30_MIN")!.hasAttribute("checked")).toBe(true);
    expect(panel.querySelector("#format-CALL_30_MIN-hint")!.textContent).toBe("A call you arrange together in the conversation.");
    expect(panel.querySelector("fieldset[data-field='project'] legend")!.textContent).toBe("Attach your work (optional)");
    expect(panel.querySelector("#project-blank")!.hasAttribute("checked")).toBe(true);
  });

  it("brings a refused send without JavaScript back with the reason, which takes focus", async () => {
    const { props, list } = await directoryProps({ search: `?ask=${joseph.person.id}` });
    const serverForm = {
      mentorId: joseph.person.id,
      form: { note: "Interview practice?", project: null, format: "QUICK_QUESTION" as const, status: "error" as const, errors: {}, failure: "limit" as const, failureMessage: null },
    };
    const html = serverPage({ ...props, serverForm }, list);
    const notice = q("[data-mentor-drawer-static] [data-request-error] [data-notice='danger']")!;
    expect(notice.textContent).toContain("You already have several requests waiting");
    // Server-rendered with autofocus, so focus lands on the reason before any script runs.
    expect(html).toMatch(/<div[^>]*autofocus=""[^>]*data-notice="danger"|<div[^>]*data-notice="danger"[^>]*autofocus=""/);
    expect(q<HTMLTextAreaElement>("[data-mentor-drawer-static] textarea")!.value).toBe("Interview practice?");
    expect(q<HTMLInputElement>("[data-mentor-drawer-static] #format-QUICK_QUESTION")!.hasAttribute("checked")).toBe(true);
    // Interactive, the drawer opens as a dialog on the same reason.
    q("[data-island]")!.replaceChildren();
    island = createRoot(q("[data-island]")!);
    await act(async () => island!.render(<DirectoryRequests {...props} serverForm={serverForm} />));
    const live = q("[data-mentor-drawer] [data-request-error] [data-notice='danger']")!;
    expect(document.activeElement).toBe(live);
    expect(live.getAttribute("role")).toBe("alert");
    // A field to fix comes back the same way, said under its field.
    const unfixed = { mentorId: joseph.person.id, form: { ...serverForm.form, note: "", status: "editing" as const, failure: null, errors: { note: "Say what you'd like help with." } } };
    await act(async () => island!.unmount());
    island = null;
    serverPage({ ...props, serverForm: unfixed }, list);
    expect(text("[data-mentor-drawer-static] [data-request-error]")).toContain("Your request wasn't sent. Fix what's marked above, then send it again.");
    expect(q("[data-mentor-drawer-static] [data-field-error]")!.textContent).toBe("Say what you'd like help with.");
    expect(q("[data-mentor-drawer-static] [data-request-error] [role]")).toBeNull();
  });

  it("explains what to fix, then sends and lists the request under Your requests", async () => {
    const { props, list, mock } = await directoryProps();
    await livePage(props, list);
    await act(async () => card(joseph).querySelector<HTMLElement>("[data-ask-mentor]")!.click());
    const form = q<HTMLFormElement>("[data-mentor-drawer] form")!;
    await act(async () => form.requestSubmit());
    expect(text("[data-mentor-drawer]")).toContain("Say what you'd like help with.");
    expect(q("[data-mentor-drawer] textarea")!.getAttribute("aria-invalid")).toBe("true");
    const textarea = q<HTMLTextAreaElement>("[data-mentor-drawer] textarea")!;
    expect(document.activeElement).toBe(textarea);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Could we talk through two offers I have?");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Choosing a format is the kit's radio, told to the draft.
    await act(async () => q<HTMLInputElement>("[data-mentor-drawer] #format-QUICK_QUESTION")!.click());
    await act(async () => form.requestSubmit());
    await settle();
    expect(q("[data-request-sent]")).not.toBeNull();
    expect(document.activeElement?.textContent).toBe("Request sent");
    expect(mock.requests().filter((r) => r.mentor.id === joseph.person.id && r.status === "PENDING" && r.format === "QUICK_QUESTION")).toHaveLength(1);
    expect(all("[data-own-request]")[0]!.textContent).toContain("Joseph Mutua");
    // Done: "Ask for time" has given way to the request's status, and focus goes there, not to the page's top (QA4-18).
    const done = Array.from(q("[data-request-sent]")!.querySelectorAll("button")).find((button) => button.textContent === "Done")!;
    await act(async () => done.click());
    expect(q<HTMLDialogElement>("[data-mentor-drawer]")!.open).toBe(false);
    expect(document.activeElement).toBe(card(joseph).querySelector("[data-mentor-standing='waiting']"));
  });

  it("gives a card its \"Ask for time\" back once its request is withdrawn", async () => {
    const { props, list } = await directoryProps();
    await livePage(props, list);
    expect(card(david).querySelector("[data-ask-mentor]")).toBeNull();
    await act(async () => q<HTMLButtonElement>(`[data-own-request="${pendingMentorRequest.id}"] button`)!.click());
    await settle();
    expect(card(david).querySelector("[data-mentor-standing='waiting']")).toBeNull();
    expect(card(david).querySelector("[data-ask-mentor]")!.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("puts focus on the results after a filter link, so Tab carries on into the mentors (QA4-18)", async () => {
    const { props, list } = await directoryProps({ search: "?area=Career" });
    window.history.replaceState(null, "", `${PATH}?area=Career#mentor-results`);
    await livePage(props, list);
    expect(document.activeElement).toBe(q("h2[data-mentor-results]"));
    expect(document.activeElement?.textContent).toBe(`${list.shown.length} mentor${list.shown.length === 1 ? "" : "s"} · Career`);
  });

  it("keeps a send going when the drawer closes mid-send, and lists the request once the server has it", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const { props, list, mock } = await directoryProps();
    const slow: typeof props.api = {
      ...props.api!,
      call: (async (...args: Parameters<NonNullable<typeof props.api>["call"]>) => {
        if (args[0] === ROUTES.createMentorRequest) await held;
        return props.api!.call(...args);
      }) as NonNullable<typeof props.api>["call"],
    };
    await livePage({ ...props, api: slow }, list);
    await act(async () => card(joseph).querySelector<HTMLElement>("[data-ask-mentor]")!.click());
    const textarea = q<HTMLTextAreaElement>("[data-mentor-drawer] textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Could we talk through two offers I have?");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => q<HTMLFormElement>("[data-mentor-drawer] form")!.requestSubmit());
    // The person closes the drawer while the request is on its way.
    await act(async () => q<HTMLButtonElement>("[data-mentor-drawer] button[aria-label^='Close']")!.click());
    expect(q("[data-mentor-drawer] form")).toBeNull();
    // Another drawer is open when Joseph's request lands: closing it moves focus to its own button only (#314 review).
    const askSamuel = card(samuel).querySelector<HTMLElement>("[data-ask-mentor]")!;
    askSamuel.focus();
    await act(async () => askSamuel.click());
    await act(async () => { release(); await held; });
    await settle();
    expect(mock.requests().filter((r) => r.mentor.id === joseph.person.id && r.status === "PENDING")).toHaveLength(1);
    expect(all("[data-own-request]")[0]!.textContent).toContain("Joseph Mutua");
    const focused = vi.spyOn(HTMLElement.prototype, "focus");
    await act(async () => q<HTMLDialogElement>("[data-mentor-drawer]")!.close());
    const josephStatus = card(joseph).querySelector("[data-mentor-standing='waiting']");
    expect(josephStatus).not.toBeNull();
    expect(focused.mock.contexts).not.toContain(josephStatus);
    expect(document.activeElement).toBe(askSamuel);
    focused.mockRestore();
  });

  // QA4-05: the habits come before Send, and agreeing sends.
  it("shows the code of conduct before Send to someone who hasn't agreed, and sending agrees and sends", async () => {
    const { props, list, mock } = await directoryProps({ conductAgreed: false });
    await livePage(props, list);
    await act(async () => card(joseph).querySelector<HTMLElement>("[data-ask-mentor]")!.click());
    const form = q<HTMLFormElement>("[data-mentor-drawer] form")!;
    const inline = form.querySelector("[data-request-conduct-inline]")!;
    expect(inline.textContent).toContain("Before you send: how we talk to each other");
    expect(inline.querySelector("a")!.getAttribute("href")).toBe("/dashboard/community/conduct");
    // Without JavaScript the same form carries the agreement, so one post agrees and sends.
    expect(new FormData(form).get("agree")).toBe("1");
    const send = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    expect(send.textContent).toBe("Agree and send request");
    // The person's own Send comes after the habits in the drawer.
    expect(inline.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The habits sit in the pinned footer with Send, so what it agrees to is in view whenever it is (T05).
    expect(inline.closest(".mentor-drawer__actions--sticky")).toBe(send.closest(".mentor-drawer__actions--sticky"));
    const textarea = q<HTMLTextAreaElement>("[data-mentor-drawer] textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Interview practice?");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => form.requestSubmit());
    await settle();
    expect(props.conduct.agree).toHaveBeenCalledTimes(1);
    expect(q("[data-request-sent]")).not.toBeNull();
    expect(mock.requests().filter((r) => r.mentor.id === joseph.person.id && r.note === "Interview practice?")).toHaveLength(1);
  });

  it("holds an agreement made in one drawer for the next drawer on the page (QA4-05)", async () => {
    // The send after agreeing is refused, so the person closes the drawer and opens it again.
    const { props, list } = await directoryProps({ conductAgreed: false, failure: (request) => request.method === "POST" && new URL(request.url).pathname === "/api/mentor-requests"
      ? { status: 409, data: { error: { code: "conflict", message: "Joseph Mwangi has no spots left this month." } } } : undefined });
    await livePage(props, list);
    const open = () => act(async () => card(joseph).querySelector<HTMLElement>("[data-ask-mentor]")!.click());
    await open();
    const textarea = q<HTMLTextAreaElement>("[data-mentor-drawer] textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Interview practice?");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => q<HTMLFormElement>("[data-mentor-drawer] form")!.requestSubmit());
    await settle();
    expect(props.conduct.agree).toHaveBeenCalledTimes(1);
    const close = [...q("[data-mentor-drawer]")!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Cancel")!;
    expect(close.dataset.variant).toBe("ghost");
    await act(async () => close.click());
    await open();
    expect(q("[data-mentor-drawer] [data-request-conduct-inline]")).toBeNull();
    expect(q<HTMLButtonElement>("[data-mentor-drawer] button[type=submit]")!.textContent).toBe("Send request");
  });

  it("says why a send didn't go as an alert just above Send, keeping the note and Send for a retry (T13)", async () => {
    let refusals = 0;
    const { props, list } = await directoryProps({ failure: (request) => request.method === "POST" && new URL(request.url).pathname === "/api/mentor-requests"
      ? (refusals++, { status: 503, data: { error: { code: "server", message: "Busy" } } }) : undefined });
    await livePage(props, list);
    await act(async () => card(joseph).querySelector<HTMLElement>("[data-ask-mentor]")!.click());
    const textarea = q<HTMLTextAreaElement>("[data-mentor-drawer] textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Interview practice?");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = q<HTMLFormElement>("[data-mentor-drawer] form")!;
    const send = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    send.focus();
    await act(async () => form.requestSubmit());
    await settle();
    const refusal = q("[data-mentor-drawer] [data-request-error]")!;
    const alert = refusal.querySelector("[data-notice='danger']")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toBe("Problem: Your request wasn't sent. Try again in a moment. Your note is kept.");
    // In the pinned footer, straight before Send: where the person who pressed it is looking.
    expect(refusal.closest(".mentor-drawer__actions--sticky")).toBe(send.closest(".mentor-drawer__actions--sticky"));
    expect(refusal.nextElementSibling).toBe(send);
    // Read out once, by the alert: the polite live region stays quiet about it.
    expect(q("[data-mentor-drawer] output[aria-live]")!.textContent).toBe("");
    // The note is kept, and Send keeps focus and works for a retry.
    expect(q<HTMLTextAreaElement>("[data-mentor-drawer] textarea")!.value).toBe("Interview practice?");
    expect(document.activeElement).toBe(send);
    expect(send.disabled).toBe(false);
    expect(send.getAttribute("aria-disabled")).toBeNull();
    // A retry clears the alert while it goes, so a second failure is a new alert, read out again.
    await act(async () => form.requestSubmit());
    await settle();
    expect(refusals).toBe(2);
    const again = q("[data-mentor-drawer] [data-request-error] [data-notice='danger']")!;
    expect(again).not.toBe(alert);
    expect(again.getAttribute("role")).toBe("alert");
  });

  it("still asks for the habits when the server does, keeping the note, and agreeing there sends it", async () => {
    // The page read the person as agreed; the server has newer words to agree to.
    const { props, list, mock } = await directoryProps({ conductAgreed: false });
    await livePage({ ...props, conduct: { ...props.conduct, agreed: true } }, list);
    await act(async () => card(joseph).querySelector<HTMLElement>("[data-ask-mentor]")!.click());
    const textarea = q<HTMLTextAreaElement>("[data-mentor-drawer] textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Interview practice?");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => q<HTMLFormElement>("[data-mentor-drawer] form")!.requestSubmit());
    await settle();
    const prompt = q("[data-request-conduct]")!;
    expect(prompt.textContent).toContain("First, how we talk to each other");
    expect(prompt.textContent).toContain("Your request isn't sent yet.");
    // Focus moves to the heading, and shows there.
    expect(document.activeElement).toBe(prompt.querySelector("h3"));
    expect(prompt.querySelector("h3")!.className).toContain("focus-visible:outline-2");
    const agree = prompt.querySelector<HTMLFormElement>("form")!;
    expect(agree.getAttribute("method")).toBe("post");
    expect(agree.getAttribute("action")).toBe(`${PATH}?ask=${encodeURIComponent(joseph.person.id)}`);
    // Without JavaScript, agreeing posts the draft too, so it sends in the same post.
    expect(Object.fromEntries(new FormData(agree))).toEqual({
      intent: "mentor-request", mentorId: joseph.person.id, note: "Interview practice?", project: "", format: "CALL_30_MIN", agree: "1",
    });
    expect(prompt.querySelector("a")!.getAttribute("href")).toBe("/dashboard/community/conduct");
    // The note waits in the tab, in case the person goes to read the habits first.
    expect(Object.values({ ...sessionStorage }).join(" ")).toContain("Interview practice?");
    await act(async () => agree.requestSubmit());
    await settle();
    expect(props.conduct.agree).toHaveBeenCalledTimes(1);
    expect(q("[data-request-sent]")).not.toBeNull();
    expect(mock.requests().filter((r) => r.mentor.id === joseph.person.id && r.note === "Interview practice?")).toHaveLength(1);
  });

  it("withdraws at once and puts the request back when the server refuses", async () => {
    let refuse = true;
    const { props, list } = await directoryProps({ failure: (request) => request.method === "POST" && refuse ? { status: 500, data: { error: { code: "server", message: "No" } } } : undefined });
    await livePage(props, list);
    const row = () => q(`[data-own-request="${pendingMentorRequest.id}"]`)!;
    await act(async () => row().querySelector<HTMLButtonElement>("button")!.click());
    await settle();
    expect(row().dataset.status).toBe("PENDING");
    expect(row().textContent).toContain("Couldn't withdraw. Nothing changed; try again.");
    refuse = false;
    await act(async () => row().querySelector<HTMLButtonElement>("button")!.click());
    expect(row().dataset.status).toBe("WITHDRAWN");
    // Focus stays with the request's status, and shows there.
    expect(document.activeElement).toBe(row().querySelector("[data-request-status]"));
    expect(row().querySelector("[data-request-status]")!.className).toContain("focus-visible:outline-2");
    await settle();
    expect(row().textContent).toContain("Withdrawn");
    expect(row().querySelector("button")).toBeNull();
  });
});

describe("a mentor's requests", () => {
  type QueueOptions = {
    failure?: (request: Request) => MockReply | undefined;
    anotherLook?: typeof worthAnotherLook | null;
    initial?: MentorRequestList;
    availability?: typeof availability;
    props?: Partial<MentorRequestsQueueProps>;
  };
  async function queueProps(options: QueueOptions = {}) {
    const mock = createMentoringMock({ viewer: people.david, ...(options.failure ? { failure: options.failure } : {}) });
    const [initial, list] = await Promise.all([
      mock.api.call(ROUTES.listMentorRequests, { query: { as: "mentor" } }),
      mock.api.call(ROUTES.listMentors, { query: {} }),
    ]);
    const props: MentorRequestsQueueProps = {
      initial: options.initial ?? initial, mentors: list.items, availability: options.availability ?? availability, now: FIXTURE_NOW,
      ...(options.initial ? {} : { api: mock.api }), ...options.props,
    };
    return { mock, props };
  }
  /** The page as MentorRequests.astro renders it on the server: the island, then the rail. */
  function QueuePage({ props, anotherLook }: { props: MentorRequestsQueueProps; anotherLook: typeof worthAnotherLook | null }) {
    return (
      <div data-mentor-requests>
        <div data-island><MentorRequestsQueue {...props} /></div>
        <MentorMonthRail availability={props.availability} now={props.now} anotherLook={anotherLook?.items ?? []} />
      </div>
    );
  }
  /** The page without JavaScript: its server render only. */
  async function serverQueue(options: QueueOptions = {}) {
    const { props } = await queueProps(options);
    container.innerHTML = renderToString(<QueuePage props={props} anotherLook={options.anotherLook ?? null} />);
  }
  /** The page once interactive: the server's rail, with the island hydrated into its place. */
  async function queue(options: QueueOptions = {}) {
    const { mock, props } = await queueProps(options);
    container.innerHTML = renderToString(<QueuePage props={props} anotherLook={options.anotherLook ?? null} />);
    const mount = q("[data-island]")!;
    mount.replaceChildren();
    island = createRoot(mount);
    await act(async () => island!.render(<MentorRequestsQueue {...props} />));
    return mock;
  }
  const request = (id: string) => q(`[data-mentor-request="${id}"]`)!;
  const button = (id: string, name: string) => Array.from(request(id).querySelectorAll("button")).find((b) => b.textContent === name)!;
  const waitingHeading = () => q("h2[data-waiting-count], [data-waiting-count] h2")!;
  const waitingCount = () => q("[data-waiting-count]")!.getAttribute("data-waiting-count");
  const type = async (field: HTMLTextAreaElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });

  it("shows who is waiting, with the work attached, and the month's spots", async () => {
    await queue();
    expect(waitingHeading().textContent).toBe("2 requests waiting for you");
    // An h2 in the kit's own type: no weight or face of its own.
    expect(waitingHeading().className).not.toMatch(/font-(semibold|body|bold)/);
    expect(request(pendingMentorRequest.id).textContent).toContain("Bus fare splitter");
    expect(text("[data-spots-used]")).toBe("1 of 3");
    expect(q<HTMLMeterElement>("[data-mentoring-rail] meter")!.value).toBe(1);
    expect(button(pendingMentorRequest.id, "Accept").getAttribute("aria-describedby")).toBe(request(pendingMentorRequest.id).getAttribute("aria-labelledby"));
    // The heading an answer moves focus to shows it, with the kit's ring.
    const heading = request(pendingMentorRequest.id).querySelector("[data-request-heading]")!;
    expect(heading.className).toContain("focus-visible:outline-2");
    expect(heading.className).not.toContain("focus:outline-none");
  });

  it("keeps every card's answers quiet, so the view has no peach action until a panel opens", async () => {
    await queue();
    expect(all("[data-variant='primary']")).toHaveLength(0);
    expect(button(pendingMentorRequest.id, "Accept").dataset.variant).toBe("quiet");
    await act(async () => button(pendingMentorRequest.id, "Not this month").click());
    expect(all("[data-variant='primary']").map((b) => b.textContent)).toEqual(["Send: not this month"]);
    // One panel at a time: opening another request's closes the first, so one Send is ever primary.
    const other = all("[data-mentor-request][data-status=PENDING]").find((row) => row.dataset.mentorRequest !== pendingMentorRequest.id)!;
    await act(async () => Array.from(other.querySelectorAll("button")).find((b) => b.textContent === "Report this request")!.click());
    expect(all("[data-variant='primary']").map((b) => b.textContent)).toEqual(["Send report"]);
    expect(request(pendingMentorRequest.id).querySelector("[data-decline-request]")).toBeNull();
  });

  it("answers without JavaScript: Accept posts, and each panel opens through the page's URL", async () => {
    await serverQueue();
    const asked = request(pendingMentorRequest.id);
    const accept = Array.from(asked.querySelectorAll("button")).find((b) => b.textContent === "Accept")!;
    const acceptForm = accept.closest("form")!;
    expect(acceptForm.getAttribute("method")).toBe("post");
    expect(acceptForm.getAttribute("action")).toBe("/dashboard/mentoring/requests");
    expect(Object.fromEntries(new FormData(acceptForm))).toEqual({ intent: "accept", requestId: pendingMentorRequest.id });
    const decline = Array.from(asked.querySelectorAll("button")).find((b) => b.textContent === "Not this month")!;
    expect(decline.getAttribute("type")).toBe("submit");
    expect(decline.closest("form")!.getAttribute("method")).toBe("get");
    expect(decline.closest("form")!.getAttribute("action")).toBe(`/dashboard/mentoring/requests#request-${pendingMentorRequest.id}`);
    expect([decline.getAttribute("name"), decline.getAttribute("value")]).toEqual(["answer", "decline"]);
    expect(asked.querySelector<HTMLInputElement>("input[name=request]")!.value).toBe(pendingMentorRequest.id);
  });

  it("renders a panel the URL opened as a form, its Cancel a link back", async () => {
    await serverQueue({ props: { opened: { requestId: pendingMentorRequest.id, panel: "suggest" } } });
    const form = request(pendingMentorRequest.id).querySelector<HTMLFormElement>("[data-suggest-mentor]")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.querySelector<HTMLInputElement>("input[name=intent]")!.value).toBe("redirect");
    expect(form.querySelectorAll(`input[type=radio][name="suggest-${pendingMentorRequest.id}"]`).length).toBeGreaterThan(0);
    // No card inside the card: the panel sits under a hairline.
    expect(form.className).toContain("border-t");
    expect(form.className).not.toMatch(/rounded/);
    const cancel = Array.from(form.querySelectorAll("a")).find((link) => link.textContent === "Cancel")!;
    expect(cancel.getAttribute("href")).toBe(`/dashboard/mentoring/requests#request-${pendingMentorRequest.id}`);
  });

  it("brings a refused answer back with its panel, what was written, and a danger notice that takes focus", async () => {
    await serverQueue({
      props: {
        serverAnswer: {
          requestId: pendingMentorRequest.id, panel: "report", note: "", mentorId: null,
          error: "Say what's wrong with this request, so TTV knows what to check.", failure: "Your answer wasn't sent. Fix what's marked, then send it again.",
        },
      },
    });
    const asked = request(pendingMentorRequest.id);
    const notice = asked.querySelector("[data-request-answer-error] [data-notice='danger']")!;
    expect(notice.hasAttribute("autofocus")).toBe(true);
    expect(notice.textContent).toContain("Your answer wasn't sent.");
    expect(asked.querySelector("[data-report-request] textarea")!.getAttribute("aria-invalid")).toBe("true");
    expect(asked.querySelector("[data-report-request]")!.textContent).toContain("Say what's wrong with this request");
  });

  it("points at confirmed work with a newer revision, and leaves the card out when there is none", async () => {
    await serverQueue({ anotherLook: worthAnotherLook });
    const item = worthAnotherLook.items[0]!;
    expect(q("[data-another-look]")!.textContent).toContain("Achieng shared revision 3 of Chama ledger: M-Pesa receipt parser. Your confirmation covers revision 2.");
    const link = q<HTMLAnchorElement>(`[data-another-look-item="${item.journeyId}"] a`)!;
    expect(link.getAttribute("href")).toBe("/dashboard/mentoring/confirm");
    expect(link.textContent).toBe("Review revision 3");
    expect(link.dataset.variant).toBe("quiet");
    await serverQueue({ anotherLook: { items: [] } });
    expect(q("[data-another-look]")).toBeNull();
  });

  it("names three pieces of work at most, then points at Confirm work for the rest", async () => {
    const base = worthAnotherLook.items[0]!;
    const items = [1, 2, 3, 4, 5].map((n) => ({ ...base, journeyId: `journey-${n}`, title: `Project ${n}` }));
    await serverQueue({ anotherLook: { items } });
    expect(all("[data-another-look-item]")).toHaveLength(3);
    expect(text("[data-another-look] > a")).toBe("2 more on Confirm work ");
  });

  it("says the rest is a floor when the server's list is at its cap", async () => {
    const base = worthAnotherLook.items[0]!;
    const items = Array.from({ length: WORTH_ANOTHER_LOOK_LIMIT }, (_, n) => ({ ...base, journeyId: `journey-${n}`, title: `Project ${n}` }));
    await serverQueue({ anotherLook: { items } });
    expect(text("[data-another-look] > a")).toBe(`${WORTH_ANOTHER_LOOK_LIMIT - 3}+ more on Confirm work `);
  });

  it("reports a note with a reason, after which the request is closed for the mentor and leaves the count", async () => {
    await queue();
    expect(waitingCount()).toBe("2");
    await act(async () => button(pendingMentorRequest.id, "Report this request").click());
    const form = request(pendingMentorRequest.id).querySelector<HTMLFormElement>("[data-report-request]")!;
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
    // A reason first: TTV needs to know what to check.
    await act(async () => form.requestSubmit());
    expect(form.textContent).toContain("Say what's wrong with this request");
    await type(form.querySelector("textarea")!, "Asked for my phone number.");
    await act(async () => form.requestSubmit());
    await settle();
    const reported = request(pendingMentorRequest.id);
    expect(reported.textContent).toContain("Reported");
    expect(reported.textContent).toContain("stays closed for you unless they send it back");
    expect(Array.from(reported.querySelectorAll("button")).map((b) => b.textContent)).not.toContain("Accept");
    expect(waitingCount()).toBe("1");
  });

  it("keeps the reason when a report doesn't go through, so it can be sent again", async () => {
    await queue({
      failure: (http) => http.method === "POST" && http.url.endsWith("/report")
        ? { status: 503, data: { error: { code: "unavailable", message: "Try again." } } } : undefined,
    });
    await act(async () => button(pendingMentorRequest.id, "Report this request").click());
    await type(request(pendingMentorRequest.id).querySelector<HTMLTextAreaElement>("[data-report-request] textarea")!, "Asked for my phone number.");
    await act(async () => request(pendingMentorRequest.id).querySelector<HTMLFormElement>("[data-report-request]")!.requestSubmit());
    await settle();
    const failed = request(pendingMentorRequest.id);
    expect(failed.querySelector("[data-notice='danger']")!.textContent).toContain("That didn't go through");
    expect(failed.querySelector<HTMLTextAreaElement>("[data-report-request] textarea")!.value).toBe("Asked for my phone number.");
    expect(failed.querySelector("[data-report-request]")!.closest("[hidden]")).toBeNull();
  });

  it("shows contact details masked in a note as the channels' note, never the bracketed marker (T03)", async () => {
    const masked = { ...pendingMentorRequest, note: `Career advice, please. WhatsApp me on ${MASKED_CONTACT}.` };
    await queue({ initial: { items: [masked], nextCursor: null } });
    const quote = request(pendingMentorRequest.id).querySelector("blockquote")!;
    expect(quote.textContent).not.toContain(MASKED_CONTACT);
    expect(quote.querySelector(".channel-masked[role=note]")!.textContent).toBe(MASKED_NOTE);
    expect(quote.textContent).toContain("WhatsApp me on ");
  });

  it("shows a request reported earlier as closed, with nothing to press, under an empty state", async () => {
    const reported = { ...pendingMentorRequest, check: "reported" as const };
    await queue({ initial: { items: [reported], nextCursor: null } });
    expect(request(pendingMentorRequest.id).querySelectorAll("button")).toHaveLength(0);
    expect(q("[data-waiting-count] [data-empty-state] h2")!.textContent).toBe("Nothing waiting for you");
  });

  it("accepts at once and then links the conversation", async () => {
    await queue();
    const refreshes = vi.fn();
    window.addEventListener(ATTENTION_REFRESH_EVENT, refreshes);
    await act(async () => button(pendingMentorRequest.id, "Accept").click());
    expect(request(pendingMentorRequest.id).dataset.status).toBe("ACCEPTED");
    expect(document.activeElement?.hasAttribute("data-request-heading")).toBe(true);
    await settle();
    const open = request(pendingMentorRequest.id).querySelector<HTMLAnchorElement>("a[href^='/dashboard/community/dm/']")!;
    expect(open.textContent).toBe("Open conversation with Wanjiku");
    expect(open.dataset.variant).toBe("quiet");
    expect(waitingHeading().textContent).toBe("1 request waiting for you");
    // QA4-07: once the server has the answer, the bell and the Mentoring tab count again.
    expect(refreshes).toHaveBeenCalledTimes(1);
    window.removeEventListener(ATTENTION_REFRESH_EVENT, refreshes);
  });

  const declineNote = (id: string) => request(id).querySelector<HTMLFormElement>("[data-decline-request]");
  const sendDecline = (id: string) => Array.from(declineNote(id)!.querySelectorAll("button")).find((b) => b.textContent === "Send: not this month")!;

  it("says not this month with no note needed, frees the spot, and rolls back when refused", async () => {
    let refuse = true;
    const refreshes = vi.fn();
    window.addEventListener(ATTENTION_REFRESH_EVENT, refreshes);
    await queue({ failure: (r) => r.method === "POST" && refuse ? { status: 503, data: { error: { code: "server", message: "Busy" } } } : undefined });
    const id = pendingMentorRequest.id;
    await act(async () => button(id, "Not this month").click());
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
    await act(async () => sendDecline(id).click());
    await settle();
    expect(request(id).dataset.status).toBe("PENDING");
    expect(request(id).querySelector("[data-notice='danger']")!.textContent).toContain("That didn't go through, so nothing changed.");
    // A refused answer changed nothing, so nothing is counted again.
    expect(refreshes).not.toHaveBeenCalled();
    refuse = false;
    await act(async () => sendDecline(id).click());
    await settle();
    expect(request(id).dataset.status).toBe("DECLINED");
    // The rail is the server's, but its spots follow the answers given here.
    expect(text("[data-spots-used]")).toBe("0 of 3");
    expect(all("[data-spots-used]")).toHaveLength(1);
    expect(refreshes).toHaveBeenCalledTimes(1);
    window.removeEventListener(ATTENTION_REFRESH_EVENT, refreshes);
  });

  // QA4-03: a kind word travels with "Not this month" when the mentor adds one.
  it("sends an optional note with not this month, and cancelling goes back to the answers", async () => {
    const mock = await queue();
    const id = pendingMentorRequest.id;
    await act(async () => button(id, "Not this month").click());
    await act(async () => Array.from(declineNote(id)!.querySelectorAll("button")).find((b) => b.textContent === "Cancel")!.click());
    expect(declineNote(id)).toBeNull();
    await act(async () => button(id, "Not this month").click());
    await type(declineNote(id)!.querySelector("textarea")!, "  I'm travelling this month. Try me in December?  ");
    await act(async () => sendDecline(id).click());
    await settle();
    expect(mock.requests().find((r) => r.id === id)).toMatchObject({ status: "DECLINED", responseNote: "I'm travelling this month. Try me in December?" });
  });

  it("tells a paused mentor they're out of the directory, with a Paused chip (QA4-15)", async () => {
    await serverQueue({ initial: { items: [], nextCursor: null }, availability: { ...availability, paused: true, listed: false } });
    expect(text("[data-spots-note]")).toBe("You've paused new requests, so you're not in the mentor directory. Requests already waiting stay with you.");
    expect(q("[data-requests-paused] [data-chip]")!.textContent).toBe("Paused");
    expect(q("[data-waiting-count] [data-empty-state]")!.textContent).toContain("When someone asks for your time");
    expect(q<HTMLAnchorElement>("[data-mentoring-rail] a[href='/dashboard/mentoring/availability']")!.dataset.variant).toBe("quiet");
  });

  it("suggests another mentor with an optional note, and needs a choice first", async () => {
    const mock = await queue();
    const id = pendingMentorRequest.id;
    await act(async () => button(id, "Suggest another mentor").click());
    const panel = request(id).querySelector<HTMLFormElement>("[data-suggest-mentor]")!;
    expect(document.activeElement?.getAttribute("type")).toBe("radio");
    // Never the person asking, never David himself.
    const offered = Array.from(panel.querySelectorAll<HTMLInputElement>("input[type=radio]")).map((input) => input.value);
    expect(offered).not.toContain(people.wanjiku.id);
    expect(offered).not.toContain(people.david.id);
    await act(async () => panel.requestSubmit());
    expect(panel.textContent).toContain("Choose a mentor to suggest.");
    await act(async () => panel.querySelector<HTMLInputElement>(`input[value="${people.samuel.id}"]`)!.click());
    await act(async () => panel.requestSubmit());
    await settle();
    expect(request(id).dataset.status).toBe("REDIRECTED");
    expect(request(id).textContent).toContain("Suggested Samuel Otieno");
    expect(mock.requests().find((r) => r.id === id)?.redirectedTo?.id).toBe(people.samuel.id);
  });

  it("shows a withdrawal that happened while the mentor was reading", async () => {
    const mock = await queue();
    mock.move(pendingMentorRequest.id, "WITHDRAWN");
    await act(async () => button(pendingMentorRequest.id, "Accept").click());
    await settle();
    expect(request(pendingMentorRequest.id).dataset.status).toBe("WITHDRAWN");
    expect(request(pendingMentorRequest.id).textContent).toContain("Wanjiku withdrew this request.");
  });

  it("drops a panel and an answer named in the URL once interactive, so a reload repeats neither", async () => {
    window.history.replaceState(null, "", `/dashboard/mentoring/requests?request=${pendingMentorRequest.id}&answer=decline#request-${pendingMentorRequest.id}`);
    await queue({ props: { opened: { requestId: pendingMentorRequest.id, panel: "decline" } } });
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe(`#request-${pendingMentorRequest.id}`);
    expect(declineNote(pendingMentorRequest.id)).not.toBeNull();
  });
});

it("keeps the directory's URL state free of a stale drawer", () => {
  expect(parseDirectoryUrl(new URLSearchParams("?ask=")).ask).toBeNull();
  expect(NO_FILTERS).toEqual({ area: null, format: null, available: false });
});
