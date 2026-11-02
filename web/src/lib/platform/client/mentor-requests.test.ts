import { describe, expect, it, vi } from "vitest";
import type { MentorRequest, MentorRequestList } from "../contracts";
import { brianMentorRequest, mentors, pendingMentorRequest, people } from "../fixtures";
import { createApiClient } from "./apiClient";
import { canAct, createMentorRequestsStore, shownStatus } from "./mentor-requests";
import { createMentoringMock } from "./mentoring.mock";
import { createMockTransport, type MockReply } from "./mockTransport";

const page = (items: MentorRequest[], nextCursor: string | null = null): MentorRequestList => ({ items, nextCursor });
const failure = (status: number, code: string): MockReply => ({ status, data: { error: { code, message: "No." } } });
const joseph = { mentorId: people.joseph.id, mentorName: people.joseph.name };

/** A mentor's queue against a hand-written server, so each answer can be held or refused. */
function queue(reply: (action: string, body: unknown) => MockReply | Promise<MockReply>, read?: () => MockReply) {
  const calls: string[] = [];
  const api = createApiClient({ retry: { maxRetries: 0 }, fetch: createMockTransport([
    ...(["accept", "redirect", "decline", "withdraw"] as const).map(action => ({
      method: "POST" as const, path: `/api/mentor-requests/:id/${action}`,
      reply: async ({ request, params }: { request: Request; params: Record<string, string> }) => {
        const body = await request.json();
        calls.push(`${action} ${params.id} ${JSON.stringify(body)}`);
        return reply(action, body);
      },
    })),
    { method: "GET", path: "/api/mentor-requests/:id", reply: ({ params }) => { calls.push(`get ${params.id}`); return read?.() ?? failure(404, "not_found"); } },
    { method: "GET", path: "/api/mentor-requests", reply: ({ request }) => {
      calls.push(`list ${new URL(request.url).search}`);
      return { data: page([{ ...brianMentorRequest, id: "older" }, pendingMentorRequest], null) };
    } },
  ]) });
  const store = createMentorRequestsStore({ as: "mentor", initial: page([pendingMentorRequest, brianMentorRequest], "c1"), api });
  return { store, calls };
}

describe("who may do what", () => {
  it("lets the mentor answer and the person asking withdraw, only while pending", () => {
    expect(canAct("mentor", "accept", "PENDING")).toBe(true);
    expect(canAct("mentor", "withdraw", "PENDING")).toBe(false);
    expect(canAct("requester", "withdraw", "PENDING")).toBe(true);
    expect(canAct("requester", "decline", "PENDING")).toBe(false);
    expect(canAct("mentor", "accept", "WITHDRAWN")).toBe(false);
  });
});

