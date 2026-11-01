// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTES, SearchQuery, SearchResults, type Me } from "@/lib/platform/contracts";
import { meByPersona, searchResults } from "@/lib/platform/fixtures";
import { createApiClient, type ApiClient } from "@/lib/platform/client/apiClient";
import { createMockTransport, type MockReply } from "@/lib/platform/client/mockTransport";
import { requestShellOverlay } from "@/components/platform/shell/overlays";
import { askTemboHref } from "./ask-handoff";
import { recentSearchKey } from "./recent-searches";
import SearchOverlay from "./SearchOverlay";

const wanjiku = meByPersona.wanjiku;

type Backend = { calls: string[]; queries: string[]; fail: MockReply[]; latency: (q: string) => number };
type Answer = Pick<SearchResults, "people" | "projects" | "sessionMoments">;

function backend(answer?: (q: string) => Answer): { client: ApiClient; state: Backend } {
  const state: Backend = { calls: [], queries: [], fail: [], latency: () => 0 };
  const fetch = createMockTransport(
    [
      {
        method: ROUTES.search.method,
        path: ROUTES.search.path,
        reply: async ({ request }) => {
          const query = SearchQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
          state.queries.push(query.q);
          await new Promise((resolve) => {
            setTimeout(resolve, state.latency(query.q));
          });
          const none = /nothing/.test(query.q);
          return {
            data: SearchResults.parse({
              ...searchResults,
              query,
              people: none ? [] : searchResults.people,
              projects: none ? [] : searchResults.projects,
              sessionMoments: none ? [] : searchResults.sessionMoments,
              ...answer?.(query.q),
            }),
          };
        },
      },
    ],
    {
      failure: (request) => {
        state.calls.push(new URL(request.url).pathname);
        return state.fail.shift();
      },
    },
  );
  return { client: createApiClient({ fetch, retry: { maxRetries: 0 } }), state };
}

let root: Root;
let container: HTMLDivElement;
let assign: ReturnType<typeof vi.fn<(url: string | URL) => void>>;
let trigger: HTMLButtonElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  assign = vi.fn<(url: string | URL) => void>();
  vi.spyOn(window.location, "assign").mockImplementation(assign);
  trigger = document.createElement("button");
  document.body.appendChild(trigger);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  trigger.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  });
}

const dialog = () => container.querySelector<HTMLDialogElement>("[data-search-overlay]")!;
const input = () => container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
const options = () => Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'));
const polite = () => container.querySelector('[data-live-regions="search"] output')?.textContent ?? "";

async function mount(me: Me = wanjiku, client = backend().client) {
  await act(async () => root.render(<SearchOverlay me={me} client={client} />));
  await act(async () => requestShellOverlay({ overlay: "search", trigger, via: "shortcut" }));
  await settle(20);
}

async function type(text: string) {
  const field = input();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(name: string) {
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  });
}

