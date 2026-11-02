import { describe, expect, it, vi } from "vitest";
import type { MentorRequestCase } from "@/lib/platform/contracts";
import { FIXTURE_NOW, people, pendingMentorRequest } from "@/lib/platform/fixtures";
import { caseCause, DECIDED_NOTE_NOTICE, requestNotesPaths, requestNotesRequest, type RequestNotesSource } from "./request-notes";

const paths = requestNotesPaths("/admin/moderation");
const held: MentorRequestCase = {
  id: pendingMentorRequest.id, request: { ...pendingMentorRequest, check: null }, state: "OPEN",
  clefReasons: ["Harassment"], report: null, openedAt: FIXTURE_NOW - 60_000, decision: null,
};
const reported: MentorRequestCase = {
  ...held, id: "reported-request", request: { ...pendingMentorRequest, id: "reported-request" }, clefReasons: [],
  report: { reason: "Asked for my phone number.", reportedAt: FIXTURE_NOW - 30_000 },
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refusal = (status: number, message: string) => json(status, { error: { code: "conflict", message } });

function source(overrides: Partial<RequestNotesSource> = {}): RequestNotesSource {
  return {
    list: vi.fn(async ({ state }) => json(200, { items: state === "DECIDED" ? [] : [held, reported], nextCursor: null })),
    decide: vi.fn(async () => json(200, { ...held, state: "DECIDED", decision: { action: "keep", reason: "Fine", by: people.amina, decidedAt: FIXTURE_NOW } })),
    ...overrides,
  };
}

const at = (query: string) => `http://ttv.test/admin/moderation?tab=request-notes${query}`;
const get = (query = "") => [new Request(at(query)), new URL(at(query))] as const;
function post(fields: Record<string, string>, query = "") {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return [new Request(at(query), { method: "POST", body }), new URL(at(query))] as const;
}

describe("requestNotesPaths", () => {
  it("keeps the tab in every address, and the open list bare", () => {
    expect(paths.tab("OPEN")).toBe("/admin/moderation?tab=request-notes");
    expect(paths.tab("DECIDED")).toBe("/admin/moderation?tab=request-notes&state=DECIDED");
    expect(paths.page("OPEN", "c 1")).toBe("/admin/moderation?tab=request-notes&cursor=c+1");
    expect(paths.decided("remove")).toBe("/admin/moderation?tab=request-notes&decided=remove");
  });
});

describe("requestNotesRequest", () => {
  it("lists the open checks, oldest first as the API gives them", async () => {
    const src = source();
    const outcome = await requestNotesRequest(...get(), src, paths);
    expect(src.list).toHaveBeenCalledWith({ state: "OPEN" });
    expect(outcome).toMatchObject({ kind: "page", status: 200, props: { state: "OPEN", formAction: paths.tab("OPEN"), nextHref: null, paged: false } });
    if (outcome.kind !== "page") throw new Error("expected a page");
    expect(outcome.props.items.map((item) => item.id)).toEqual([held.id, reported.id]);
  });

  it("records a decision through the API and lands on the notice", async () => {
    const src = source();
    const outcome = await requestNotesRequest(...post({ requestId: held.id, action: "keep", reason: "  Reads as a fair question.  " }), src, paths);
    expect(src.decide).toHaveBeenCalledWith(held.id, { action: "keep", reason: "Reads as a fair question." });
    expect(outcome).toEqual({ kind: "redirect", location: paths.decided("keep") });

    const landed = await requestNotesRequest(...get("&decided=keep"), source(), paths);
    expect(landed).toMatchObject({ kind: "page", props: { notice: DECIDED_NOTE_NOTICE.keep } });
  });

  it("asks for a reason and a choice before sending anything, keeping what was typed", async () => {
    const src = source();
    const noReason = await requestNotesRequest(...post({ requestId: held.id, action: "remove", reason: " " }), src, paths);
    expect(noReason).toMatchObject({ kind: "page", status: 400, props: { rowError: { id: held.id, message: "Say why, for the record. Nothing changed." } } });
    const noAction = await requestNotesRequest(...post({ requestId: held.id, action: "hide", reason: "Spam" }), src, paths);
    expect(noAction).toMatchObject({ status: 400, props: { rowError: { id: held.id, draft: "Spam" } } });
    const noId = await requestNotesRequest(...post({ action: "keep", reason: "Fine" }), src, paths);
    expect(noId).toMatchObject({ status: 400, props: { failure: expect.stringContaining("which request") } });
    expect(src.decide).not.toHaveBeenCalled();
  });

  it("says why the API refused, beside the case when it is still listed and above the list when it is not", async () => {
    const own = await requestNotesRequest(
      ...post({ requestId: held.id, action: "keep", reason: "Fine" }),
      source({ decide: vi.fn(async () => refusal(403, "Another admin needs to check a request you're part of.")) }), paths,
    );
    expect(own).toMatchObject({
      kind: "page", status: 403,
      props: { rowError: { id: held.id, message: "Another admin needs to check a request you're part of. Nothing changed.", draft: "Fine" } },
    });
    const gone = await requestNotesRequest(
      ...post({ requestId: "decided-elsewhere", action: "remove", reason: "Spam" }),
      source({ decide: vi.fn(async () => refusal(409, "An admin already decided this check.")) }), paths,
    );
    expect(gone).toMatchObject({ status: 409, props: { failure: "An admin already decided this check. Nothing changed.", rowError: undefined } });
  });

  it("starts the tab again on a stale cursor, and pages forward", async () => {
    const stale = await requestNotesRequest(...get("&cursor=nope"), source({ list: vi.fn(async () => refusal(400, "Bad cursor")) }), paths);
    expect(stale).toEqual({ kind: "redirect", location: paths.tab("OPEN") });
    const paged = await requestNotesRequest(...get("&state=DECIDED&cursor=abc"), source({ list: vi.fn(async () => json(200, { items: [], nextCursor: "def" })) }), paths);
    expect(paged).toMatchObject({ props: { state: "DECIDED", paged: true, nextHref: paths.page("DECIDED", "def") } });
  });

  it("fails loudly when the list cannot be read", async () => {
    await expect(requestNotesRequest(...get(), source({ list: vi.fn(async () => refusal(500, "Down")) }), paths)).rejects.toThrow("(500)");
  });
});

describe("caseCause", () => {
  it("says what raised the check: Tembo's reasons, or the mentor's report", () => {
    expect(caseCause(held)).toBe("Tembo's check held it before David saw it: Harassment.");
    expect(caseCause(reported)).toBe("David reported it after reading it.");
  });
});
