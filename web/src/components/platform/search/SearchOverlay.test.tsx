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

function backend(): { client: ApiClient; state: Backend } {
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
              messages: none ? [] : searchResults.messages,
              people: none ? [] : searchResults.people,
              projects: none ? [] : searchResults.projects,
              sessionMoments: none ? [] : searchResults.sessionMoments,
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
  it("promises only what this person can find, and marks when it is listening", async () => {
    const lucy = { ...meByPersona.lucy, flags: { ...meByPersona.lucy.flags, channels: false } };
    await act(async () => root.render(<SearchOverlay me={lucy} client={backend().client} />));
    expect(dialog().hasAttribute("data-ready")).toBe(true);
    expect(input().placeholder).toBe("Search people and projects");
    expect(input().getAttribute("aria-label")).toBe("Search people and projects");
    expect(container.querySelector("h2")?.textContent).toBe("Search");
    expect(container.textContent).toContain("Find people and projects.");
    expect(container.querySelector('[data-search-scope="messages"]')).toBeNull();
    await act(async () => root.render(<SearchOverlay me={wanjiku} client={backend().client} />));
    expect(input().placeholder).toBe("Search messages, people, projects and your cohort's sessions");
    expect(container.querySelector('[data-search-scope="messages"]')?.textContent).toBe("Messages");
  });

  it("names its close button with the key it shows, and gives Escape as its shortcut (WCAG 2.5.3)", async () => {
    await mount();
    const close = container.querySelector<HTMLButtonElement>("button.search-overlay__close")!;
    expect(close.querySelector(".search-overlay__esc")?.textContent?.trim()).toBe("Esc");
    expect(close.getAttribute("aria-label")).toBe("Close search, Esc");
    expect(close.getAttribute("aria-keyshortcuts")).toBe("Escape");
  });

  it("says why a result matched when its words do not show it", async () => {
    await mount();
    await type("SQL");
    await settle(300);
    const why = Array.from(container.querySelectorAll(".search-option__why")).map((element) => element.textContent);
    expect(why).toEqual(["Matches “SQL” elsewhere in their public profile", "Matches “SQL” in the project's full description"]);
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
    expect(groups).toEqual(["Messages", "People", "Projects", "Moments in your sessions"]);
    expect(polite()).toBe("5 results");
    // Visibility labels are the server's, shown as given.
    expect(container.textContent).toContain("Cohort 04 · only you and your cohort see this");

    await key("ArrowDown");
    await key("ArrowDown");
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[1].id);
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    await key("Enter");
    // A message opens where the server says it lives, in its channel or thread.
    expect(assign).toHaveBeenCalledWith(searchResults.messages[1].href);
    expect(JSON.parse(localStorage.getItem(recentSearchKey(wanjiku.user.id))!)).toEqual(["retry webhook"]);
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
    expect(options()).toHaveLength(5);
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