describe("SearchOverlay", () => {
  it("marks itself ready once it listens for the shell's open request", async () => {
    await act(async () => root.render(<SearchOverlay me={wanjiku} client={backend().client} />));
    expect(dialog().hasAttribute("data-ready")).toBe(true);
    await act(async () => root.render(<></>));
    expect(container.querySelector("[data-search-overlay]")).toBeNull();
  });

  it("opens for Ctrl K with focus in the box, and Escape-closing gives focus back", async () => {
    await mount();
    expect(dialog().open).toBe(true);
    expect(document.activeElement).toBe(input());
    await act(async () => dialog().close());
    expect(document.activeElement).toBe(trigger);
  });

  it("waits a beat, then shows grouped results; arrows choose and Enter opens, remembering the search", async () => {
    const { client, state } = backend();
    await mount(wanjiku, client);
    await type("retry webhook");
    expect(state.calls).toHaveLength(0);
    await settle(300);
    expect(state.calls).toEqual(["/api/search"]);
    const groups = Array.from(container.querySelectorAll('[role="group"]')).map((group) => group.getAttribute("aria-label"));
    expect(groups).toEqual(["People", "Projects", "Moments in your sessions"]);
    expect(polite()).toBe("3 results");
    // Visibility labels are the server's, shown as given.
    expect(container.textContent).toContain("Cohort 04 · only you and your cohort see this");

    await key("ArrowDown");
    await key("ArrowDown");
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[1].id);
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    await key("Enter");
    expect(assign).toHaveBeenCalledWith(searchResults.projects[0].href);
    expect(JSON.parse(localStorage.getItem(recentSearchKey(wanjiku.user.id))!)).toEqual(["retry webhook"]);
  });

  it("says what it covers for this person, never everything (QA1-11)", async () => {
    await mount();
    expect(input().getAttribute("aria-label")).toBe("Search people, projects and your sessions");
    expect(input().placeholder).toBe("Search people, projects and your sessions");
    expect(container.querySelector(".search-overlay__status")?.textContent).toBe(
      "Finds people with public profiles, your shared projects, and moments from your own cohort's sessions.",
    );
    expect(container.textContent).not.toMatch(/everything|everywhere/i);
  });

  it("says what it covers for staff outside a cohort: no sessions", async () => {
    await mount(meByPersona.amina);
    expect(input().getAttribute("aria-label")).toBe("Search people and projects");
    expect(container.querySelector(".search-overlay__status")?.textContent).not.toMatch(/session/);
  });

  it("shows why each result matched: the matching part of a long text, or which hidden field matched", async () => {
    const long = `${"Offline-first Android tools for clinics and co-ops. ".repeat(8)}Also writes SQL for ledgers.`;
    const { client } = backend(() => ({
      people: [
        { ...searchResults.people[0]!, bio: long },
        { ...searchResults.people[0]!, person: { ...searchResults.people[0]!.person, id: "p-2", name: "Brian Odhiambo" }, bio: "USSD tinkerer." },
      ],
      projects: [{ ...searchResults.projects[0]!, title: "Chama ledger", summary: "Weekly contributions." }],
      sessionMoments: [],
    }));
    await mount(wanjiku, client);
    await type("sql");
    await settle(300);
    const [faith, brian, project] = options();
    // The bio is cut to the match, which is marked.
    expect(faith.querySelector(".search-option__text")?.textContent).toMatch(/^….*SQL for ledgers\.$/);
    expect(faith.querySelector(".search-mark")?.textContent).toBe("SQL");
    expect(faith.querySelector(".search-option__why")).toBeNull();
    // Matched in a field the result does not carry: say so rather than show no reason.
    expect(brian.querySelector(".search-option__why")?.textContent).toBe("Matches their headline, skills or full bio");
    expect(project.querySelector(".search-option__why")?.textContent).toBe("Matches its full description");
  });

  it("never lets an older answer replace a newer question", async () => {
    const { client, state } = backend();
    state.latency = (q) => (q === "retry" ? 400 : 0);
    await mount(wanjiku, client);
    await type("retry");
    await settle(300); // "retry" is now in flight.
    await type("nothing here");
    await settle(700);
    expect(state.queries).toEqual(["retry", "nothing here"]);
    expect(options()).toHaveLength(0);
    expect(container.querySelector("[data-search-empty]")?.textContent).toContain("nothing here");
  });

  it("hands the words to Ask Tembo, unsent, for a cohort member only", async () => {
    const { client, state } = backend();
    await mount(wanjiku, client);
    await type("retry webhook");
    const ask = container.querySelector<HTMLButtonElement>("[data-ask-tembo]")!;
    await act(async () => ask.click());
    expect(assign).toHaveBeenCalledWith(askTemboHref("retry webhook"));
    // Only search was ever called: no channel or Tembo endpoint.
    expect(state.calls.every((path) => path === "/api/search")).toBe(true);
  });

  it("offers no Ask Tembo to someone without a cohort", async () => {
    await mount(meByPersona.lucy);
    await type("retry webhook");
    expect(container.querySelector("[data-ask-tembo]")).toBeNull();
  });

  it("does no work at all while the spaces flag is off", async () => {
    const { client, state } = backend();
    const off: Me = { ...wanjiku, flags: { ...wanjiku.flags, spaces: false } };
    await mount(off, client);
    await type("retry webhook");
    await settle(300);
    expect(state.calls).toHaveLength(0);
  });

  it("forgets every recent search on sign-out from the shell", async () => {
    localStorage.setItem(recentSearchKey(wanjiku.user.id), JSON.stringify(["webhooks"]));
    localStorage.setItem(recentSearchKey("someone-else"), JSON.stringify(["theirs"]));
    await mount();
    expect(localStorage.getItem(recentSearchKey("someone-else"))).toBeNull();
    expect(container.querySelector("[data-search-recent]")?.textContent).toContain("webhooks");

    const signOut = document.createElement("a");
    signOut.href = "#signed-out";
    signOut.setAttribute("data-shell-sign-out", "");
    document.body.appendChild(signOut);
    await act(async () => signOut.click());
    expect(localStorage.getItem(recentSearchKey(wanjiku.user.id))).toBeNull();
    expect(container.querySelector("[data-search-recent]")).toBeNull();
    signOut.remove();
  });

  it("says plainly when search failed, and tries again on request", async () => {
    const { client, state } = backend();
    state.fail.push({ status: 503, data: { error: { code: "server", message: "x" } } });
    await mount(wanjiku, client);
    await type("retry webhook");
    await settle(300);
    expect(container.querySelector("[data-search-problem]")?.textContent).toContain("Search didn't work this time.");
    const retry = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Try again")!;
    await act(async () => retry.click());
    await settle(300);
    expect(options()).toHaveLength(3);
  });

  it("sends a signed-out person to sign in again rather than showing nothing", async () => {
    const { client, state } = backend();
    state.fail.push({ status: 401, data: { error: { code: "forbidden", message: "x" } } });
    await mount(wanjiku, client);
    await type("retry webhook");
    await settle(300);
    const problem = container.querySelector("[data-search-problem]")!;
    expect(problem.textContent).toContain("signed out");
    expect(problem.querySelector("a")?.getAttribute("href")).toMatch(/^\/auth\/login\?next=/);
    expect(container.querySelector("[data-search-empty]")).toBeNull();
  });
});
