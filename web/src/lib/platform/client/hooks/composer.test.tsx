// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message, MessageList } from "../../contracts";
import { messages, people } from "../../fixtures";
import { createApiClient } from "../apiClient";
import { createChannelStore, type ChannelStore } from "../channel";
import { channelDraftKey } from "../channel-drafts";
import { createComposer, DRAFT_SAVE_DELAY_MS, type Composer } from "../composer";
import { createMockTransport } from "../mockTransport";
import { useComposer, useDraft, useMentionCandidates, useMessageBusy, useOutbox } from "./composer";

const CHANNEL = "channel-1";
const VIEWER = people.wanjiku.id;
const msg = (n: number, overrides: Partial<Message> = {}): Message => ({
  ...messages.projectPost, id: `m${n}`, channelId: CHANNEL, parentId: null, createdAt: n * 1_000, clientNonce: null, reactions: [], ...overrides,
});
const page = (items: Message[]): MessageList => ({ items, beforeCursor: null, sinceCursor: "s0", thread: null, removedIds: [] });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

function setup(gate?: Promise<void>) {
  const fetch = createMockTransport([
    { method: "POST", path: "/api/channels/:id/messages", reply: async ({ request }) => {
      await gate;
      const body = await request.json() as { body: string; clientNonce: string };
      return { data: msg(99, { id: "posted", body: body.body, clientNonce: body.clientNonce, author: people.wanjiku }) };
    } },
    { method: "POST", path: "/api/messages/:id/reactions", reply: async () => {
      await gate;
      return { data: { messageId: "m1", reactions: [{ kind: "thanks", count: 1, mine: true }] } };
    } },
  ]);
  const api = createApiClient({ fetch, retry: { maxRetries: 0 } });
  const channel = createChannelStore({ channelId: CHANNEL, enabled: true, api, viewerId: VIEWER, initial: page([msg(1, { author: people.david })]) });
  const composer = createComposer({ store: channel, me: { user: people.wanjiku, flags: { tembo_channels: true } }, api });
  return { channel, composer };
}

let typed: ((body: string) => void) | undefined;
function View({ composer, threadId = null }: { composer: Composer; threadId?: string | null }) {
  const [draft, setDraft] = useDraft(composer, threadId);
  const all = useComposer(composer);
  typed = body => setDraft({ body });
  const outbox = useOutbox(composer, threadId);
  const busy = useMessageBusy(composer, "m1");
  const mentions = useMentionCandidates(composer, threadId);
  const announcement = useComposer(composer, state => state.announcement);
  return (
    <div>
      <textarea aria-label="Message" value={draft.body} onChange={event => setDraft({ body: event.target.value })} />
      <output data-testid="outbox">{outbox.map(item => `${item.status}:${item.body}`).join("|")}</output>
      <output data-testid="busy">{String(busy)}</output>
      <output data-testid="mentions">{[mentions.tembo ? "@tembo" : "", ...mentions.people.map(person => person.name)].join(",")}</output>
      <output data-testid="announcement">{announcement}</output>
      <output data-testid="drafts">{Object.keys(all.drafts).join(",")}</output>
    </div>
  );
}

describe("composer hooks", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  const text = (id: string) => container.querySelector(`[data-testid=${id}]`)?.textContent;
  const textarea = () => container.querySelector("textarea")!;

  it("server-renders the empty snapshot without touching storage", () => {
    sessionStorage.setItem(channelDraftKey(VIEWER, CHANNEL), JSON.stringify({ drafts: { root: { body: "Stored", embeds: [], updatedAt: 1 } }, sends: [] }));
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const { composer } = setup();
    const html = renderToString(<View composer={composer} />);
    expect(html).toContain("></textarea>");
    expect(getItem).not.toHaveBeenCalled();
    getItem.mockRestore();
  });

  it("loads the stored draft after mount and keeps typing in sessionStorage", async () => {
    sessionStorage.setItem(channelDraftKey(VIEWER, CHANNEL), JSON.stringify({ drafts: { root: { body: "Stored", embeds: [], updatedAt: 1 } }, sends: [] }));
    const { composer } = setup();
    await act(async () => root.render(<View composer={composer} />));
    expect(textarea().value).toBe("Stored");
    await act(async () => composer.setDraft(null, { body: "Stored and more" }));
    expect(textarea().value).toBe("Stored and more");
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 5); }); });
    expect(sessionStorage.getItem(channelDraftKey(VIEWER, CHANNEL))).toContain("Stored and more");
    expect(text("mentions")).toBe(`@tembo,${people.david.name}`);
  });

  it("shows a pending send, then the confirmed message, and a busy reaction", async () => {
    const gate = deferred();
    const { composer, channel } = setup(gate.promise);
    await act(async () => root.render(<View composer={composer} />));
    let sent!: Promise<Message>;
    let reacted!: Promise<void>;
    await act(async () => {
      sent = composer.send({ body: "Habari", parentId: null, embeds: [] });
      reacted = composer.react("m1", "thanks", true);
    });
    expect(text("outbox")).toBe("sending:Habari");
    expect(text("busy")).toBe("true");
    await act(async () => { gate.resolve(); await Promise.all([sent, reacted]); });
    expect(text("outbox")).toBe("");
    expect(text("busy")).toBe("false");
    expect(channel.getState().messages.map(item => item.id)).toEqual(["m1", "posted"]);
  });

  it("updates mention candidates as people post, and releases the online listener on unmount", async () => {
    const { composer, channel } = setup();
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    await act(async () => root.render(<View composer={composer} />));
    await act(async () => channel.receive([msg(2, { author: people.kevin })]));
    expect(text("mentions")).toBe(`@tembo,${people.kevin.name},${people.david.name}`);
    await act(async () => root.unmount());
    expect(removeEventListener).toHaveBeenCalledWith("online", expect.any(Function));
    root = createRoot(container);
  });

  it("keeps thread drafts apart from the channel draft", async () => {
    const { composer } = setup();
    await act(async () => root.render(<View composer={composer} threadId="m1" />));
    await act(async () => typed?.("In the thread"));
    expect(textarea().value).toBe("In the thread");
    expect(text("drafts")).toBe("thread:m1");
    expect(composer.draft(null).body).toBe("");
  });
});

it("uses the channel store the composer was given", () => {
  const { channel, composer }: { channel: ChannelStore; composer: Composer } = setup();
  expect(composer.channel).toBe(channel);
  expect(composer.channelId).toBe(CHANNEL);
});
