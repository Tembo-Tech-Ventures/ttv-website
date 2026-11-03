// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MASKED_CONTACT, ROUTES, WORTH_ANOTHER_LOOK_LIMIT, type MentorDirectoryItem } from "@/lib/platform/contracts";
import { acceptedMentorRequest } from "@/lib/platform/fixtures";
import { ATTENTION_REFRESH_EVENT } from "@/components/platform/shell/overlays";
import { availability, FIXTURE_NOW, meByPersona, mentors, people, pendingMentorRequest, worthAnotherLook } from "@/lib/platform/fixtures";
import { NO_FILTERS, parseDirectoryUrl } from "@/lib/platform/client/mentor-directory";
import { createMentoringMock } from "@/lib/platform/client/mentoring.mock";
import type { MockReply } from "@/lib/platform/client/mockTransport";
import { MASKED_NOTE } from "@/components/channels/MaskedText";
import AvailabilityEditor from "./AvailabilityEditor";
import MentorRequestsQueue from "./MentorRequestsQueue";
import { isRecent, RECENT_DAYS } from "./OwnRequests";
import MentorsDirectory, { menuAlignment, splitAreas, standings, TOP_AREAS, type MentorsDirectoryProps } from "./MentorsDirectory";

const PATH = "/dashboard/community/mentors";
const conduct = { version: 1, habitsHref: "/dashboard/community/conduct", canAgree: true };

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.history.replaceState(null, "", PATH);
});
afterEach(async () => {
  await act(async () => root.unmount());
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
  const props: MentorsDirectoryProps = {
    me: meByPersona.wanjiku, path: PATH, filters, mentors: list.items, shown: list.items,
    areas: ["Code review", "Career"], ownRequests: own, projects: mock.projects, now: FIXTURE_NOW, api: mock.api,
    conduct: { ...conduct, agreed: options.conductAgreed !== false, agree: vi.fn(async () => { mock.agreeConduct(); }) },
  };
  return { props, mock };
}

const card = (item: MentorDirectoryItem) => q(`[data-mentor-card="${item.person.id}"]`)!;
const [david, mercy, joseph, samuel] = mentors.items;

describe("the mentor directory", () => {
  it("reads without JavaScript: cards, capacity, filters and the person's own requests", async () => {
    const { props } = await directoryProps({ search: "?area=Career&available=true" });
    const html = renderToString(<MentorsDirectory {...props} />);
    container.innerHTML = html;
    expect(all("[data-mentor-card]")).toHaveLength(4);
    expect(card(david).textContent).toContain("2 of 3 spots open in November");
    // Wanjiku's request to David is still waiting, so his card says that where "Ask for time" would be (QA4-12).
    expect(card(david).querySelector("[data-ask-mentor]")).toBeNull();
    expect(card(david).querySelector("[data-mentor-standing='waiting']")?.textContent).toBe("Waiting for David");
    const askJoseph = card(joseph).querySelector("[data-ask-mentor]")!;
    expect(askJoseph.textContent).toBe("Ask for time");
    expect(askJoseph.getAttribute("aria-label")).toBe("Ask for time with Joseph Mutua");
    // Mercy is full: the next opening, and no button that does nothing.
    expect(card(mercy).textContent).toContain("Next opening 1 December");
    expect(card(mercy).querySelector("[data-mentor-full]")?.textContent).toBe("Full this month");
    expect(card(mercy).querySelector("button")).toBeNull();
    // Filters are links held in the URL; the active ones say so.
    const active = all("[data-mentor-filters] a[aria-current='true']").map((link) => link.textContent);
    expect(active).toEqual(["Career", "Any format", "Has open spots"]);
    // Each lands on the results heading, which says what the filters chose (QA4-18).
    expect(q<HTMLAnchorElement>("[data-filter-available]")!.getAttribute("href")).toBe(`${PATH}?area=Career#mentor-results`);
    expect(all("[data-mentor-filters] a").every((link) => link.getAttribute("href")!.endsWith("#mentor-results"))).toBe(true);
    const results = q("h2[data-mentor-results]")!;
    expect(results.id).toBe("mentor-results");
    expect(results.textContent).toBe(`${props.shown.length} mentors · Career · Has open spots`);
    expect(all("[data-own-request]").map((row) => row.dataset.status)).toEqual(["PENDING", "ACCEPTED"]);
    expect(html).not.toContain("<dialog open");
  });

  // Owner decision 2026-11-02: anyone signed in asks as themselves; an organisation is told so (QA4-09).
  it("tells someone in an organisation they can ask as themselves, and offers them the same buttons", async () => {
    const { props } = await directoryProps();
    container.innerHTML = renderToString(<MentorsDirectory {...props} me={meByPersona.joseph} />);
    expect(text("[data-mentors-as-yourself]")).toBe("You can ask a mentor for time as yourself. Requests come from you, not from your organisation.");
    expect(card(joseph).querySelector("[data-ask-mentor]")).not.toBeNull();
    container.innerHTML = renderToString(<MentorsDirectory {...props} />);
    expect(q("[data-mentors-as-yourself]")).toBeNull();
  });

  it("leads to the conversation for a mentor who accepted, when nothing else is waiting with them", async () => {
    const { props } = await directoryProps();
    container.innerHTML = renderToString(<MentorsDirectory {...props} ownRequests={{ items: [acceptedMentorRequest], nextCursor: null }} />);
    const conversation = card(david).querySelector<HTMLAnchorElement>("[data-mentor-standing='conversation']")!;
    expect(conversation.textContent).toBe("Open your conversation with David ");
    expect(conversation.getAttribute("href")).toBe(`/dashboard/community/dm/${acceptedMentorRequest.channelId}`);
    // Asking again for another time is still fine.
    expect(card(david).querySelector("[data-ask-mentor]")).not.toBeNull();
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
    const { props } = await directoryProps();
    const held = { ...pendingMentorRequest, check: "waiting" as const };
    container.innerHTML = renderToString(<MentorsDirectory {...props} ownRequests={{ items: [held], nextCursor: null }} />);
    const row = q(`[data-own-request="${held.id}"]`)!;
    expect(row.textContent).toContain("Waiting for a check before it's sent.");
    expect(row.querySelector("[data-request-next]")!.textContent).toBe(
      "Some requests get a check from TTV before they reach a mentor. It isn't a judgement on you, and there's nothing you need to do. You'll get a notice when it's done.",
    );
    expect(row.textContent).not.toMatch(/declin/i);
    const unsent = { ...pendingMentorRequest, status: "WITHDRAWN" as const, check: "not_sent" as const };
    container.innerHTML = renderToString(<MentorsDirectory {...props} ownRequests={{ items: [unsent], nextCursor: null }} />);
    const next = q(`[data-own-request="${unsent.id}"] [data-request-next]`)!;
    expect(next.textContent).toContain("You can ask again with a new note, or ask another mentor.");
    expect(next.querySelector("a")!.getAttribute("href")).toBe("/dashboard/community/conduct");
    // Withdraw says whose request it withdraws.
    container.innerHTML = renderToString(<MentorsDirectory {...props} />);
    expect(q(`[data-own-request="${pendingMentorRequest.id}"] button`)!.getAttribute("aria-label")).toBe("Withdraw request to David Kamau");
  });

  it("puts every filter on one row: the top areas, the rest under More areas, and how as one menu (T06)", async () => {
    const areas = ["API design", "Python", "Accessibility", "Career advice", "Code review", "CSS", "Data modelling", "Kotlin"];
    const { props } = await directoryProps({ search: "?area=Kotlin" });
    container.innerHTML = renderToString(<MentorsDirectory {...props} areas={areas} />);
    const nav = q("[data-mentor-filters]")!;
    const row = Array.from(nav.querySelectorAll<HTMLElement>("fieldset > a")).map((link) => link.textContent);
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

  it("opens Your requests on arrival when a request has news: a suggestion, not this month or a check (S3)", async () => {
    const { props } = await directoryProps();
    const redirected = { ...pendingMentorRequest, id: "redirected", status: "REDIRECTED" as const, redirectedTo: people.joseph, updatedAt: FIXTURE_NOW };
    container.innerHTML = renderToString(<MentorsDirectory {...props} ownRequests={{ items: [redirected, ...props.ownRequests.items.slice(1)], nextCursor: null }} />);
    expect(q<HTMLDetailsElement>("[data-own-requests-fold]")!.open).toBe(true);
    expect(text("[data-own-requests-summary]")).toBe("1 with a suggestion · 1 accepted");
    // The heading is its own, outside the summary.
    expect(q("[data-own-requests] > h2")!.textContent).toBe("Your requests");
    expect(q("[data-own-requests-fold] summary h2")).toBeNull();
  });

  it("folds Your requests to one line that says where they stand, and opens on request (T06)", async () => {
    const { props } = await directoryProps();
    await act(async () => root.render(<MentorsDirectory {...props} />));
    const fold = q<HTMLDetailsElement>("[data-own-requests-fold]")!;
    expect(fold.open).toBe(false);
    expect(fold.querySelector("summary")!.textContent).toContain("Your requests: ");
    expect(text("[data-own-requests-summary]")).toBe("1 waiting · 1 accepted");
    await act(async () => { fold.querySelector("summary")!.click(); });
    expect(fold.open).toBe(true);
    expect(all("[data-own-request]")).toHaveLength(2);
  });

  it("shows the mentor's reply with contact details masked as the channels' note (T03)", async () => {
    const { props } = await directoryProps();
    const declined = { ...pendingMentorRequest, id: "declined-masked", status: "DECLINED" as const, responseNote: `Not this month. Text me on ${MASKED_CONTACT}` };
    container.innerHTML = renderToString(<MentorsDirectory {...props} ownRequests={{ items: [declined], nextCursor: null }} />);
    const reply = q("[data-own-request='declined-masked'] blockquote")!;
    expect(reply.textContent).not.toContain(MASKED_CONTACT);
    expect(reply.querySelector(".channel-masked[role=note]")!.textContent).toBe(MASKED_NOTE);
  });

  it("keeps waiting and recent requests in view, and folds older answers under Earlier", async () => {
    const { props } = await directoryProps();
    const old = { ...pendingMentorRequest, id: "old-declined", status: "DECLINED" as const, createdAt: FIXTURE_NOW - 40 * 86_400_000, updatedAt: FIXTURE_NOW - 30 * 86_400_000 };
    const oldPending = { ...pendingMentorRequest, id: "old-pending", mentor: people.samuel, createdAt: FIXTURE_NOW - 30 * 86_400_000, updatedAt: FIXTURE_NOW - 30 * 86_400_000 };
    container.innerHTML = renderToString(<MentorsDirectory {...props} ownRequests={{ items: [...props.ownRequests.items, oldPending, old], nextCursor: null }} />);
    const earlier = q("[data-own-requests-earlier]")!;
    expect(earlier.querySelector("summary")!.textContent).toBe("Earlier (1)");
    expect(earlier.querySelectorAll("[data-own-request]")).toHaveLength(1);
    expect(earlier.querySelector("[data-own-request='old-declined']")).not.toBeNull();
    // Still waiting, however long ago it was asked, stays in view with its Withdraw.
    expect(q("[data-own-requests-fold] > div [data-own-request='old-pending']")).not.toBeNull();
    expect(isRecent(oldPending, FIXTURE_NOW)).toBe(true);
    expect(isRecent(old, FIXTURE_NOW)).toBe(false);
    expect(isRecent({ ...old, updatedAt: FIXTURE_NOW - (RECENT_DAYS - 1) * 86_400_000 }, FIXTURE_NOW)).toBe(true);
  });

  it("says when nothing matches, with the way back to every mentor", async () => {
    const { props } = await directoryProps({ search: "?format=QUICK_QUESTION" });
    await act(async () => root.render(<MentorsDirectory {...props} shown={[]} />));
    expect(text("[data-mentors-empty]")).toContain("No mentors match these filters right now.");
    expect(q<HTMLAnchorElement>("[data-mentors-empty] a")!.getAttribute("href")).toBe(`${PATH}#mentor-results`);
    expect(text("[data-mentor-results]")).toBe("0 mentors · Quick question");
  });

  it("opens the drawer on the note, keeps it in the URL, and returns focus to the button on close", async () => {
    const { props } = await directoryProps();
    await act(async () => root.render(<MentorsDirectory {...props} />));
    const ask = card(joseph).querySelector<HTMLButtonElement>("[data-ask-mentor]")!;
    ask.focus();
    await act(async () => ask.click());
    const dialog = q<HTMLDialogElement>("[data-mentor-drawer]")!;
    expect(dialog.open).toBe(true);
    expect(window.location.search).toBe(`?ask=${encodeURIComponent(joseph.person.id)}`);
    expect(dialog.textContent).toContain("Ask Joseph for time");
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
    expect(ask.getAttribute("aria-expanded")).toBe("true");
    // Joseph offers calls and quick questions only, and the first is chosen.
    expect(Array.from(dialog.querySelectorAll<HTMLInputElement>("input[name=format]")).map((input) => [input.value, input.checked])).toEqual([
      ["CALL_30_MIN", true], ["QUICK_QUESTION", false],
    ]);
    await act(async () => dialog.close());
    expect(window.location.search).toBe("");
    expect(document.activeElement).toBe(ask);
  });

  it("opens the drawer from ?ask= on arrival, but never for a full mentor", async () => {
    const { props } = await directoryProps({ search: `?ask=${joseph.person.id}` });
    await act(async () => root.render(<MentorsDirectory {...props} />));
    expect(q<HTMLDialogElement>("[data-mentor-drawer]")!.open).toBe(true);
    await act(async () => root.unmount());
    root = createRoot(container);
    const full = await directoryProps({ search: `?ask=${mercy.person.id}` });
    await act(async () => root.render(<MentorsDirectory {...full.props} />));
    expect(q<HTMLDialogElement>("[data-mentor-drawer]")!.open).toBe(false);
  });

  it("explains what to fix, then sends and lists the request under Your requests", async () => {
    const { props, mock } = await directoryProps();
    await act(async () => root.render(<MentorsDirectory {...props} />));
    await act(async () => card(joseph).querySelector<HTMLButtonElement>("[data-ask-mentor]")!.click());
    const form = q<HTMLFormElement>("[data-mentor-drawer] form")!;
    await act(async () => form.requestSubmit());
    expect(text("[data-mentor-drawer]")).toContain("Say what you'd like help with.");
    expect(q("[data-mentor-drawer] textarea")!.getAttribute("aria-invalid")).toBe("true");
    const textarea = q<HTMLTextAreaElement>("[data-mentor-drawer] textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Could we talk through two offers I have?");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => form.requestSubmit());
    await settle();
    expect(q("[data-request-sent]")).not.toBeNull();
    expect(document.activeElement?.textContent).toBe("Request sent");
    expect(mock.requests().filter((r) => r.mentor.id === joseph.person.id && r.status === "PENDING")).toHaveLength(1);
    expect(all("[data-own-request]")[0]!.textContent).toContain("Joseph Mutua");
    // Done: "Ask for time" has given way to the request's status, and focus goes there, not to the page's top (QA4-18).
    const done = Array.from(q("[data-request-sent]")!.querySelectorAll("button")).find((button) => button.textContent === "Done")!;
    await act(async () => done.click());
    expect(q<HTMLDialogElement>("[data-mentor-drawer]")!.open).toBe(false);
    expect(document.activeElement).toBe(card(joseph).querySelector("[data-mentor-standing='waiting']"));
  });

  it("puts focus on the results after a filter link, so Tab carries on into the mentors (QA4-18)", async () => {
    const { props } = await directoryProps({ search: "?area=Career" });
    window.history.replaceState(null, "", `${PATH}?area=Career#mentor-results`);
    await act(async () => root.render(<MentorsDirectory {...props} />));
    expect(document.activeElement).toBe(q("h2[data-mentor-results]"));
    expect(document.activeElement?.textContent).toBe(`${props.shown.length} mentors · Career`);
  });

  it("keeps a send going when the drawer closes mid-send, and lists the request once the server has it", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const { props, mock } = await directoryProps();
    const slow: typeof props.api = {
      ...props.api!,
      call: (async (...args: Parameters<NonNullable<typeof props.api>["call"]>) => {
        if (args[0] === ROUTES.createMentorRequest) await held;
        return props.api!.call(...args);
      }) as NonNullable<typeof props.api>["call"],
    };
    await act(async () => root.render(<MentorsDirectory {...props} api={slow} />));
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
    const { props, mock } = await directoryProps({ conductAgreed: false });
    await act(async () => root.render(<MentorsDirectory {...props} />));
    await act(async () => card(joseph).querySelector<HTMLButtonElement>("[data-ask-mentor]")!.click());
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
    const { props } = await directoryProps({ conductAgreed: false, failure: (request) => request.method === "POST" && new URL(request.url).pathname === "/api/mentor-requests"
      ? { status: 409, data: { error: { code: "conflict", message: "Joseph Mwangi has no spots left this month." } } } : undefined });
    await act(async () => root.render(<MentorsDirectory {...props} />));
    const open = () => act(async () => card(joseph).querySelector<HTMLButtonElement>("[data-ask-mentor]")!.click());
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
    await act(async () => close.click());
    await open();
    expect(q("[data-mentor-drawer] [data-request-conduct-inline]")).toBeNull();
    expect(q<HTMLButtonElement>("[data-mentor-drawer] button[type=submit]")!.textContent).toBe("Send request");
  });

  it("still asks for the habits when the server does, keeping the note, and agreeing there sends it", async () => {
    // The page read the person as agreed; the server has newer words to agree to.
    const { props, mock } = await directoryProps({ conductAgreed: false });
    await act(async () => root.render(<MentorsDirectory {...props} conduct={{ ...props.conduct, agreed: true }} />));
    await act(async () => card(joseph).querySelector<HTMLButtonElement>("[data-ask-mentor]")!.click());
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
    const { props } = await directoryProps({ failure: (request) => request.method === "POST" && refuse ? { status: 500, data: { error: { code: "server", message: "No" } } } : undefined });
    await act(async () => root.render(<MentorsDirectory {...props} />));
    const row = () => q(`[data-own-request="${pendingMentorRequest.id}"]`)!;
    await act(async () => row().querySelector<HTMLButtonElement>("button")!.click());
    await settle();
    expect(row().dataset.status).toBe("PENDING");
    expect(row().textContent).toContain("Couldn't withdraw. Nothing changed; try again.");
    refuse = false;
    await act(async () => row().querySelector<HTMLButtonElement>("button")!.click());
    expect(row().dataset.status).toBe("WITHDRAWN");
    await settle();
    expect(row().textContent).toContain("Withdrawn");
    expect(row().querySelector("button")).toBeNull();
  });
});

describe("a mentor's requests", () => {
  async function queue(failure?: (request: Request) => MockReply | undefined, anotherLook: typeof worthAnotherLook | null = null) {
    const mock = createMentoringMock({ viewer: people.david, ...(failure ? { failure } : {}) });
    const [initial, list] = await Promise.all([
      mock.api.call(ROUTES.listMentorRequests, { query: { as: "mentor" } }),
      mock.api.call(ROUTES.listMentors, { query: {} }),
    ]);
    await act(async () => root.render(<MentorRequestsQueue initial={initial} mentors={list.items} availability={availability} anotherLook={anotherLook} now={FIXTURE_NOW} api={mock.api} />));
    return mock;
  }
  const request = (id: string) => q(`[data-mentor-request="${id}"]`)!;
  const button = (id: string, name: string) => Array.from(request(id).querySelectorAll("button")).find((b) => b.textContent === name)!;

  it("shows who is waiting, with the work attached, and the month's spots", async () => {
    await queue();
    expect(text("[data-waiting-count]")).toBe("2 requests waiting for you");
    expect(request(pendingMentorRequest.id).textContent).toContain("Bus fare splitter");
    expect(text("[data-spots-used]")).toBe("1 of 3");
    expect(q<HTMLMeterElement>("[data-mentoring-rail] meter")!.value).toBe(1);
    expect(button(pendingMentorRequest.id, "Accept").getAttribute("aria-describedby")).toBe(request(pendingMentorRequest.id).getAttribute("aria-labelledby"));
  });

  it("points at confirmed work with a newer revision, and leaves the card out when there is none", async () => {
    await queue(undefined, worthAnotherLook);
    const item = worthAnotherLook.items[0]!;
    expect(q("[data-another-look]")!.textContent).toContain("Achieng shared revision 3 of Chama ledger: M-Pesa receipt parser. Your confirmation covers revision 2.");
    const link = q<HTMLAnchorElement>(`[data-another-look-item="${item.journeyId}"] a`)!;
    expect(link.getAttribute("href")).toBe("/dashboard/mentoring/confirm");
    expect(link.textContent).toBe("Review revision 3");
    await act(async () => root.unmount());
    root = createRoot(container);
    await queue(undefined, { items: [] });
    expect(q("[data-another-look]")).toBeNull();
  });

  it("names three pieces of work at most, then points at Confirm work for the rest", async () => {
    const base = worthAnotherLook.items[0]!;
    const items = [1, 2, 3, 4, 5].map((n) => ({ ...base, journeyId: `journey-${n}`, title: `Project ${n}` }));
    await queue(undefined, { items });
    expect(all("[data-another-look-item]")).toHaveLength(3);
    expect(text("[data-another-look] > a")).toBe("2 more on Confirm work ");
  });

  it("says the rest is a floor when the server's list is at its cap", async () => {
    const base = worthAnotherLook.items[0]!;
    const items = Array.from({ length: WORTH_ANOTHER_LOOK_LIMIT }, (_, n) => ({ ...base, journeyId: `journey-${n}`, title: `Project ${n}` }));
    await queue(undefined, { items });
    expect(text("[data-another-look] > a")).toBe(`${WORTH_ANOTHER_LOOK_LIMIT - 3}+ more on Confirm work `);
  });

  it("reports a note with a reason, after which the request is closed for the mentor and leaves the count", async () => {
    await queue();
    expect(q("[data-waiting-count]")!.getAttribute("data-waiting-count")).toBe("2");
    await act(async () => button(pendingMentorRequest.id, "Report this request").click());
    const form = request(pendingMentorRequest.id).querySelector<HTMLFormElement>("[data-report-request]")!;
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
    // A reason first: TTV needs to know what to check.
    await act(async () => form.requestSubmit());
    expect(form.textContent).toContain("Say what's wrong with this request");
    const reason = form.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(reason, "Asked for my phone number.");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => form.requestSubmit());
    await settle();
    const reported = request(pendingMentorRequest.id);
    expect(reported.textContent).toContain("Reported");
    expect(reported.textContent).toContain("stays closed for you unless they send it back");
    expect(Array.from(reported.querySelectorAll("button")).map((b) => b.textContent)).not.toContain("Accept");
    expect(q("[data-waiting-count]")!.getAttribute("data-waiting-count")).toBe("1");
  });

  it("keeps the reason when a report doesn't go through, so it can be sent again", async () => {
    await queue((http) => http.method === "POST" && http.url.endsWith("/report")
      ? { status: 503, data: { error: { code: "unavailable", message: "Try again." } } } : undefined);
    await act(async () => button(pendingMentorRequest.id, "Report this request").click());
    const reason = request(pendingMentorRequest.id).querySelector<HTMLTextAreaElement>("[data-report-request] textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(reason, "Asked for my phone number.");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => request(pendingMentorRequest.id).querySelector<HTMLFormElement>("[data-report-request]")!.requestSubmit());
    await settle();
    const failed = request(pendingMentorRequest.id);
    expect(failed.textContent).toContain("That didn't go through");
    expect(failed.querySelector<HTMLTextAreaElement>("[data-report-request] textarea")!.value).toBe("Asked for my phone number.");
    expect(failed.querySelector("[data-report-request]")!.closest("[hidden]")).toBeNull();
  });

  it("shows contact details masked in a note as the channels' note, never the bracketed marker (T03)", async () => {
    const masked = { ...pendingMentorRequest, note: `Career advice, please. WhatsApp me on ${MASKED_CONTACT}.` };
    await act(async () => root.render(<MentorRequestsQueue initial={{ items: [masked], nextCursor: null }} mentors={mentors.items} availability={availability} anotherLook={null} now={FIXTURE_NOW} />));
    const quote = request(pendingMentorRequest.id).querySelector("blockquote")!;
    expect(quote.textContent).not.toContain(MASKED_CONTACT);
    expect(quote.querySelector(".channel-masked[role=note]")!.textContent).toBe(MASKED_NOTE);
    expect(quote.textContent).toContain("WhatsApp me on ");
  });

  it("shows a request reported earlier as closed, with nothing to press", async () => {
    const reported = { ...pendingMentorRequest, check: "reported" as const };
    await act(async () => root.render(<MentorRequestsQueue initial={{ items: [reported], nextCursor: null }} mentors={mentors.items} availability={availability} anotherLook={null} now={FIXTURE_NOW} />));
    expect(request(pendingMentorRequest.id).querySelectorAll("button")).toHaveLength(0);
    expect(text("[data-waiting-count]")).toBe("Nothing waiting for you");
  });

  it("accepts at once and then links the conversation", async () => {
    await queue();
    const refreshes = vi.fn();
    window.addEventListener(ATTENTION_REFRESH_EVENT, refreshes);
    await act(async () => button(pendingMentorRequest.id, "Accept").click());
    expect(request(pendingMentorRequest.id).dataset.status).toBe("ACCEPTED");
    expect(document.activeElement?.hasAttribute("data-request-heading")).toBe(true);
    await settle();
    expect(request(pendingMentorRequest.id).querySelector("a[href^='/dashboard/community/dm/']")!.textContent).toBe("Open conversation with Wanjiku ");
    expect(text("[data-waiting-count]")).toBe("1 request waiting for you");
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
    await queue((r) => r.method === "POST" && refuse ? { status: 503, data: { error: { code: "server", message: "Busy" } } } : undefined);
    const id = pendingMentorRequest.id;
    await act(async () => button(id, "Not this month").click());
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
    await act(async () => sendDecline(id).click());
    await settle();
    expect(request(id).dataset.status).toBe("PENDING");
    expect(request(id).textContent).toContain("That didn't go through, so nothing changed.");
    // A refused answer changed nothing, so nothing is counted again.
    expect(refreshes).not.toHaveBeenCalled();
    refuse = false;
    await act(async () => sendDecline(id).click());
    await settle();
    expect(request(id).dataset.status).toBe("DECLINED");
    expect(text("[data-spots-used]")).toBe("0 of 3");
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
    const note = declineNote(id)!.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(note, "  I'm travelling this month. Try me in December?  ");
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => sendDecline(id).click());
    await settle();
    expect(mock.requests().find((r) => r.id === id)).toMatchObject({ status: "DECLINED", responseNote: "I'm travelling this month. Try me in December?" });
  });

  it("tells a paused mentor they're out of the directory, not what members see when full (QA4-15)", async () => {
    await act(async () => root.render(
      <MentorRequestsQueue initial={{ items: [], nextCursor: null }} mentors={mentors.items} availability={{ ...availability, paused: true, listed: false }} anotherLook={null} now={FIXTURE_NOW} />,
    ));
    expect(text("[data-spots-note]")).toBe("You've paused new requests, so you're not in the mentor directory. Requests already waiting stay with you.");
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
});

describe("the availability editor", () => {
  it("saves a change, says whether the mentor is listed, and undoes unsaved changes", async () => {
    const mock = createMentoringMock({ viewer: people.david });
    await act(async () => root.render(<AvailabilityEditor initial={mock.availability(people.david.id)} now={FIXTURE_NOW} api={mock.api} />));
    expect(q("[data-availability-editor] [data-listing]")!.dataset.listing).toBe("listed");
    const save = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Save availability")!;
    expect(save.disabled).toBe(true);
    const pause = q<HTMLInputElement>("input[role=switch]")!;
    await act(async () => pause.click());
    expect(pause.getAttribute("aria-checked")).toBe("true");
    expect(save.disabled).toBe(false);
    await act(async () => q<HTMLFormElement>("[data-availability-editor]")!.requestSubmit());
    await settle();
    expect(q("[data-listing]")!.dataset.listing).toBe("unlisted");
    expect(text("[data-listing]")).toContain("Paused.");
    expect(q("[data-availability-saved]")).not.toBeNull();
    expect(mock.availability(people.david.id).paused).toBe(true);
  });

  it("focuses the first field to fix", async () => {
    const mock = createMentoringMock({ viewer: people.peter });
    await act(async () => root.render(<AvailabilityEditor initial={mock.availability(people.peter.id)} now={FIXTURE_NOW} api={mock.api} />));
    expect(text("[data-listing]")).toContain("Not listed yet");
    const capacity = q<HTMLInputElement>("input[type=number]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(capacity, "2");
      capacity.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => q<HTMLFormElement>("[data-availability-editor]")!.requestSubmit());
    expect(document.activeElement?.id).toMatch(/-headline$/);
    expect(document.activeElement?.getAttribute("aria-invalid")).toBe("true");
  });
});

it("keeps the directory's URL state free of a stale drawer", () => {
  expect(parseDirectoryUrl(new URLSearchParams("?ask=")).ask).toBeNull();
  expect(NO_FILTERS).toEqual({ area: null, format: null, available: false });
});
