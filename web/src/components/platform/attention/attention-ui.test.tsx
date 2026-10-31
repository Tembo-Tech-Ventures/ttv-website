// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttentionList, MarkAttentionRead, ROUTES, SPACE_ORDER, type AttentionCount, type AttentionItem, type Me } from "@/lib/platform/contracts";
import { attention, meByPersona } from "@/lib/platform/fixtures";
import { createApiClient, type ApiClient } from "@/lib/platform/client/apiClient";
import { createMockTransport, type MockReply } from "@/lib/platform/client/mockTransport";
import { latestAttentionCounts, requestShellOverlay } from "@/components/platform/shell/overlays";
import { ATTENTION_PAGE_HREF } from "./attention-display";
import AttentionPage, { AttentionPageView } from "./AttentionPage";
import AttentionPanel from "./AttentionPanel";
import { useAttentionOwner } from "./attention-client";
import LiveRegions from "@/components/platform/overlays/LiveRegions";

const wanjiku = meByPersona.wanjiku;
const SNAPSHOT = attention.snapshotAt;

type Server = {
  items: AttentionItem[];
  /** Replies that replace the next calls to a path, in order. */
  fail: Map<string, MockReply[]>;
  reads: MarkAttentionRead[];
  calls: string[];
};

function count(items: readonly AttentionItem[]): AttentionCount {
  const unreadCounts = Object.fromEntries(SPACE_ORDER.map((space) => [space, 0])) as AttentionCount["unreadCounts"];
  for (const item of items) if (item.readAt === null) unreadCounts[item.space]++;
  return { count: Object.values(unreadCounts).reduce((sum, value) => sum + value, 0), unreadCounts };
}

function server(items: AttentionItem[] = attention.items.map((item) => ({ ...item }))): { api: ApiClient; state: Server } {
  const state: Server = { items, fail: new Map(), reads: [], calls: [] };
  const fetch = createMockTransport(
    [
      { ...ROUTES.listAttention, reply: () => ({ data: AttentionList.parse({ items: state.items, nextCursor: null, snapshotAt: SNAPSHOT }) }) },
      { ...ROUTES.countAttention, reply: () => ({ data: count(state.items) }) },
      {
        ...ROUTES.markAttentionRead,
        reply: async ({ request }) => {
          const body = MarkAttentionRead.parse(await request.json());
          state.reads.push(body);
          state.items = state.items.map((item) =>
            item.readAt === null && ("ids" in body ? body.ids.includes(item.id) : item.createdAt <= body.through) ? { ...item, readAt: SNAPSHOT } : item,
          );
          return { data: count(state.items) };
        },
      },
    ],
    {
      failure: (request) => {
        const path = new URL(request.url).pathname;
        state.calls.push(`${request.method} ${path}`);
        return state.fail.get(path)?.shift();
      },
    },
  );
  return { api: createApiClient({ fetch, retry: { maxRetries: 0 } }), state };
}

type HappyDOM = { setViewport(size: { width: number; height: number }): void };
const happyDOM = () => (window as unknown as { happyDOM: HappyDOM }).happyDOM;

let root: Root;
let container: HTMLDivElement;
let assign: ReturnType<typeof vi.fn<(url: string | URL) => void>>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  assign = vi.fn<(url: string | URL) => void>();
  vi.spyOn(window.location, "assign").mockImplementation(assign);
  happyDOM().setViewport({ width: 1440, height: 900 });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Lets mock responses, store updates and React effects all settle. */
async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  });
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

function rows() {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-attention-item]"));
}

function polite() {
  return container.querySelector('[data-live-regions="attention"] output')?.textContent ?? "";
}

function assertive() {
  return container.querySelector('[data-live-regions="attention"] [role="alert"]')?.textContent ?? "";
}

function button(name: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((element) => element.textContent?.trim() === name);
  if (!found) throw new Error(`No button "${name}"`);
  return found;
}

describe("the attention page on the server", () => {
  it("renders the first page without JavaScript: New and Earlier, ages from the list's own snapshot", () => {
    const html = renderToString(<AttentionPage me={wanjiku} initialList={attention} />);
    expect(html).toContain("Needs your attention");
    expect(html).toContain("4 new");
    expect(html).toContain(">New</h3>");
    expect(html).toContain(">Earlier</h3>");
    expect(html).toContain('href="/dashboard/community/dm/');
    expect(html).toMatch(/10 min<span class="sr-only"> ago<\/span>/);
    expect(html).not.toContain("Loading what needs you");
    // Each unread item says so to a screen reader, not only with a dot.
    expect(html.match(/Unread: /g)).toHaveLength(4);
  });

  it("is honest about an empty inbox", () => {
    const html = renderToString(<AttentionPage me={{ ...wanjiku, unreadCounts: count([]).unreadCounts }} initialList={{ ...attention, items: [] }} />);
    expect(html).toContain("You&#x27;re all caught up.");
    expect(html).toContain("Nothing needs you right now.");
  });
});

