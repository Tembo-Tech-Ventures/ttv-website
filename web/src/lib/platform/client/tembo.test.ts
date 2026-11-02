import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message, MessageList, TemboResponse, TemboUsage } from "../contracts";
import { channels, FIXTURE_NOW, messages, people } from "../fixtures";
import { createApiClient } from "./apiClient";
import { createChannelStore } from "./channel";
import { createComposer } from "./composer";
import { createMockTransport, type MockReply } from "./mockTransport";
import { createTemboStore, TEMBO_TIMEOUT_MS } from "./tembo";

const channelId = channels.cohort04.id;
const resetsAt = FIXTURE_NOW + 3 * 60 * 60 * 1000;
const usage = (used: number): TemboUsage => ({ used, limit: 10, resetsAt });
const asking: Message = { ...messages.cohortAsk, id: "ask-1", thread: { replyCount: 0, participantIds: [], lastReplyAt: null } };
const answer: Message = { ...messages.cohortAnswer, id: "answer-1", parentId: asking.id, createdAt: asking.createdAt + 5_000 };
const page = (items: Message[], thread: string | null = null): MessageList => ({
  items, beforeCursor: null, sinceCursor: `s-${thread ?? "root"}-${items.length}`, thread, removedIds: [],
});

type Handlers = {
  ask?: (body: { messageId: string }) => MockReply;
  feedback?: (id: string, body: { feedback: string }) => MockReply | Promise<MockReply>;
  list?: (query: URLSearchParams) => MockReply;
};

