// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTES, type Channel, type Me, type Message, type MessageList } from "@/lib/platform/contracts";
import { ApiError, createApiClient, type ApiClient } from "@/lib/platform/client/apiClient";
import { createChannelStore } from "@/lib/platform/client/channel";
import { createMockTransport } from "@/lib/platform/client/mockTransport";
import { channels, FIXTURE_NOW, meByPersona, messages, people } from "@/lib/platform/fixtures";
import { createFixtureActions, type ChannelActions } from "./actions";
import ChannelSurface from "./ChannelSurface";
import ChannelView from "./ChannelView";
import { channelFor, channelPage, shareablesFor, threadPage } from "./harness/fixture-pages";

const wanjiku = meByPersona.wanjiku;
const community = channels.showYourWork;
const cohort = channelFor("cohort-04", wanjiku)!;

/** A channel API whose `since` polls deliver whatever the test queues. */
function server(me: Me, channel: Channel) {
  const queue: Message[] = [];
  const root = channelPage(channel, me);
  const fetch = createMockTransport([
    {
      ...ROUTES.listMessages,
      reply: ({ request }) => {
        const query = new URL(request.url).searchParams;
        const thread = query.get("thread");
        if (thread) return { data: threadPage(channel, thread, me) };
        if (query.has("since")) {
          const items = queue.splice(0);
          return { data: { items, beforeCursor: null, sinceCursor: `since-${items.length}-${Math.random()}`, thread: null, removedIds: [] } };
        }
        return { data: root };
      },
    },
    { ...ROUTES.markChannelRead, reply: () => ({ data: { channelId: channel.id, lastReadMessageId: root.items.at(-1)!.id, unreadCount: 0 } }) },
  ]);
  return { api: createApiClient({ fetch, retry: { maxRetries: 0 } }), root, queue };
}

function setup(me: Me, channel: Channel, api: ApiClient, initial: MessageList) {
  const store = createChannelStore({ channelId: channel.id, enabled: me.flags.channels, viewerId: me.user.id, initial, api });
  const actions = createFixtureActions(store, { author: me.user, shareables: shareablesFor(me), now: () => FIXTURE_NOW });
  return { store, actions };
}

let root: Root;
let container: HTMLDivElement;

const tick = (ms = 0) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});
const frame = () => new Promise<void>((resolve) => {
  requestAnimationFrame(() => resolve());
});

function mediaQueries(matches: Record<string, boolean>) {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: matches[query] ?? false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList);
}

async function render(node: React.ReactNode) {
  await act(async () => root.render(node));
  // Let the first poll and effects settle.
  await act(tick);
}

const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const $$ = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const text = (selector: string) => $(selector)?.textContent ?? "";

async function typeInto(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(textarea, value);
    textarea.setSelectionRange(value.length, value.length);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(target: Element, keyName: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true, ...init }));
  });
}