describe("the attention page in the browser", () => {
  async function mountPage(api: ApiClient, initialList?: AttentionList, me: Me = wanjiku) {
    await act(async () => root.render(<AttentionPageView api={api} initialList={initialList} me={me} />));
    await settle();
  }

  it("opens an item: marks it read, says so, and follows its link once the mark has landed", async () => {
    const { api, state } = server();
    await mountPage(api, attention);
    const link = rows()[0].querySelector("a")!;
    await act(async () => link.click());
    await settle();
    expect(state.reads).toEqual([{ ids: [attention.items[0].id] }]);
    expect(assign).toHaveBeenCalledWith(link.href);
    expect(polite()).toBe("Marked read");
    expect(latestAttentionCounts()?.community).toBe(1);
  });

  it("rolls a failed mark back, keeps a retry, and says so assertively", async () => {
    const { api, state } = server();
    state.fail.set(ROUTES.markAttentionRead.path, [{ status: 500, data: { error: { code: "server", message: "x" } } }]);
    await mountPage(api, attention);
    await act(async () => button("Mark all read").click());
    await settle();
    expect(rows().filter((row) => row.dataset.unread !== undefined)).toHaveLength(4);
    expect(container.textContent).toContain("Couldn't mark everything read.");
    expect(assertive()).toContain("Could not mark read");

    await act(async () => button("Try again").click());
    await settle(800);
    expect(state.reads).toEqual([{ through: SNAPSHOT }]);
    expect(rows().filter((row) => row.dataset.unread !== undefined)).toHaveLength(0);
    expect(container.querySelector("[data-attention-failure]")).toBeNull();
  });

  it("marks everything read only up to the list's snapshot, so newer items stay new", async () => {
    const { api, state } = server();
    await mountPage(api, attention);
    // Someone mentions Wanjiku after the list was taken.
    state.items = [{ ...attention.items[1], id: "after-snapshot", readAt: null, createdAt: SNAPSHOT + 60_000 }, ...state.items];
    await act(async () => button("Mark all read").click());
    await settle();
    expect(state.reads).toEqual([{ through: SNAPSHOT }]);
    expect(rows().filter((row) => row.dataset.unread !== undefined)).toHaveLength(0);
    expect(container.querySelector("[data-attention-total]")?.textContent).toBe("1 new");
  });

  it("never shows an item from a space the person cannot open", async () => {
    const hidden: AttentionItem = { ...attention.items[0], id: "admin-only", space: "admin", summary: "Moderation is waiting" };
    const { api } = server([hidden, ...attention.items]);
    await mountPage(api, { ...attention, items: [hidden, ...attention.items] });
    expect(container.textContent).not.toContain("Moderation is waiting");
  });

  it("loads the list itself when the server could not, and shows a retry when that fails too", async () => {
    const { api, state } = server();
    state.fail.set(ROUTES.listAttention.path, [{ status: 503, data: { error: { code: "server", message: "x" } } }]);
    await mountPage(api);
    expect(container.querySelector('[data-attention-problem="failed"]')?.textContent).toContain("Couldn't load attention items.");
    expect(assertive()).toBe("Could not load attention items");
    await act(async () => button("Try again").click());
    await settle();
    expect(rows()).toHaveLength(attention.items.length);
  });

  it("tells a signed-out person to sign in again, and where that leads back to", async () => {
    const { api, state } = server();
    state.fail.set(ROUTES.listAttention.path, [{ status: 401, data: { error: { code: "forbidden", message: "x" } } }]);
    await mountPage(api);
    const note = container.querySelector('[data-attention-problem="signed-out"]');
    expect(note?.textContent).toContain("You've been signed out");
    expect(note?.querySelector("a")?.getAttribute("href")).toMatch(/^\/auth\/login\?next=%2F/);
  });

  it("calls a 404 what it is: unavailable (flag off, or no session) rather than an empty inbox", async () => {
    const { api, state } = server();
    state.fail.set(ROUTES.listAttention.path, [{ status: 404, data: { error: { code: "flag_off", message: "x" } } }]);
    await mountPage(api);
    expect(container.querySelector('[data-attention-problem="unavailable"]')).not.toBeNull();
    expect(container.querySelector("[data-attention-empty]")).toBeNull();
  });

  it("announces new attention once per poll that finds it, again when it happens again", async () => {
    const { api, state } = server();
    await mountPage(api, attention);
    const arrive = (id: string) =>
      (state.items = [{ ...attention.items[1], id, readAt: null, createdAt: SNAPSHOT + 1 }, ...state.items]);
    arrive("new-1");
    await act(async () => window.dispatchEvent(new Event("focus")));
    await settle(50);
    expect(polite()).toBe("1 new attention item");
    const first = container.querySelector('[data-live-regions="attention"] output span');

    arrive("new-2");
    await act(async () => window.dispatchEvent(new Event("focus")));
    await settle(800);
    expect(polite()).toBe("1 new attention item");
    // A fresh node, so assistive technology reads the same words again.
    expect(container.querySelector('[data-live-regions="attention"] output span')).not.toBe(first);
  });

  it("resumes paused counts only after waiting writes settle (a pending write would make the resume a no-op)", async () => {
    const { api, state } = server();
    state.fail.set(ROUTES.countAttention.path, [{ status: 401, data: { error: { code: "forbidden", message: "x" } } }]);
    await mountPage(api, attention);
    await act(async () => window.dispatchEvent(new Event("focus")));
    await settle(50);
    expect(container.querySelector('[data-attention-problem="signed-out"]')).not.toBeNull();

    state.items = [{ ...attention.items[1], id: "while-paused", readAt: null, createdAt: SNAPSHOT + 1 }, ...state.items];
    await act(async () => {
      button("Mark all read").click();
      button("Check again").click();
    });
    await settle(50);
    expect(state.calls.filter((call) => call.endsWith("/count")).length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('[data-attention-problem="signed-out"]')).toBeNull();
  });
});