function setup(handlers: Handlers = {}, options: { used?: number; enabled?: boolean; timeoutMs?: number } = {}) {
  const calls: string[] = [];
  const api = createApiClient({ retry: { maxRetries: 0 }, fetch: createMockTransport([
    { method: "GET", path: "/api/channels/:id/messages", reply: ({ request }) => {
      const query = new URL(request.url).searchParams;
      return handlers.list?.(query) ?? { data: page([], query.get("thread")) };
    } },
    { method: "POST", path: "/api/channels/:id/messages", reply: async ({ request }) => {
      const body = await request.json() as { body: string; clientNonce: string; parentId: string | null };
      return { status: 201, data: { ...asking, body: body.body, clientNonce: body.clientNonce, parentId: body.parentId } };
    } },
    { method: "POST", path: "/api/channels/:id/tembo", reply: async ({ request }) => {
      const body = await request.json() as { messageId: string };
      calls.push(`ask ${body.messageId}`);
      return handlers.ask?.(body) ?? { status: 202, data: { status: "pending", messageId: body.messageId, usage: usage(7) } satisfies TemboResponse };
    } },
    { method: "POST", path: "/api/messages/:id/tembo-feedback", reply: async ({ request, params }) => {
      const body = await request.json() as { feedback: string };
      calls.push(`feedback ${params.id} ${body.feedback}`);
      return handlers.feedback?.(params.id, body) ?? { data: { ok: true } };
    } },
  ]) });
  const channel = createChannelStore({ channelId, enabled: true, api, initial: page([asking]) });
  const tembo = createTemboStore({
    channel, api, usage: usage(options.used ?? 6), enabled: options.enabled ?? true, now: () => FIXTURE_NOW, timeoutMs: options.timeoutMs,
  });
  const release = tembo.retain();
  return { api, calls, channel, tembo, release };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("asking Tembo (S-3.1)", () => {
  it("starts with /me's allowance, and nothing while tembo_channels is off", async () => {
    expect(setup().tembo.getState().usage).toEqual(usage(6));
    const off = setup({}, { enabled: false });
    expect(off.tembo.getState().usage).toBeNull();
    await expect(off.tembo.ask(asking)).rejects.toMatchObject({ code: "flag_off" });
    off.tembo.noticeSent({ ...asking, body: "@tembo hi" });
    expect(off.calls).toEqual([]);
  });

  it("goes pending, takes the server's count, and resolves when the answer shows in the open thread", async () => {
    let replies: Message[] = [];
    const { tembo, channel, calls } = setup({ list: (query) => ({ data: page(query.get("thread") ? replies : [], query.get("thread")) }) });
    const question = await tembo.ask(asking);
    expect(question).toMatchObject({ status: "pending", threadId: asking.id, answerId: null });
    expect(tembo.getState()).toMatchObject({ usage: usage(7), announcement: "Tembo is looking into it" });
    // Asking again while it is open joins it.
    await tembo.ask(asking);
    expect(calls).toEqual(["ask ask-1"]);

    await channel.openThread(asking.id);
    expect(tembo.getState().questions[asking.id].status).toBe("pending");
    replies = [answer];
    channel.closeThread();
    await channel.openThread(asking.id);
    expect(tembo.getState().questions[asking.id]).toMatchObject({ status: "answered", answerId: answer.id });
    expect(tembo.getState().announcement).toBe("Tembo answered in the thread");
    expect(tembo.questionsIn(asking.id).map((q) => q.messageId)).toEqual([asking.id]);
  });

  it("checks again when the closed thread's reply count moves, and takes the answer from the server", async () => {
    let answered = false;
    const { tembo, channel, calls } = setup({
      ask: ({ messageId }) => answered
        ? { data: { status: "answer", message: answer, usage: usage(7) } satisfies TemboResponse }
        : { status: 202, data: { status: "pending", messageId, usage: usage(7) } },
    });
    await tembo.ask(asking);
    answered = true;
    channel.receive([{ ...asking, thread: { replyCount: 1, participantIds: [], lastReplyAt: answer.createdAt } }]);
    await vi.waitFor(() => expect(tembo.getState().questions[asking.id].status).toBe("answered"));
    expect(calls).toEqual(["ask ask-1", "ask ask-1"]);
    expect(tembo.getState().questions[asking.id].answerId).toBe(answer.id);
  });

  it("an answer straight from the server joins the channel store", async () => {
    const { tembo, channel } = setup({ ask: () => ({ data: { status: "answer", message: answer, usage: usage(7) } }) });
    await channel.openThread(asking.id);
    await tembo.ask(asking);
    expect(tembo.getState().questions[asking.id]).toMatchObject({ status: "answered", answerId: answer.id });
    expect(channel.getState().thread?.messages.map((m) => m.id)).toEqual([answer.id]);
  });

  it("times out without an answer, and checking again goes back to pending", async () => {
    vi.useFakeTimers();
    const { tembo, calls } = setup({}, { timeoutMs: 1_000 });
    await tembo.ask(asking);
    await vi.advanceTimersByTimeAsync(999);
    expect(tembo.getState().questions[asking.id].status).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(tembo.getState().questions[asking.id].status).toBe("timeout");
    expect(tembo.getState().announcement).toBe("Tembo hasn't answered yet");
    await tembo.retry(asking.id);
    expect(tembo.getState().questions[asking.id].status).toBe("pending");
    expect(calls).toEqual(["ask ask-1", "ask ask-1"]);
    expect(TEMBO_TIMEOUT_MS).toBeGreaterThan(55_000);
  });

  it("keeps the error, and trying again can succeed", async () => {
    let refuse = true;
    const { tembo } = setup({
      ask: ({ messageId }) => refuse
        ? { status: 409, data: { error: { code: "conflict", message: "That message was hidden." } } }
        : { status: 202, data: { status: "pending", messageId, usage: usage(7) } },
    });
    const failed = await tembo.ask(asking);
    expect(failed).toMatchObject({ status: "error", error: { status: 409, code: "conflict" } });
    expect(tembo.getState().announcement).toBe("Tembo couldn't take that question");
    expect(tembo.getState().usage).toEqual(usage(6));
    refuse = false;
    expect(await tembo.retry(asking.id)).toMatchObject({ status: "pending", error: null });
  });

  it("an exhausted allowance says when it resets and shows every question used", async () => {
    const { tembo } = setup({
      ask: () => ({ status: 429, data: { error: { code: "quota_exhausted", message: "No questions left today.", retryAfterMs: 3_600_000 } } }),
    }, { used: 9 });
    const question = await tembo.ask(asking);
    expect(question).toMatchObject({ status: "exhausted", error: { status: 429 } });
    expect(tembo.getState().usage).toEqual({ used: 10, limit: 10, resetsAt: FIXTURE_NOW + 3_600_000 });
    expect(tembo.getState().announcement).toBe("You've used today's questions to Tembo");
  });

  it("asks about a sent message that mentions @tembo, and only that", async () => {
    const { api, channel, calls, tembo } = setup();
    const composer = createComposer({ store: channel, api, me: { user: { id: people.wanjiku.id }, flags: { tembo_channels: true } }, onSent: tembo.noticeSent });
    await composer.send({ body: "Thanks all", parentId: null, embeds: [] });
    await composer.send({ body: "mail me at x@tembo.org", parentId: null, embeds: [] });
    expect(calls).toEqual([]);
    await composer.send({ body: "@tembo what changed?", parentId: null, embeds: [] });
    await vi.waitFor(() => expect(calls).toEqual(["ask ask-1"]));
  });

  it("stops asking once released, and carries on when mounted again", async () => {
    const { tembo, release } = setup({}, { timeoutMs: 50 });
    await tembo.ask(asking);
    release();
    await expect(tembo.ask({ ...asking, id: "ask-2" })).rejects.toMatchObject({ code: "flag_off" });
    const again = tembo.retain();
    await vi.waitFor(() => expect(tembo.getState().questions[asking.id].status).toBe("timeout"));
    again();
  });
});

describe("Tembo feedback", () => {
  it("shows the choice at once and keeps it when the server agrees", async () => {
    const { tembo, calls } = setup();
    const saving = tembo.sendFeedback(answer.id, "helpful");
    expect(tembo.getState()).toMatchObject({ feedback: { [answer.id]: "helpful" }, saving: [answer.id] });
    await saving;
    expect(tembo.getState()).toMatchObject({ feedback: { [answer.id]: "helpful" }, saving: [], announcement: "Thanks: marked helpful" });
    await tembo.sendFeedback(answer.id, "helpful");
    expect(calls).toEqual([`feedback ${answer.id} helpful`]);
  });

  it("puts the earlier choice back when saving fails", async () => {
    let fail = false;
    const { tembo } = setup({ feedback: () => fail ? { status: 500, data: { error: { code: "internal", message: "Nope" } } } : { data: { ok: true } } });
    await tembo.sendFeedback(answer.id, "helpful");
    fail = true;
    await expect(tembo.sendFeedback(answer.id, "not_quite")).rejects.toMatchObject({ status: 500 });
    expect(tembo.getState()).toMatchObject({ feedback: { [answer.id]: "helpful" }, saving: [], announcement: "Couldn't save that. Try again." });
    await expect(tembo.sendFeedback("other", "not_quite")).rejects.toMatchObject({ status: 500 });
    expect(tembo.getState().feedback).toEqual({ [answer.id]: "helpful" });
  });

  it("a newer choice is not rolled back by an older one failing", async () => {
    let first = true;
    let release!: () => void;
    const { tembo } = setup({
      feedback: () => first
        ? (first = false, new Promise<MockReply>((resolve) => { release = () => resolve({ status: 500, data: { error: { code: "internal", message: "Nope" } } }); }))
        : { data: { ok: true } },
    });
    const older = tembo.sendFeedback(answer.id, "helpful");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await tembo.sendFeedback(answer.id, "not_quite");
    release();
    await expect(older).rejects.toMatchObject({ status: 500 });
    expect(tembo.getState().feedback).toEqual({ [answer.id]: "not_quite" });
  });
});
