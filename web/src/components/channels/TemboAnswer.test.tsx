// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel, Me, MessageList, TemboFeedbackKind } from "@/lib/platform/contracts";
import { createChannelStore } from "@/lib/platform/client/channel";
import { createComposer } from "@/lib/platform/client/composer";
import type { MockOptions } from "@/lib/platform/client/mockTransport";
import { createTemboStore } from "@/lib/platform/client/tembo";
import { channels, FIXTURE_NOW, meByPersona, messages } from "@/lib/platform/fixtures";
import ChannelSurface from "./ChannelSurface";
import { channelPage, threadPage } from "./harness/fixture-pages";
import { createHarnessClient } from "./harness/harness-client";

const wanjiku = meByPersona.wanjiku;
const community = channels.showYourWork;
const now = () => FIXTURE_NOW + 60_000;
const memory = () => {
  const items = new Map<string, string>();
  return {
    getItem: (name: string) => items.get(name) ?? null, setItem: (name: string, value: string) => void items.set(name, value),
    removeItem: (name: string) => void items.delete(name), key: (i: number) => [...items.keys()][i] ?? null, get length() { return items.size; },
  };
};

function setup(me: Me, channel: Channel = community, failure?: MockOptions["failure"], timeoutMs?: number, page?: (page: MessageList) => MessageList) {
  const initial = page ? page(channelPage(channel, me)) : channelPage(channel, me);
  const client = createHarnessClient({ me, channel, root: initial, now, failure });
  const store = createChannelStore({ channelId: channel.id, enabled: me.flags.channels, viewerId: me.user.id, initial, api: client.api });
  const tembo = createTemboStore({ channel: store, usage: me.temboUsage, enabled: me.flags.tembo_channels, api: client.api, now, timeoutMs });
  const composer = createComposer({ store, me, api: client.api, now, storage: memory(), onSent: tembo.noticeSent });
  return { client, store, tembo, composer };
}

let root: Root;
let container: HTMLDivElement;
const tick = (ms = 0) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});
const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const $$ = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const settle = () => act(() => tick(10));

async function mount(me: Me = wanjiku, options: {
  threadId?: string; failure?: MockOptions["failure"]; timeoutMs?: number; thread?: (page: MessageList) => MessageList;
  page?: (page: MessageList) => MessageList;
} = {}) {
  const wired = setup(me, community, options.failure, options.timeoutMs, options.page);
  const page = options.threadId ? threadPage(community, options.threadId, me) : null;
  const initialThread = page && options.thread ? options.thread(page) : page;
  await act(async () => root.render(
    <ChannelSurface
      me={me} channel={community} store={wired.store} composer={wired.composer} tembo={wired.tembo} now={FIXTURE_NOW}
      shareables={null} threadId={options.threadId ?? null} initialThread={initialThread}
    />,
  ));
  await settle();
  return wired;
}

async function send(words: string) {
  const box = $<HTMLTextAreaElement>("[data-composer=channel] textarea")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(box, words);
    box.setSelectionRange(words.length, words.length);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  await settle();
}

