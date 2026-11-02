import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { CreateMentorRequest } from "@/lib/platform/contracts";
import { mentors, pendingMentorRequest, projects } from "@/lib/platform/fixtures";
import { NEEDS_MEMBER_MESSAGE, requestFailure } from "@/lib/platform/client/mentor-request-form";
import { handleRequestPost, isRequestPost, projectValue, REQUEST_INTENT, type RequestPostOptions } from "./request-post";

const ORIGIN = "https://ttv.test";
const PAGE = `${ORIGIN}/dashboard/community/mentors`;
const [david, mercy] = mentors.items;

function post(fields: Record<string, string>, origin: string | null = ORIGIN): Request {
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
  if (origin) headers.set("Origin", origin);
  return new Request(PAGE, { method: "POST", headers, body: new URLSearchParams(fields) });
}

const askDavid = (extra: Record<string, string> = {}) => post({
  intent: REQUEST_INTENT, mentorId: david.person.id, note: "Could you check how I handle a payment callback that arrives twice?",
  format: "WRITTEN_REVIEW", ...extra,
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refusal = (status: number, code: string, message = "Refused.") => json(status, { error: { code, message } });

function options(reply: Response | (() => Response)): RequestPostOptions & { send: ReturnType<typeof vi.fn<(body: CreateMentorRequest) => Promise<Response>>> } {
  return {
    mentors: mentors.items,
    send: vi.fn(async () => typeof reply === "function" ? reply() : reply),
    sent: (id) => `/dashboard/community/mentors?sent=${id}`,
  };
}

describe("asking for time without JavaScript", () => {
  it("tells a request post from the conduct form, without consuming the body", async () => {
    const request = askDavid();
    expect(await isRequestPost(request)).toBe(true);
    expect(await isRequestPost(post({ version: "1" }))).toBe(false);
    expect(await isRequestPost(new Request(PAGE))).toBe(false);
    // The handler can still read it.
    expect((await handleRequestPost(request, options(json(201, pendingMentorRequest)))).kind).toBe("redirect");
  });

  it("hands the API the same body the island sends, with the work at its revision, and lands on the sent notice", async () => {
    const opts = options(json(201, pendingMentorRequest));
    const result = await handleRequestPost(askDavid({ project: projectValue(projects.fareSplitter) }), opts);
    expect(result).toEqual({ kind: "redirect", location: `/dashboard/community/mentors?sent=${pendingMentorRequest.id}` });
    expect(opts.send).toHaveBeenCalledWith({
      mentorId: david.person.id, note: "Could you check how I handle a payment callback that arrives twice?",
      project: { type: "project", journeyId: projects.fareSplitter.journeyId, version: projects.fareSplitter.version }, format: "WRITTEN_REVIEW",
    });
  });

  it("refuses another site's post, an oversized body, the wrong intent and an unlisted mentor before the API", async () => {
    const opts = options(json(201, pendingMentorRequest));
    expect(await handleRequestPost(post({ intent: REQUEST_INTENT }, "https://elsewhere.test"), opts)).toEqual({ kind: "refuse", status: 403 });
    expect(await handleRequestPost(post({ intent: REQUEST_INTENT }, null), opts)).toEqual({ kind: "refuse", status: 403 });
    const big = new Request(PAGE, { method: "POST", headers: { Origin: ORIGIN, "Content-Length": String(10_000_000) }, body: "x" });
    expect(await handleRequestPost(big, opts)).toEqual({ kind: "refuse", status: 413 });
    expect(await handleRequestPost(post({ intent: "conduct", mentorId: david.person.id }), opts)).toEqual({ kind: "refuse", status: 400 });
    expect(await handleRequestPost(askDavid({ mentorId: "someone-else" }), opts)).toEqual({ kind: "refuse", status: 400 });
    expect(opts.send).not.toHaveBeenCalled();
  });

  it("keeps what was written when a field needs fixing, and ignores a malformed project", async () => {
    const opts = options(json(201, pendingMentorRequest));
    const result = await handleRequestPost(askDavid({ note: "", format: "SOMETHING", project: "not a project" }), opts);
    expect(result).toMatchObject({ kind: "render", status: 400, mentorId: david.person.id, form: { status: "editing", note: "", project: null, format: null } });
    if (result.kind !== "render") throw new Error("expected a render");
    expect(Object.keys(result.form.errors).toSorted()).toEqual(["format", "note"]);
    expect(opts.send).not.toHaveBeenCalled();
  });

  it("says a full mentor has just filled without asking the API", async () => {
    const opts = options(json(201, pendingMentorRequest));
    const result = await handleRequestPost(post({ intent: REQUEST_INTENT, mentorId: mercy.person.id, note: "A portfolio review?", format: "WRITTEN_REVIEW" }), opts);
    expect(result).toMatchObject({ kind: "render", status: 409, form: { status: "error", failure: "conflict" } });
    expect(opts.send).not.toHaveBeenCalled();
  });

  it("turns the API's refusals into the drawer's states, the note kept", async () => {
    const cases: [Response, object][] = [
      [refusal(403, "conduct_required"), { status: 403, form: { status: "conduct", failure: null } }],
      [refusal(403, "forbidden", NEEDS_MEMBER_MESSAGE), { status: 403, form: { status: "error", failure: "notMember" } }],
      [refusal(403, "forbidden", "Same-origin request required."), { status: 403, form: { status: "error", failure: "other" } }],
      [refusal(409, "conflict"), { status: 409, form: { status: "error", failure: "conflict" } }],
      [refusal(429, "rate_limited"), { status: 429, form: { status: "error", failure: "limit" } }],
      [new Response("not json", { status: 502 }), { status: 502, form: { status: "error", failure: "other" } }],
      [json(201, { not: "a request" }), { status: 500, form: { status: "error", failure: "other" } }],
    ];
    for (const [reply, expected] of cases) {
      const result = await handleRequestPost(askDavid(), options(reply));
      expect(result).toMatchObject({ kind: "render", ...expected, form: { ...(expected as { form: object }).form, note: expect.stringContaining("payment callback") } });
    }
  });
});

describe("requestFailure", () => {
  it("knows B-4.1's member refusal word for word, so a reworded backend copy fails here and not quietly in the drawer", () => {
    // The backend lane owns the message (lib/mentoring/requests.ts); this lane may not import it into client code.
    expect(readFileSync("src/lib/mentoring/requests.ts", "utf8")).toContain(JSON.stringify(NEEDS_MEMBER_MESSAGE));
  });

  it("reads only B-4.1's member refusal as needing a member account", () => {
    expect(requestFailure({ status: 403, code: "forbidden", message: NEEDS_MEMBER_MESSAGE })).toBe("notMember");
    expect(requestFailure({ status: 403, code: "forbidden", message: "Same-origin request required." })).toBe("other");
    expect(requestFailure({ status: 403, code: "forbidden" })).toBe("other");
    expect(requestFailure({ status: 403, code: "conduct_required" })).toBe("other");
    expect(requestFailure({ status: 404, code: "not_found" })).toBe("notFound");
    expect(requestFailure({ status: 401, code: "unauthorized" })).toBe("signedOut");
  });
});
