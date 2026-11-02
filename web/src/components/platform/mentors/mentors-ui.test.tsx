// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTES, type MentorDirectoryItem } from "@/lib/platform/contracts";
import { availability, FIXTURE_NOW, meByPersona, mentors, people, pendingMentorRequest } from "@/lib/platform/fixtures";
import { NO_FILTERS, parseDirectoryUrl } from "@/lib/platform/client/mentor-directory";
import { createMentoringMock } from "@/lib/platform/client/mentoring.mock";
import type { MockReply } from "@/lib/platform/client/mockTransport";
import AvailabilityEditor from "./AvailabilityEditor";
import MentorRequestsQueue from "./MentorRequestsQueue";
import MentorsDirectory, { type MentorsDirectoryProps } from "./MentorsDirectory";

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
  conductAgreed?: boolean; member?: boolean; failure?: (request: Request) => MockReply | undefined; search?: string;
} = {}) {
  const mock = createMentoringMock({
    conductAgreed: options.conductAgreed, member: options.member, ...(options.failure ? { failure: options.failure } : {}),
  });
  const filters = parseDirectoryUrl(new URLSearchParams(options.search ?? ""));
  const [list, own] = await Promise.all([
    mock.api.call(ROUTES.listMentors, { query: {} }),
    mock.api.call(ROUTES.listMentorRequests, { query: { as: "requester" } }),
  ]);
  const props: MentorsDirectoryProps = {
    me: meByPersona.wanjiku, path: PATH, filters, mentors: list.items, shown: list.items,
    areas: ["Code review", "Career"], ownRequests: own, projects: mock.projects, conduct, now: FIXTURE_NOW, api: mock.api,
    canAsk: options.member !== false,
  };
  return { props, mock };
}

const card = (item: MentorDirectoryItem) => q(`[data-mentor-card="${item.person.id}"]`)!;
const [david, mercy, joseph] = mentors.items;

describe("the mentor directory", () => {
  it("reads without JavaScript: cards, capacity, filters and the person's own requests", async () => {
    const { props } = await directoryProps({ search: "?area=Career&available=true" });
    const html = renderToString(<MentorsDirectory {...props} />);
    container.innerHTML = html;
    expect(all("[data-mentor-card]")).toHaveLength(4);
    expect(card(david).textContent).toContain("2 of 3 spots open in November");
    expect(card(david).querySelector("[data-ask-mentor]")?.textContent).toBe("Ask for time");
    // Mercy is full: the next opening, and no button that does nothing.
    expect(card(mercy).textContent).toContain("Next opening 1 December");
    expect(card(mercy).querySelector("[data-mentor-full]")?.textContent).toBe("Full this month");
    expect(card(mercy).querySelector("button")).toBeNull();
    // Filters are links held in the URL; the active ones say so.
    const active = all("[data-mentor-filters] a[aria-current='true']").map((link) => link.textContent);
    expect(active).toEqual(["Career", "Any", "Has open spots"]);
    expect(q<HTMLAnchorElement>("[data-filter-available]")!.getAttribute("href")).toBe(`${PATH}?area=Career`);
    expect(all("[data-own-request]").map((row) => row.dataset.status)).toEqual(["PENDING", "ACCEPTED"]);
    expect(html).not.toContain("<dialog open");
  });

  it("reads for an account without a profile or cohort place, with no way to ask and a neutral reason", async () => {
    const { props } = await directoryProps({ member: false, search: `?ask=${david.person.id}` });
    container.innerHTML = renderToString(<MentorsDirectory {...props} />);
    expect(all("[data-mentor-card]")).toHaveLength(4);
    expect(all("[data-ask-mentor]")).toHaveLength(0);
    expect(card(david).textContent).toContain("2 of 3 spots open in November");
    expect(text("[data-mentors-need-member]")).toContain("Asking a mentor for time needs a member profile or a cohort place.");
    // `?ask=` opens nothing: there is nothing this person could send.
    expect(q("[data-mentor-drawer-static]")).toBeNull();
  });

  it("says when nothing matches, with the way back to every mentor", async () => {
    const { props } = await directoryProps({ search: "?format=QUICK_QUESTION" });
    await act(async () => root.render(<MentorsDirectory {...props} shown={[]} />));
    expect(text("[data-mentors-empty]")).toContain("No mentors match these filters right now.");
    expect(q<HTMLAnchorElement>("[data-mentors-empty] a")!.getAttribute("href")).toBe(PATH);
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
  });

  it("asks for the code of conduct first, keeping the note, with a form that posts back to this drawer", async () => {
    const { props } = await directoryProps({ conductAgreed: false });
    await act(async () => root.render(<MentorsDirectory {...props} />));
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
    const agree = prompt.querySelector<HTMLFormElement>("form")!;
    expect(agree.getAttribute("method")).toBe("post");
    expect(agree.getAttribute("action")).toBe(`${PATH}?ask=${encodeURIComponent(joseph.person.id)}`);
    expect(Object.fromEntries(new FormData(agree))).toEqual({ intent: "conduct", version: "1" });
    expect(prompt.querySelector("a")!.getAttribute("href")).toBe("/dashboard/community/conduct");
    // The note waits in the tab for the return trip.
    expect(Object.values({ ...sessionStorage }).join(" ")).toContain("Interview practice?");
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
  async function queue(failure?: (request: Request) => MockReply | undefined) {
    const mock = createMentoringMock({ viewer: people.david, ...(failure ? { failure } : {}) });
    const [initial, list] = await Promise.all([
      mock.api.call(ROUTES.listMentorRequests, { query: { as: "mentor" } }),
      mock.api.call(ROUTES.listMentors, { query: {} }),
    ]);
    await act(async () => root.render(<MentorRequestsQueue initial={initial} mentors={list.items} availability={availability} now={FIXTURE_NOW} api={mock.api} />));
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

  it("accepts at once and then links the conversation", async () => {
    await queue();
    await act(async () => button(pendingMentorRequest.id, "Accept").click());
    expect(request(pendingMentorRequest.id).dataset.status).toBe("ACCEPTED");
    expect(document.activeElement?.hasAttribute("data-request-heading")).toBe(true);
    await settle();
    expect(request(pendingMentorRequest.id).querySelector("a[href^='/dashboard/community/dm/']")!.textContent).toBe("Open conversation with Wanjiku ");
    expect(text("[data-waiting-count]")).toBe("1 request waiting for you");
  });

  it("declines in one tap, frees the spot, and rolls back when refused", async () => {
    let refuse = true;
    await queue((r) => r.method === "POST" && refuse ? { status: 503, data: { error: { code: "server", message: "Busy" } } } : undefined);
    const id = pendingMentorRequest.id;
    await act(async () => button(id, "Not this month").click());
    await settle();
    expect(request(id).dataset.status).toBe("PENDING");
    expect(request(id).textContent).toContain("That didn't go through, so nothing changed.");
    refuse = false;
    await act(async () => button(id, "Not this month").click());
    await settle();
    expect(request(id).dataset.status).toBe("DECLINED");
    expect(text("[data-spots-used]")).toBe("0 of 3");
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