async function click(target: Element | null) {
  if (!target) throw new Error("Nothing to click");
  await act(async () => {
    (target as HTMLElement).click();
    await tick();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.history.replaceState(null, "", "/dashboard/community/c/show-your-work");
  mediaQueries({});
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the channels flag", () => {
  it("renders nothing while channels is off, before and after hydration", async () => {
    const off: Me = { ...wanjiku, flags: { ...wanjiku.flags, channels: false } };
    const html = renderToString(<ChannelView me={off} channel={community} initial={channelPage(community, off)} now={FIXTURE_NOW} />);
    expect(html).toBe("");
    await render(<ChannelView me={off} channel={community} initial={channelPage(community, off)} now={FIXTURE_NOW} />);
    expect(container.innerHTML).toBe("");
  });

  it("makes no request while the flag is off", async () => {
    const off: Me = { ...wanjiku, flags: { ...wanjiku.flags, channels: false } };
    const fetch = vi.spyOn(globalThis, "fetch");
    await render(<ChannelView me={off} channel={community} now={FIXTURE_NOW} />);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("reading without JavaScript", () => {
  function serverHtml(me: Me, channel: Channel, extra: Partial<Parameters<typeof ChannelSurface>[0]> = {}) {
    const { api } = server(me, channel);
    const { store, actions } = setup(me, channel, api, channelPage(channel, me));
    container.innerHTML = renderToString(
      <ChannelSurface me={me} channel={channel} store={store} actions={actions} now={FIXTURE_NOW} shareables={shareablesFor(me)} {...extra}>
        <header>Frame header</header>
      </ChannelSurface>,
    );
  }

  it("puts the frame's header above the messages, and days under headings", () => {
    serverHtml(wanjiku, community);
    expect($("section.channel-view__main > header")?.textContent).toBe("Frame header");
    expect($$("h3.channel-day").map((h) => h.textContent)).toEqual(["Yesterday", "Today"]);
    expect($("[data-channel-scroller]")?.getAttribute("aria-label")).toBe("Messages in #show-your-work");
  });

  it("shows only the role badges the server sent, worded by the server", () => {
    serverHtml(wanjiku, community);
    const badges = (id: string) => [...container.querySelectorAll(`[data-message="${id}"] [data-role-badge]`)].map((badge) => badge.textContent);
    expect(badges(messages.projectPost.id)).toEqual(["Alumni · Cohort 02"]);
    expect(badges(messages.mentorOffer.id)).toEqual(["Mentor"]);
    expect(badges(messages.deleted.id)).toEqual([]);
  });

  it("shows deleted messages as a placeholder with nothing of the original", () => {
    serverHtml(wanjiku, community);
    const deleted = $(`[data-message="${messages.deleted.id}"]`)!;
    expect(deleted.textContent).toContain("This message was deleted.");
    expect(deleted.textContent).not.toContain(people.brian.name);
    expect(deleted.querySelector("[data-reaction], .channel-message__more")).toBeNull();
  });

  it("writes reactions as words with counts, and links threads to their own URL", () => {
    serverHtml(wanjiku, community);
    const post = $(`[data-message="${messages.projectPost.id}"]`)!;
    // The tally is its own span ("Useful" then "· 6"); the gap between them is layout, not text.
    expect([...post.querySelectorAll("[data-reaction]")].map((r) => r.textContent?.replace(/,.*$/, ""))).toEqual(["Useful· 6", "Learned something· 4"]);
    expect(post.querySelector("[data-reaction='useful']")?.getAttribute("aria-pressed")).toBe("true");
    const link = post.querySelector<HTMLAnchorElement>("[data-thread-trigger]")!;
    expect(link.getAttribute("href")).toBe(`?thread=${messages.projectPost.id}`);
    expect(link.querySelector(".channel-thread-link__count")?.textContent).toBe("5 replies");
    expect(link.querySelector(".channel-thread-link__last")?.textContent).toBe("· last 1 h ago");
    // The faces are decoration: hidden, so the link's name is its words.
    expect(link.querySelector(".channel-faces")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("marks edited messages", () => {
    serverHtml(wanjiku, community, { threadId: messages.projectPost.id, initialThread: threadPage(community, messages.projectPost.id, wanjiku) });
    expect($(`[data-message="${messages.authorReply.id}"] .channel-meta`)?.textContent).toContain("(edited)");
  });

  it("renders a server-rendered thread beside the list", () => {
    serverHtml(wanjiku, community, { threadId: messages.projectPost.id, initialThread: threadPage(community, messages.projectPost.id, wanjiku) });
    expect($(".channel-view")?.dataset.thread).toBe("open");
    expect($$("[data-thread-rail] .channel-messages [data-message]")).toHaveLength(5);
    expect($("[data-thread-rail] [data-thread-parent] [data-message]")?.dataset.message).toBe(messages.projectPost.id);
  });

  it("offers a session clip only in cohort channels, and Ask Tembo only with tembo_channels on", () => {
    serverHtml(wanjiku, cohort);
    expect($$("[data-composer=channel] button").map((b) => b.textContent)).toEqual(
      expect.arrayContaining(["Share project", "Session clip", "Ask Tembo"]),
    );
    serverHtml(wanjiku, community);
    expect($$("[data-composer=channel] button").map((b) => b.textContent)).not.toContain("Session clip");
    const noTembo: Me = { ...wanjiku, flags: { ...wanjiku.flags, tembo_channels: false } };
    serverHtml(noTembo, cohort);
    expect(container.textContent).not.toMatch(/Ask Tembo|Tembo · Sees/);
  });

  it("offers no attach tools until the page can list the person's work, rather than claim there is none", () => {
    serverHtml(wanjiku, cohort, { shareables: null });
    const labels = $$("[data-composer=channel] button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(labels).not.toContain("Share project");
    expect(labels).not.toContain("Session clip");
    expect(labels).not.toContain("Attach work");
    expect(labels).toEqual(expect.arrayContaining(["Mention someone", "Ask Tembo", "Send message"]));
  });

  it("says why a person cannot post, instead of a composer", () => {
    const announcements = channelFor("c04-announcements", wanjiku)!;
    serverHtml(wanjiku, announcements);
    expect($("[data-composer]")).toBeNull();
    expect(text("[data-posting]")).toBe("Only the TTV team posts here. You can read everything they share.");
  });

  it("introduces an empty channel with its name and topic", () => {
    serverHtml(wanjiku, channels.designCrit);
    expect(text("[data-channel-empty]")).toContain("This is the start of #design-crit");
    expect(text("[data-channel-empty]")).toContain(channels.designCrit.topic);
  });

  it("shows the author their hidden message and why; others never get it", () => {
    serverHtml(meByPersona.dennis, community);
    expect(text(`[data-message="${messages.hidden.id}"] [data-moderation]`)).toBe(
      "Hidden by a moderator: Harsh, not about the work. Only you can see this message now.",
    );
    serverHtml(wanjiku, community);
    expect($(`[data-message="${messages.hidden.id}"]`)).toBeNull();
  });

  it("tells the author a flagged message stays up, and tells nobody else", () => {
    const opportunities = channelFor("opportunities", meByPersona.peter)!;
    serverHtml(meByPersona.peter, opportunities);
    expect(text(`[data-message="${messages.flagged.id}"] [data-moderation]`)).toContain("stays up until a person looks at it");
    serverHtml(wanjiku, opportunities);
    expect($(`[data-message="${messages.flagged.id}"]`)).not.toBeNull();
    expect($(`[data-message="${messages.flagged.id}"] [data-moderation]`)).toBeNull();
  });
});

describe("live behaviour", () => {
  async function mount(me = wanjiku, channel: Channel = community, extra: Partial<Parameters<typeof ChannelSurface>[0]> = {}) {
    const fake = server(me, channel);
    const { store, actions } = setup(me, channel, fake.api, fake.root);
    await render(
      <ChannelSurface me={me} channel={channel} store={store} actions={actions} now={FIXTURE_NOW} shareables={shareablesFor(me)} {...extra} />,
    );
    return { ...fake, store, actions };
  }

  it("announces messages that arrive from others, politely, once per poll", async () => {
    const { queue } = await mount();
    const arrival = (n: number): Message => ({ ...messages.firstPr, id: `arrival-${n}`, clientNonce: `a-${n}`, createdAt: FIXTURE_NOW + n, reactions: [] });
    queue.push(arrival(1), arrival(2));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await tick(10);
    });
    const announcer = $("[data-channel-announcer]")!;
    expect(announcer.getAttribute("aria-live")).toBe("polite");
    expect(announcer.textContent).toBe("2 new messages");
    // The list itself is never a live region, so opening a channel reads nothing aloud.
    expect($("[data-channel-scroller]")?.getAttribute("aria-live")).toBeNull();
    expect($$("[data-arrived]")).toHaveLength(2);
  });

  it("does not announce the viewer's own messages", async () => {
    const { queue } = await mount();
    queue.push({ ...messages.firstPr, id: "own-1", clientNonce: "own-1", author: wanjiku.user, createdAt: FIXTURE_NOW + 5 });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await tick(10);
    });
    expect(text("[data-channel-announcer]")).toBe("");
  });

  it("opens a thread beside the list, moves focus to it, and Escape returns focus to the link", async () => {
    await mount();
    const link = $<HTMLAnchorElement>(`[data-thread-trigger="${messages.projectPost.id}"]`)!;
    await click(link);
    await act(frame);
    expect(window.location.search).toBe(`?thread=${messages.projectPost.id}`);
    expect($("[data-thread-rail]")).not.toBeNull();
    expect(document.activeElement?.id).toBe("channel-thread-title");
    expect($(`[data-message-row="${messages.projectPost.id}"] .channel-row`)?.dataset.highlight).toBe("true");
    await key($("[data-thread-rail]")!, "Escape");
    await act(frame);
    expect($("[data-thread-rail]")).toBeNull();
    expect(document.activeElement).toBe(link);
  });

  it("sends with Enter on a keyboard, and adds a line instead on a touch screen", async () => {
    await mount();
    const box = $<HTMLTextAreaElement>("[data-composer=channel] textarea")!;
    await typeInto(box, "Hello from the harness");
    await key(box, "Enter");
    expect($$("[data-message]").at(-1)?.textContent).toContain("Hello from the harness");
    expect(box.value).toBe("");

    await act(async () => root.unmount());
    root = createRoot(container);
    mediaQueries({ "(pointer: coarse)": true });
    await mount();
    const touchBox = $<HTMLTextAreaElement>("[data-composer=channel] textarea")!;
    await typeInto(touchBox, "Two lines");
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => {
      touchBox.dispatchEvent(enter);
    });
    expect(enter.defaultPrevented).toBe(false);
    expect(touchBox.value).toBe("Two lines");
    expect(touchBox.getAttribute("enterkeyhint")).toBe("enter");
  });

  it("never sends with Shift+Enter, an empty box, or mid-composition", async () => {
    const { store } = await mount();
    const before = store.getState().messages.length;
    const box = $<HTMLTextAreaElement>("[data-composer=channel] textarea")!;
    await typeInto(box, "   ");
    await key(box, "Enter");
    await typeInto(box, "draft");
    await key(box, "Enter", { shiftKey: true });
    await key(box, "Enter", { isComposing: true } as KeyboardEventInit);
    expect(store.getState().messages.length).toBe(before);
    expect($("[data-composer=channel] [type=submit]")?.getAttribute("aria-disabled")).toBeNull();
  });

  it("suggests @tembo and people, inserts the chosen one, and Escape closes the list", async () => {
    await mount();
    const box = $<HTMLTextAreaElement>("[data-composer=channel] textarea")!;
    await typeInto(box, "Thanks @");
    const options = $$("[role=option]");
    expect(options[0].dataset.mentionOption).toBe("tembo");
    expect(text(".channel-mentions__scope")).toBe(
      "Tembo sees: this channel and public projects. Never cohort recordings or private conversations. You: 6 of 10 today.",
    );
    expect(box.getAttribute("aria-activedescendant")).toBe(options[0].id);
    await key(box, "ArrowDown");
    expect(box.getAttribute("aria-activedescendant")).toBe(options[1].id);
    expect(options[1].querySelector(".font-semibold")?.textContent).toBe("@Achieng Otieno");
    await key(box, "Enter");
    expect(box.value).toBe("Thanks @Achieng Otieno ");
    expect($("[role=listbox]")).toBeNull();

    await typeInto(box, `${box.value}@m`);
    expect($("[role=listbox]")).not.toBeNull();
    await key(box, "Escape");
    expect($("[role=listbox]")).toBeNull();
  });

  it("offers no @tembo while tembo_channels is off", async () => {
    await mount({ ...wanjiku, flags: { ...wanjiku.flags, tembo_channels: false } });
    const box = $<HTMLTextAreaElement>("[data-composer=channel] textarea")!;
    await typeInto(box, "@");
    expect($$("[data-mention-option=tembo]")).toHaveLength(0);
    expect($$("[data-mention-option=person]").length).toBeGreaterThan(0);
  });

  it("Ask Tembo addresses the message to Tembo once", async () => {
    await mount();
    const box = $<HTMLTextAreaElement>("[data-composer=channel] textarea")!;
    await typeInto(box, "what changed?");
    const ask = $$("[data-composer=channel] button").find((b) => b.textContent === "Ask Tembo")!;
    await click(ask);
    await click(ask);
    expect(box.value).toBe("@tembo what changed?");
  });

  it("toggles the viewer's reaction through the actions, as membership, not a flip", async () => {
    const { actions } = await mount();
    const react = vi.spyOn(actions, "react");
    await click($(`[data-message="${messages.projectPost.id}"] [data-reaction='useful']`));
    expect(react).toHaveBeenCalledWith(messages.projectPost.id, "useful", false);
    expect(text(`[data-message="${messages.projectPost.id}"] [data-reaction='useful']`)).toContain("· 5");
  });
});

describe("refused sends", () => {
  it("keeps the words and points to the habits when the code of conduct is not agreed", async () => {
    const fake = server(wanjiku, community);
    const { store, actions } = setup(wanjiku, community, fake.api, fake.root);
    vi.spyOn(actions, "send").mockRejectedValue(new ApiError("conduct_required", 403, "Agree first"));
    await render(<ChannelSurface me={wanjiku} channel={community} store={store} actions={actions} now={FIXTURE_NOW} shareables={null} />);
    const box = $<HTMLTextAreaElement>("[data-composer=channel] textarea")!;
    await typeInto(box, "Hello everyone");
    await key(box, "Enter");
    expect(text("[role=alert]")).toContain("Agree to how we talk to each other, then send again.");
    expect($<HTMLAnchorElement>("[role=alert] a")?.getAttribute("href")).toBe("/dashboard/community/conduct");
    expect(box.value).toBe("Hello everyone");
  });

  it("says plainly when someone is sending too fast, without a conduct link", async () => {
    const fake = server(wanjiku, community);
    const { store, actions } = setup(wanjiku, community, fake.api, fake.root);
    vi.spyOn(actions, "send").mockRejectedValue(new ApiError("rate_limited", 429, "Slow down", 4000));
    await render(<ChannelSurface me={wanjiku} channel={community} store={store} actions={actions} now={FIXTURE_NOW} shareables={null} />);
    const box = $<HTMLTextAreaElement>("[data-composer=channel] textarea")!;
    await typeInto(box, "Again");
    await key(box, "Enter");
    expect(text("[role=alert]")).toBe("You're sending quickly. Wait a moment, then send again.");
    expect($("[role=alert] a")).toBeNull();
  });
});

describe("fixture actions", () => {
  it("count a reply on its parent and redact a deleted message", async () => {
    const { api, root: page } = server(wanjiku, community);
    const { store, actions } = setup(wanjiku, community, api, page);
    const release = store.retain();
    await store.openThread(messages.projectPost.id);
    await (actions as ChannelActions).send({ body: "Nice", parentId: messages.projectPost.id, embeds: [] });
    expect(store.getState().messages.find((m) => m.id === messages.projectPost.id)?.thread.replyCount).toBe(6);
    const sent = await actions.send({ body: "Mine", parentId: null, embeds: [] });
    const removed = await actions.remove(sent.id);
    expect(removed).toMatchObject({ deleted: true, body: "", embeds: [], reactions: [] });
    release();
  });

  it("refuse work the person has not got to share", async () => {
    const { api, root: page } = server(wanjiku, community);
    const { actions } = setup(wanjiku, community, api, page);
    await expect(actions.send({ body: "x", parentId: null, embeds: [{ type: "project", journeyId: "nope", version: 1 }] })).rejects.toThrow("That work is not available to share.");
  });
});