/** Deliver what the harness queued through the feed's next poll. */
async function poll() {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    await tick(10);
  });
  await settle();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.history.replaceState(null, "", "/dashboard/community/c/show-your-work");
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("a Tembo answer (U-3.1)", () => {
  const answer = () => $(`[data-message="${messages.communityAnswer.id}"]`)!;

  it("is marked as AI, cites its sources, and says what it saw; rating waits for the island", () => {
    const { store, tembo, composer } = setup(wanjiku);
    container.innerHTML = renderToString(
      <ChannelSurface me={wanjiku} channel={community} store={store} composer={composer} tembo={tembo} now={FIXTURE_NOW}
        shareables={null} threadId={messages.communityAsk.parentId} initialThread={threadPage(community, messages.communityAsk.parentId!, wanjiku)} />,
    );
    // One AI badge, the server's own role badge on Tembo (not a second one from the view).
    const meta = answer().querySelector(".channel-meta")!;
    expect(meta.textContent).toMatch(/^TemboAI\d/);
    expect([...meta.querySelectorAll("*")].filter((node) => node.children.length === 0 && node.textContent === "AI")).toHaveLength(1);
    // Numbered as the answer's [n] markers are (QA3-02).
    expect([...answer().querySelectorAll("[aria-label=Sources] a")].map((a) => a.textContent))
      .toEqual(["1Source 1: Chama ledger · rev 3", "2Source 2: This thread"]);
    // No live count under an answer: it read as a fact about that answer (QA3-07).
    expect(answer().querySelector(".channel-tembo__foot")?.textContent)
      .toBe("Sees: this channel, projects shared in it and public builder profiles");
    expect(answer().querySelector("[data-tembo-feedback]")).toBeNull();
  });

  it("takes Helpful / Not quite at once, as a pressed choice, and puts it back if saving fails", async () => {
    let refuse = false;
    const { client } = await mount(wanjiku, {
      threadId: messages.communityAsk.parentId!,
      failure: (request) => refuse && request.url.endsWith("/tembo-feedback")
        ? { status: 500, data: { error: { code: "internal", message: "Nope" } } } : undefined,
    });
    const choice = (kind: string) => answer().querySelector<HTMLButtonElement>(`[data-tembo-feedback=${kind}]`)!;
    expect(answer().querySelector("fieldset legend")?.textContent).toBe("Did this answer help?");
    await act(async () => choice("helpful").click());
    expect(choice("helpful").getAttribute("aria-pressed")).toBe("true");
    // The kit's pill: pressed is ink, never a second peach in the view.
    expect(choice("helpful").hasAttribute("data-pill")).toBe(true);
    expect(choice("helpful").className).toContain("bg-ink-primary text-dark");
    expect(choice("helpful").className).not.toMatch(/\b(?:text-peach-ink|bg-primary)\b/);
    expect(choice("not_quite").className).not.toContain("bg-ink-primary text-dark");
    await settle();
    expect(client.tembo().feedback).toEqual([{ messageId: messages.communityAnswer.id, feedback: "helpful" }]);

    refuse = true;
    // Shown at once, then put back when the server refuses (the store's tests hold the in-between).
    await act(async () => choice("not_quite").click());
    await settle();
    expect(choice("not_quite").getAttribute("aria-pressed")).toBe("false");
    expect(choice("helpful").getAttribute("aria-pressed")).toBe("true");
    expect($("[data-channel-announcer]")?.textContent).toBe("Couldn't save that. Try again.");
  });

  it.each<TemboFeedbackKind>(["helpful", "not_quite"])("starts from the choice the reader saved before (%s), and changes from there", async (saved) => {
    const threadId = messages.communityAsk.parentId!;
    const seeded = (page: MessageList) => ({
      ...page, items: page.items.map((item) => item.id === messages.communityAnswer.id ? { ...item, temboFeedback: saved } : item),
    });
    const { client } = await mount(wanjiku, {
      threadId, thread: seeded,
      // The thread as the server reads it again, with the reader's saved choice on the answer.
      failure: (request) => {
        const query = new URL(request.url).searchParams;
        return request.method === "GET" && query.get("thread") === threadId && !query.has("since") && !query.has("before")
          ? { status: 200, data: seeded(threadPage(community, threadId, wanjiku)) } : undefined;
      },
    });
    const pressed = () => answer().querySelector("[aria-pressed=true]")?.getAttribute("data-tembo-feedback");
    expect(pressed()).toBe(saved);
    const other = saved === "helpful" ? "not_quite" : "helpful";
    await act(async () => answer().querySelector<HTMLButtonElement>(`[data-tembo-feedback=${other}]`)!.click());
    await settle();
    expect(pressed()).toBe(other);
    expect(client.tembo().feedback).toEqual([{ messageId: messages.communityAnswer.id, feedback: other }]);
  });

  it("offers no rating while tembo_channels is off", async () => {
    await mount({ ...wanjiku, flags: { ...wanjiku.flags, tembo_channels: false } }, { threadId: messages.communityAsk.parentId! });
    expect(answer()).not.toBeNull();
    expect(answer().querySelector("[data-tembo-feedback]")).toBeNull();
    expect(answer().querySelector(".channel-tembo__foot")?.textContent).not.toContain("You:");
  });
});

