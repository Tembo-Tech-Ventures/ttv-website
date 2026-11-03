import { describe, expect, it, vi } from "vitest";
import type { MentorRequestCase } from "@/lib/platform/contracts";
import { FIXTURE_NOW, people, pendingMentorRequest } from "@/lib/platform/fixtures";
import {
  caseCause, DECIDED_NOTE_NOTICE, decidedStatus, moderationView, requestNoteChoices, requestNotesAttention, requestNotesLink,
  requestNotesPaths, requestNotesRequest, requestNotesWaitingText, type RequestNotesSource,
} from "./request-notes";

const paths = requestNotesPaths("/admin/moderation");
const held: MentorRequestCase = {
  id: pendingMentorRequest.id, request: { ...pendingMentorRequest, check: null }, state: "OPEN",
  clefReasons: ["Harassment"], report: null, openedAt: FIXTURE_NOW - 60_000, decision: null,
  mentorCapacity: { used: 1, limit: 3, nextOpeningAt: null },
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

describe("with mentor_requests off", () => {
  it("shows the message queue whatever ?tab= says, and offers no Request notes link", () => {
    const asks = new URLSearchParams("tab=request-notes");
    expect(moderationView(asks, false)).toBe("queue");
    expect(requestNotesLink(false, paths)).toBeUndefined();
  });

  it("shows Request notes only when it is on and asked for", () => {
    expect(moderationView(new URLSearchParams("tab=request-notes"), true)).toBe("request-notes");
    expect(moderationView(new URLSearchParams("tab=other"), true)).toBe("queue");
    expect(moderationView(new URLSearchParams(), true)).toBe("queue");
    expect(requestNotesLink(true, paths)).toBe("/admin/moderation?tab=request-notes");
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

describe("requestNoteChoices (QA4-10)", () => {
  it("says a keep takes one of the mentor's spots, and what it sends", () => {
    expect(requestNoteChoices(held)).toEqual({
      keepLabel: "Keep: send it to David",
      removeLabel: "Remove: close it",
      keep: "David has used 1 of 3 spots this month. Keeping sends it to David as it was written and takes a spot.",
      remove: "Removing closes it, and David never sees it. Wanjiku sees “This request wasn't sent” and can ask again with a new note.",
    });
  });

  it("says when the mentor is full that a keep still takes a spot", () => {
    const full = requestNoteChoices({ ...held, mentorCapacity: { used: 3, limit: 3, nextOpeningAt: null } });
    expect(full.keep).toBe("David is full this month: 3 of 3 spots used. Keeping still sends it to David as it was written and takes a spot.");
    const one = requestNoteChoices({ ...held, mentorCapacity: { used: 0, limit: 1, nextOpeningAt: null } });
    expect(one.keep).toMatch(/^David has used 0 of 1 spot this month\./);
  });

  it("sends a request the mentor reported back to them, and never says who raised it to the person asking", () => {
    const choices = requestNoteChoices(reported);
    expect(choices.keepLabel).toBe("Keep: back to David");
    expect(choices.keep).toBe("David has used 1 of 3 spots this month. Keeping sends it back to David to answer and takes a spot.");
    expect(choices.remove).toBe("Removing closes it. Wanjiku sees “This request was closed” and can ask again with a new note.");
  });

  it("says nothing about spots once the mentor has no availability saved", () => {
    expect(requestNoteChoices({ ...held, mentorCapacity: null }).keep).toBe("Keeping sends it to David as it was written.");
  });

  it("says a reported request its asker withdrew stays closed whichever is chosen", () => {
    const withdrawn = requestNoteChoices({ ...reported, request: { ...reported.request, status: "WITHDRAWN" } });
    expect(withdrawn).toMatchObject({ keepLabel: "Keep", removeLabel: "Remove", remove: null });
    expect(withdrawn.keep).toMatch(/^Wanjiku withdrew this request, so it stays closed/);
  });
});

describe("decidedStatus (QA4-21)", () => {
  const decision = (action: "keep" | "remove") => ({ action, reason: "Fine", by: people.amina, decidedAt: FIXTURE_NOW });
  const decided = (item: MentorRequestCase, action: "keep" | "remove", status = item.request.status): MentorRequestCase => ({
    ...item, state: "DECIDED", decision: decision(action), request: { ...item.request, status } as MentorRequestCase["request"],
  });

  it("says where a kept request stands now", () => {
    expect(decidedStatus(decided(held, "keep"))).toBe("Kept: sent to David");
    expect(decidedStatus(decided(reported, "keep"))).toBe("Kept: back with David");
    expect(decidedStatus(decided(held, "keep", "DECLINED"))).toBe("Kept: David said not this month");
    expect(decidedStatus(decided(held, "keep", "WITHDRAWN"))).toBe("Kept: Wanjiku withdrew it");
  });

  it("says a removed request wasn't sent, or was closed after the mentor read it", () => {
    expect(decidedStatus(decided(held, "remove", "WITHDRAWN"))).toBe("Removed: not sent");
    expect(decidedStatus(decided(reported, "remove", "WITHDRAWN"))).toBe("Removed: closed");
  });

  it("has nothing to say before a decision", () => {
    expect(decidedStatus(held)).toBeNull();
  });
});

describe("requestNotesAttention (QA4-04)", () => {
  it("links Admin Home to the waiting checks, counted", () => {
    expect(requestNotesAttention(3, true, paths)).toEqual({ text: "3 request notes waiting for a check", href: "/admin/moderation?tab=request-notes" });
    expect(requestNotesWaitingText(1)).toBe("1 request note waiting for a check");
  });

  it("says nothing while mentor requests are off, or nothing waits", () => {
    expect(requestNotesAttention(3, false, paths)).toBeNull();
    expect(requestNotesAttention(0, true, paths)).toBeNull();
  });
});