describe("optimistic changes", () => {
  it("shows an acceptance at once, then the server's request with its conversation", async () => {
    let answer!: (reply: MockReply) => void;
    const accepted: MentorRequest = { ...pendingMentorRequest, status: "ACCEPTED", channelId: "dm-1" };
    const { store, calls } = queue(() => new Promise(resolve => { answer = resolve; }));
    const done = store.accept(pendingMentorRequest.id);
    expect(store.getState().pending[pendingMentorRequest.id]).toEqual({ action: "accept", status: "ACCEPTED" });
    expect(shownStatus(store.getState(), pendingMentorRequest)).toBe("ACCEPTED");
    // The server's request is untouched until it answers: no conversation id is invented.
    expect(store.getState().items[0].channelId).toBeNull();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    answer({ data: accepted });
    await expect(done).resolves.toEqual(accepted);
    expect(store.getState()).toMatchObject({ pending: {}, announcement: "Accepted. Your conversation with Wanjiku Mwangi is open." });
    expect(store.getState().items[0]).toEqual(accepted);
  });

  it("sends a redirect with the suggested mentor and a trimmed note, and declines in one tap", async () => {
    const { store, calls } = queue((action) => ({
      data: action === "redirect"
        ? { ...pendingMentorRequest, status: "REDIRECTED", redirectedTo: people.joseph, responseNote: "He hires juniors" }
        : { ...brianMentorRequest, status: "DECLINED" },
    }));
    await store.redirect(pendingMentorRequest.id, { ...joseph, note: "  He hires juniors " });
    await store.decline(brianMentorRequest.id);
    expect(calls).toEqual([
      `redirect ${pendingMentorRequest.id} {"mentorId":"${people.joseph.id}","note":"He hires juniors"}`,
      `decline ${brianMentorRequest.id} {}`,
    ]);
    expect(store.getState().announcement).toBe("Marked not this month. Brian Kiprop can ask again later.");
    expect(store.getState().items.map(item => item.status)).toEqual(["REDIRECTED", "DECLINED"]);
  });

  it("sends an optional decline note, and leaves out a blank one", async () => {
    const { store, calls } = queue(() => ({ data: { ...brianMentorRequest, status: "DECLINED" } }));
    await store.decline(brianMentorRequest.id, "Busy with a launch this month");
    expect(calls).toEqual([`decline ${brianMentorRequest.id} {"note":"Busy with a launch this month"}`]);
  });

  it("rolls back when the server refuses, and says nothing changed", async () => {
    const { store } = queue(() => failure(500, "server"));
    await expect(store.accept(pendingMentorRequest.id)).resolves.toBeNull();
    const state = store.getState();
    expect(shownStatus(state, pendingMentorRequest)).toBe("PENDING");
    expect(state.items[0]).toEqual(pendingMentorRequest);
    expect(state.failed[pendingMentorRequest.id]).toMatchObject({ action: "accept", stale: false });
    expect(state.announcement).toBe("Couldn't accept. Nothing changed.");
    store.dismissFailure(pendingMentorRequest.id);
    expect(store.getState().failed).toEqual({});
  });

  it("shows what really happened when the request had already moved", async () => {
    const withdrawn = { ...pendingMentorRequest, status: "WITHDRAWN" as const };
    const { store, calls } = queue(() => failure(409, "conflict"), () => ({ data: withdrawn }));
    await store.decline(pendingMentorRequest.id);
    expect(calls).toContain(`get ${pendingMentorRequest.id}`);
    expect(store.getState().items[0]).toEqual(withdrawn);
    expect(store.getState().failed[pendingMentorRequest.id]).toMatchObject({ stale: true });
    expect(store.getState().announcement).toBe("This request from Wanjiku Mwangi was withdrawn, so nothing changed.");
  });

  it("keeps the request as it was when it can't be read again either", async () => {
    const { store } = queue(() => failure(404, "not_found"));
    await store.accept(pendingMentorRequest.id);
    expect(store.getState().items[0]).toEqual(pendingMentorRequest);
    expect(store.getState().failed[pendingMentorRequest.id]).toMatchObject({ stale: false });
  });

  it("runs one change per request, and refuses changes that cannot apply", async () => {
    let answer!: (reply: MockReply) => void;
    const { store, calls } = queue(() => new Promise(resolve => { answer = resolve; }));
    const first = store.accept(pendingMentorRequest.id);
    await expect(store.decline(pendingMentorRequest.id)).resolves.toBeNull();
    await expect(store.withdraw(brianMentorRequest.id)).resolves.toBeNull();
    // A mentor can't suggest the person asking, or themselves.
    await expect(store.redirect(brianMentorRequest.id, { mentorId: brianMentorRequest.requester.id, mentorName: "Brian" })).resolves.toBeNull();
    await expect(store.redirect(brianMentorRequest.id, { mentorId: brianMentorRequest.mentor.id, mentorName: "David" })).resolves.toBeNull();
    await expect(store.accept("unknown")).resolves.toBeNull();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    answer({ data: { ...pendingMentorRequest, status: "ACCEPTED", channelId: "dm" } });
    await first;
    await expect(store.accept(pendingMentorRequest.id)).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("abandons a change quietly when the last holder releases the store", async () => {
    const { store } = queue(() => new Promise(() => {}));
    const release = store.retain();
    const accepting = store.accept(pendingMentorRequest.id);
    release();
    release();
    await expect(accepting).resolves.toBeNull();
    expect(store.getState()).toMatchObject({ pending: {}, failed: {} });
  });
});

describe("paging and new requests", () => {
  it("loads older requests once, skipping any already shown", async () => {
    const { store, calls } = queue(() => failure(500, "server"));
    await Promise.all([store.loadMore(), store.loadMore()]);
    expect(calls).toEqual(["list ?as=mentor&cursor=c1"]);
    expect(store.getState().items.map(item => item.id)).toEqual([pendingMentorRequest.id, brianMentorRequest.id, "older"]);
    expect(store.getState().nextCursor).toBeNull();
    await store.loadMore();
    expect(calls).toHaveLength(1);
  });

  it("says when older requests could not load", async () => {
    const api = createApiClient({ retry: { maxRetries: 0 }, fetch: createMockTransport([
      { method: "GET", path: "/api/mentor-requests", reply: () => failure(500, "server") },
    ]) });
    const store = createMentorRequestsStore({ as: "requester", status: "PENDING", initial: page([], "c"), api });
    await store.loadMore();
    expect(store.getState()).toMatchObject({ loadingMore: false, announcement: "Couldn't load earlier requests." });
    expect(store.getState().loadError?.status).toBe(500);
  });

  it("puts a request just sent at the top, or refreshes it when already shown", () => {
    const { store } = queue(() => failure(500, "server"));
    const sent = { ...brianMentorRequest, id: "new" };
    store.prepend(sent);
    store.prepend({ ...sent, note: "Edited" });
    expect(store.getState().items.map(item => [item.id, item.note.slice(0, 6)])).toEqual([
      ["new", "Edited"], [pendingMentorRequest.id, pendingMentorRequest.note.slice(0, 6)], [brianMentorRequest.id, brianMentorRequest.note.slice(0, 6)],
    ]);
  });
});

describe("against the stateful mock", () => {
  it("lets the person asking withdraw, and frees the mentor's spot", async () => {
    const mock = createMentoringMock();
    const before = mock.availability(people.david.id).capacity.used;
    const store = createMentorRequestsStore({
      as: "requester", initial: { items: mock.requests().filter(r => r.requester.id === people.wanjiku.id), nextCursor: null }, mock: mock.api,
    });
    await store.withdraw(pendingMentorRequest.id);
    expect(store.getState().items.find(item => item.id === pendingMentorRequest.id)?.status).toBe("WITHDRAWN");
    expect(store.getState().announcement).toBe("Request to David Kamau withdrawn.");
    expect(mock.availability(people.david.id).capacity.used).toBe(before - 1);
  });

  it("shows the person's withdrawal when the mentor tries to accept afterwards", async () => {
    const mock = createMentoringMock({ viewer: people.david });
    const store = createMentorRequestsStore({ as: "mentor", initial: { items: mock.requests().filter(r => r.mentor.id === people.david.id), nextCursor: null }, mock: mock.api });
    mock.move(pendingMentorRequest.id, "WITHDRAWN");
    await store.accept(pendingMentorRequest.id);
    expect(store.getState().items.find(item => item.id === pendingMentorRequest.id)?.status).toBe("WITHDRAWN");
    expect(store.getState().failed[pendingMentorRequest.id]?.stale).toBe(true);
  });

  it("redirects to a listed mentor and the person asking sees the suggestion", async () => {
    const mock = createMentoringMock({ viewer: people.david });
    const store = createMentorRequestsStore({ as: "mentor", initial: { items: mock.requests(), nextCursor: null }, mock: mock.api });
    const samuel = mentors.items[3].person;
    const result = await store.redirect(pendingMentorRequest.id, { mentorId: samuel.id, mentorName: samuel.name });
    expect(result).toMatchObject({ status: "REDIRECTED", redirectedTo: { id: samuel.id }, responseNote: null });
  });
});
