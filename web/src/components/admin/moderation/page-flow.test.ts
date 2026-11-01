import { describe, expect, it, vi } from "vitest";
import { harnessCases } from "./harness";
import { moderationQueueRequest, queuePaths, type QueueSource } from "./page-flow";

const paths = queuePaths("/admin/moderation");
const cases = harnessCases();
const pending = cases.filter((item) => item.state === "PENDING");

class Refused extends Error {
  constructor(readonly status: number) { super("refused"); }
}
class BadCursor extends Error {}

function source(overrides: Partial<QueueSource> = {}): QueueSource {
  return {
    list: vi.fn(async ({ state }) => ({ items: cases.filter((item) => item.state === state), nextCursor: null })),
    countPending: vi.fn(async () => pending.length),
    decide: vi.fn(async () => undefined),
    isBadCursor: (error) => error instanceof BadCursor,
    ...overrides,
  };
}

const get = (query = "") => [new Request(`http://ttv.test/admin/moderation${query}`), new URL(`http://ttv.test/admin/moderation${query}`)] as const;
function post(fields: Record<string, string>, query = "") {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const url = `http://ttv.test/admin/moderation${query}`;
  return [new Request(url, { method: "POST", body }), new URL(url)] as const;
}

describe("queuePaths", () => {
  it("keeps the pending tab bare and names everything else", () => {
    expect(paths.tab("PENDING")).toBe("/admin/moderation");
    expect(paths.tab("DECIDED")).toBe("/admin/moderation?state=DECIDED");
    expect(paths.page("PENDING", "c 1")).toBe("/admin/moderation?cursor=c+1");
    expect(paths.decided("DECIDED", "restore")).toBe("/admin/moderation?state=DECIDED&decided=restore");
  });
});

describe("moderationQueueRequest", () => {
  it("renders the pending tab by default, with its count", async () => {
    const outcome = await moderationQueueRequest(...get(), source(), paths);
    expect(outcome).toMatchObject({ kind: "page", status: 200, props: { state: "PENDING", pendingCount: 4, formAction: "/admin/moderation", paged: false, nextHref: null } });
    if (outcome.kind === "page") expect(outcome.props.items.map(({ id }) => id)).toEqual(pending.map(({ id }) => id));
  });

  it("pages with the cursor and posts back to the same page", async () => {
    const list = vi.fn(async () => ({ items: [], nextCursor: "next" }));
    const outcome = await moderationQueueRequest(...get("?state=DECIDED&cursor=abc"), source({ list }), paths);
    expect(list).toHaveBeenCalledWith({ state: "DECIDED", cursor: "abc" });
    expect(outcome).toMatchObject({ props: { formAction: "/admin/moderation?state=DECIDED&cursor=abc", nextHref: "/admin/moderation?state=DECIDED&cursor=next", paged: true } });
  });

  it("sends a stale cursor back to the first page", async () => {
    const list = vi.fn(async () => { throw new BadCursor(); });
    expect(await moderationQueueRequest(...get("?cursor=old"), source({ list }), paths)).toEqual({ kind: "redirect", location: "/admin/moderation" });
  });

  it("lets other read failures through", async () => {
    const list = vi.fn(async () => { throw new Error("D1 down"); });
    await expect(moderationQueueRequest(...get(), source({ list }), paths)).rejects.toThrow("D1 down");
  });

  it("redirects only once a decision is recorded, announcing it", async () => {
    const queue = source();
    const outcome = await moderationQueueRequest(...post({ messageId: pending[0].id, action: "hide", reason: " Scam " }), queue, paths);
    expect(queue.decide).toHaveBeenCalledWith({ ok: true, messageId: pending[0].id, action: "hide", reason: "Scam" });
    expect(outcome).toEqual({ kind: "redirect", location: "/admin/moderation?decided=hide" });

    const announced = await moderationQueueRequest(...get("?decided=hide"), queue, paths);
    expect(announced).toMatchObject({ props: { notice: expect.stringMatching(/^Hidden\./) } });
  });

  it("refuses a decision without a reason, keeping the case and nothing decided", async () => {
    const queue = source();
    const outcome = await moderationQueueRequest(...post({ messageId: pending[0].id, action: "hide", reason: "" }), queue, paths);
    expect(queue.decide).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ kind: "page", status: 400, props: { rowError: { id: pending[0].id, draft: "" }, notice: undefined } });
  });

  it.each([403, 404, 409])("renders a %i refusal beside the case, never a notice", async (status) => {
    const decide = vi.fn(async () => { throw new Refused(status); });
    const outcome = await moderationQueueRequest(
      ...post({ messageId: pending[1].id, action: "keep", reason: "Fine" }, "?decided=keep"), source({ decide }), paths);
    expect(outcome).toMatchObject({ kind: "page", status, props: { rowError: { id: pending[1].id, draft: "Fine", message: expect.stringMatching(/^Nothing changed\./) } } });
    if (outcome.kind === "page") expect(outcome.props.notice).toBeUndefined();
  });

  it("moves a refusal for a case no longer listed to the page banner", async () => {
    const decide = vi.fn(async () => { throw new Refused(409); });
    const outcome = await moderationQueueRequest(...post({ messageId: "gone", action: "keep", reason: "Fine" }), source({ decide }), paths);
    expect(outcome).toMatchObject({ status: 409, props: { rowError: undefined, failure: expect.stringMatching(/^Nothing changed\./) } });
  });

  it("lets unexpected decision failures through", async () => {
    const decide = vi.fn(async () => { throw new TypeError("bug"); });
    await expect(moderationQueueRequest(...post({ messageId: pending[0].id, action: "keep", reason: "x" }), source({ decide }), paths)).rejects.toThrow("bug");
  });
});
