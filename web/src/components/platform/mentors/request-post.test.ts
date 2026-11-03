import { describe, expect, it, vi } from "vitest";
import type { CreateMentorRequest } from "@/lib/platform/contracts";
import { mentors, pendingMentorRequest, projects } from "@/lib/platform/fixtures";
import { failureMessage, requestFailure } from "@/lib/platform/client/mentor-request-form";
import { AGREE_FIELD, handleRequestPost, isRequestPost, projectValue, REQUEST_INTENT, type RequestPostOptions } from "./request-post";

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

  it("says a full mentor has just filled without asking the API, with the next opening", async () => {
    const opts = options(json(201, pendingMentorRequest));
    const result = await handleRequestPost(post({ intent: REQUEST_INTENT, mentorId: mercy.person.id, note: "A portfolio review?", format: "WRITTEN_REVIEW" }), opts);
    expect(result).toMatchObject({
      kind: "render", status: 409,
      form: { status: "error", failure: "conflict", failureMessage: "Mercy Wambui has no spots left this month. The next opening is 1 December." },
    });
    expect(opts.send).not.toHaveBeenCalled();
  });

  // QA4-05: someone who has not agreed yet agrees as they send, in the same post, and the request goes.
  it("records the agreement to how we talk to each other first, then sends, when the form carries it", async () => {
    const calls: string[] = [];
    const opts = options(() => { calls.push("send"); return json(201, pendingMentorRequest); });
    const agree = vi.fn(async (version: number) => { calls.push(`agree ${version}`); });
    const result = await handleRequestPost(askDavid({ [AGREE_FIELD]: "3" }), { ...opts, agree });
    expect(result.kind).toBe("redirect");
    expect(calls).toEqual(["agree 3", "send"]);
  });

  it("agrees to nothing for a draft that needs fixing, a session that may not agree, or no agreement asked", async () => {
    const agree = vi.fn(async () => {});
    await handleRequestPost(askDavid({ note: "", [AGREE_FIELD]: "3" }), { ...options(json(201, pendingMentorRequest)), agree });
    await handleRequestPost(askDavid(), { ...options(json(201, pendingMentorRequest)), agree });
    await handleRequestPost(askDavid({ [AGREE_FIELD]: "nope" }), { ...options(json(201, pendingMentorRequest)), agree });
    expect(agree).not.toHaveBeenCalled();
    // An agent's session has no `agree`: the API asks for the habits again, and the drawer shows them.
    const result = await handleRequestPost(askDavid({ [AGREE_FIELD]: "3" }), options(refusal(403, "conduct_required")));
    expect(result).toMatchObject({ kind: "render", status: 403, form: { status: "conduct" } });
  });

  it("turns the API's refusals into the drawer's states, the note kept", async () => {
    const cases: [Response, object][] = [
      [refusal(403, "conduct_required"), { status: 403, form: { status: "conduct", failure: null } }],
      [refusal(403, "forbidden", "Same-origin request required."), { status: 403, form: { status: "error", failure: "other", failureMessage: null } }],
      // QA4-11: the server knows which request is in the way, and the drawer says so in its words.
      [refusal(409, "conflict", "Your earlier request to Ruth Atieno is waiting for a check before it's sent. Your requests will show when the check is done."), {
        status: 409,
        form: { status: "error", failure: "conflict", failureMessage: "Your earlier request to Ruth Atieno is waiting for a check before it's sent. Your requests will show when the check is done." },
      }],
      [refusal(429, "rate_limited", "You have 5 requests waiting. Withdraw one or wait for an answer first."), {
        status: 429, form: { status: "error", failure: "limit", failureMessage: "You have 5 requests waiting. Withdraw one or wait for an answer first." },
      }],
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
  // Owner decision 2026-11-02: any signed-in person may ask as themselves, so no 403 reads as "not a member".
  it("reads a 403 other than the habits step as a plain failure", () => {
    expect(requestFailure({ status: 403, code: "forbidden" })).toBe("other");
    expect(requestFailure({ status: 403, code: "conduct_required" })).toBe("other");
    expect(requestFailure({ status: 404, code: "not_found" })).toBe("notFound");
    expect(requestFailure({ status: 401, code: "unauthorized" })).toBe("signedOut");
  });
});

describe("failureMessage", () => {
  it("keeps the server's sentence only for a conflict or a limit, which the person can act on", () => {
    expect(failureMessage("conflict", "You already have a request waiting with Ruth Atieno.")).toBe("You already have a request waiting with Ruth Atieno.");
    expect(failureMessage("limit", "You've asked for a lot of time today. Try again later.")).toBe("You've asked for a lot of time today. Try again later.");
    expect(failureMessage("conflict", "  ")).toBeNull();
    expect(failureMessage("conflict", undefined)).toBeNull();
    expect(failureMessage("other", "Internal detail.")).toBeNull();
    expect(failureMessage("notFound", "Not found.")).toBeNull();
  });
});