describe("asking Tembo from the channel (S-3.1 + U-3.1)", () => {
  it("asks → shows it pending → the answer arrives by polling → the count moves", async () => {
    const { client } = await mount();
    await send("@tembo what changed in revision 3?");
    expect(client.tembo().asked).toHaveLength(1);
    const line = $("[data-tembo-question]")!;
    expect(line.dataset.temboQuestion).toBe("pending");
    expect(line.textContent).toBe("Tembo is answering in the thread.");
    expect($("[data-channel-announcer]")?.textContent).toBe("Tembo is looking into it");
    expect($(".channel-composer__scope")?.textContent).toContain("You: 7 of 10 in channels today");
    // A narrow composer says it shorter, but still says what Tembo sees (QA4-08).
    expect($(".channel-composer__scope-narrow")?.textContent).toBe("Tembo sees this channel, projects shared in it and public builder profiles · 7 of 10 in channels today");

    expect(client.answerTembo()).toBe(1);
    await poll();
    expect($("[data-tembo-question]")).toBeNull();
    expect($("[data-channel-announcer]")?.textContent).toBe("Tembo answered in the thread");
    // The thread link now counts the answer.
    expect($(`[data-thread-trigger="${client.tembo().asked[0]}"]`)?.textContent).toContain("1 reply");
  });

  it("shows the question waiting in its thread, then the answer there", async () => {
    const { client } = await mount(wanjiku, { threadId: messages.communityAsk.parentId! });
    const box = $<HTMLTextAreaElement>("[data-composer=thread] textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(box, "@tembo and revision 4?");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    await settle();
    const waiting = $("[data-thread-rail] [data-tembo-question=pending]")!;
    expect(waiting.textContent).toContain("Looking through this channel, projects shared in it and public builder profiles. The answer will appear here.");
    expect(waiting.querySelector(".channel-meta")?.textContent).toBe("TemboAI");
    // The kit's role badge, as on Tembo's own messages.
    expect(waiting.querySelector("[data-role-badge=AI]")?.textContent).toBe("AI");

    client.answerTembo();
    await poll();
    expect($("[data-thread-rail] [data-tembo-question]")).toBeNull();
    const answers = $$("[data-thread-rail] [data-message]").filter((m) => m.querySelector(".channel-tembo"));
    expect(answers.at(-1)?.textContent).toContain("Revision 3 logs each callback");
  });

  it("says when today's questions are used up, and when they come back", async () => {
    const { client } = await mount({ ...wanjiku, temboUsage: { ...wanjiku.temboUsage, used: 10 } });
    expect($(".channel-composer__scope")?.textContent).toContain("You: 10 of 10 in channels today · No questions left in channels today; more after midnight East Africa Time");
    expect($(".channel-composer__scope-narrow")?.textContent).toBe("Tembo sees this channel, projects shared in it and public builder profiles · No questions left in channels today");
    await send("@tembo one more?");
    expect(client.tembo().asked).toEqual([]);
    const line = $("[data-tembo-question=exhausted]")!;
    // True for both places Tembo answers: only questions in channels count (QA3-04).
    expect(line.textContent).toMatch(/^You've used all 10 of today's questions to Tembo in channels, so this one wasn't asked\. You can ask again after midnight East Africa Time, in (about \d+ hours?|\d+ minutes?)\. Questions on your private Ask Tembo page don't count toward this\.$/);
    expect(line.querySelector("button")).toBeNull();
  });

  it("still says a question wasn't asked after a reload, from /me's usage and the server's word that nothing was asked (QA3-05)", async () => {
    const mine = { ...messages.firstPr, author: { ...messages.firstPr.author, id: wanjiku.user.id, name: wanjiku.user.name } };
    const refused = { ...mine, id: "synthetic-refused-question", body: "@tembo who reviews pull requests?", createdAt: FIXTURE_NOW, temboAsked: false };
    const asked = { ...mine, id: "synthetic-asked-question", body: "@tembo and the docs?", createdAt: FIXTURE_NOW + 1, temboAsked: true };
    const yesterday = { ...refused, id: "synthetic-yesterday-question", createdAt: Date.UTC(2026, 10, 1, 20) };
    const { client } = await mount({ ...wanjiku, temboUsage: { ...wanjiku.temboUsage, used: 10 } }, {
      page: (page) => ({ ...page, items: [...page.items, yesterday, refused, asked] }),
    });
    const notes = $$("[data-tembo-question=exhausted]");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.closest("li")?.querySelector(`[data-message="${refused.id}"]`)).not.toBeNull();
    // What is known, not why: the server keeps no reason for an unasked mention (#310 S1).
    expect(notes[0]!.textContent).toMatch(/^Tembo didn't take this question, and you've used all 10 of today's questions to Tembo in channels\. You can ask again after midnight East Africa Time/);
    // Nothing was asked to show it, and "Ask Tembo here" is gone: it would only post a question nobody answers.
    expect(client.tembo().asked).toEqual([]);
    expect($$("[data-ask-tembo]")).toHaveLength(0);
  });

  it("says so in a thread as a note, not as a reply from Tembo (QA3-13)", async () => {
    await mount({ ...wanjiku, temboUsage: { ...wanjiku.temboUsage, used: 10 } }, { threadId: messages.communityAsk.parentId! });
    const box = $<HTMLTextAreaElement>("[data-composer=thread] textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(box, "@tembo and revision 4?");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    await settle();
    const note = $("[data-thread-rail] [data-tembo-question=exhausted]")!;
    expect(note.textContent).toContain("so this one wasn't asked");
    expect(note.querySelector(".channel-meta")).toBeNull();
    expect(note.classList.contains("channel-tembo-wait--channel")).toBe(true);
  });

  it("offers Try again after a failure", async () => {
    let fail = true;
    const { client } = await mount(wanjiku, {
      failure: (request) => fail && request.url.endsWith("/tembo") ? { status: 503, data: { error: { code: "unavailable", message: "Busy" } } } : undefined,
    });
    await send("@tembo are you there?");
    const line = $("[data-tembo-question=error]")!;
    expect(line.textContent).toContain("Tembo couldn't take that question just now.");
    fail = false;
    await act(async () => line.querySelector("button")!.click());
    await settle();
    expect($("[data-tembo-question]")?.dataset.temboQuestion).toBe("pending");
    expect(client.tembo().asked).toHaveLength(1);
  });

  it.each([
    ["Tembo is off in channels", { status: 404, data: { error: { code: "flag_off", message: "Off" } } }, "Tembo isn't available in channels just now."],
    ["someone else's message, or a read-only channel", { status: 403, data: { error: { code: "forbidden", message: "No" } } },
      "Tembo answers your own messages, in channels you can post in."],
    ["a message gone from view", { status: 404, data: { error: { code: "not_found", message: "Gone" } } },
      "Tembo can't answer this message: it was deleted or hidden, or the thread is closed."],
    ["a closed thread", { status: 409, data: { error: { code: "conflict", message: "Closed" } } },
      "Tembo can't answer this message: it was deleted or hidden, or the thread is closed."],
  ] as const)("refuses %s for good: it says why and offers no Try again", async (_, refusal, copy) => {
    await mount(wanjiku, { failure: (request) => request.url.endsWith("/tembo") ? refusal : undefined });
    await send("@tembo are you there?");
    const line = $("[data-tembo-question=error]")!;
    expect(line.textContent).toContain(copy);
    expect(line.textContent).not.toContain("Try again");
    expect(line.querySelector("button")).toBeNull();
  });

  it("says when Tembo hasn't answered yet, and Check again asks once more", async () => {
    // Long enough that asking again is still waiting when it is checked, however busy the machine.
    const { client } = await mount(wanjiku, { timeoutMs: 500 });
    await send("@tembo are you there?");
    for (let turn = 0; turn < 300 && !$("[data-tembo-question=timeout]"); turn += 1) await act(() => tick(10));
    const line = $("[data-tembo-question=timeout]")!;
    expect(line.textContent).toContain("Tembo hasn't answered yet.");
    const check = line.querySelector("button")!;
    expect(check.textContent).toBe("Check again");
    await act(async () => check.click());
    await settle();
    // Asked once more: the same question, waiting again.
    expect($("[data-tembo-question]")?.dataset.temboQuestion).toBe("pending");
    expect(client.tembo().asked).toHaveLength(1);
  });

  it("asks nothing for a message without @tembo, or while tembo_channels is off", async () => {
    const { client } = await mount();
    await send("Thanks for the review");
    expect(client.tembo().asked).toEqual([]);
    expect($("[data-tembo-question]")).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    const off = await mount({ ...wanjiku, flags: { ...wanjiku.flags, tembo_channels: false } });
    await send("@tembo hello");
    expect(off.client.tembo().asked).toEqual([]);
  });
});