describe("the attention panel", () => {
  function Panel({ api }: { api: ApiClient }) {
    const owner = useAttentionOwner(wanjiku, { api });
    return (
      <>
        <AttentionPanel owner={owner} me={wanjiku} />
        <LiveRegions announcer={owner.announcer} name="attention" />
      </>
    );
  }

  async function mountPanel(api: ApiClient) {
    await act(async () => root.render(<Panel api={api} />));
    const bell = document.createElement("button");
    bell.textContent = "bell";
    document.body.appendChild(bell);
    return bell;
  }

  it("opens from the bell as a modal sheet, loads, starts on the chosen filter and gives focus back on close", async () => {
    const { api } = server();
    const bell = await mountPanel(api);
    const dialog = container.querySelector<HTMLDialogElement>("[data-attention-panel]")!;
    await act(async () => requestShellOverlay({ overlay: "attention", trigger: bell, via: "click" }));
    await settle();
    expect(dialog.open).toBe(true);
    expect(document.activeElement?.getAttribute("data-attention-filter")).toBe("all");
    expect(rows()).toHaveLength(attention.items.length);

    await act(async () => dialog.close());
    await settle();
    expect(document.activeElement).toBe(bell);
    bell.remove();
  });

  it("sends phones to the attention page instead of opening", async () => {
    happyDOM().setViewport({ width: 390, height: 844 });
    const { api } = server();
    const bell = await mountPanel(api);
    await act(async () => requestShellOverlay({ overlay: "attention", trigger: bell, via: "click" }));
    expect(assign).toHaveBeenCalledWith(ATTENTION_PAGE_HREF);
    expect(container.querySelector<HTMLDialogElement>("[data-attention-panel]")!.open).toBe(false);
    bell.remove();
  });

  it("steps aside when search is asked for, so only one overlay is ever open", async () => {
    const { api } = server();
    const bell = await mountPanel(api);
    await act(async () => requestShellOverlay({ overlay: "attention", trigger: bell, via: "click" }));
    await act(async () => requestShellOverlay({ overlay: "search", trigger: null, via: "shortcut" }));
    expect(container.querySelector<HTMLDialogElement>("[data-attention-panel]")!.open).toBe(false);
    bell.remove();
  });

  it("cycles Tab within the panel", async () => {
    const { api } = server();
    const bell = await mountPanel(api);
    await act(async () => requestShellOverlay({ overlay: "attention", trigger: bell, via: "click" }));
    await settle();
    const dialog = container.querySelector<HTMLDialogElement>("[data-attention-panel]")!;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
    focusable.at(-1)!.focus();
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(focusable[0]);
    bell.remove();
  });
});
