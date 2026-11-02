import { describe, expect, it, vi } from "vitest";
import type { CreateMentorRequest } from "@/lib/platform/contracts";
import { mentors, pendingMentorRequest, projects } from "@/lib/platform/fixtures";
import { handleRequestPost, isRequestPost, projectValue, REQUEST_INTENT, type RequestPostOptions } from "./request-post";

const PAGE = "https://ttv.test/dashboard/community/mentors?area=Career";
const [david, mercy] = mentors.items;

function post(fields: Record<string, string>, origin: string | null = "https://ttv.test") {
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
  if (origin) headers.set("Origin", origin);
  return new Request(PAGE, { method: "POST", headers, body: new URLSearchParams(fields).toString() });
}

const ask = (fields: Record<string, string> = {}) => ({
  intent: REQUEST_INTENT, mentorId: david!.person.id, note: "  Could you check my payment callback?  ", format: "WRITTEN_REVIEW", ...fields,
});

function options(reply: Response | (() => Response) = Response.json(pendingMentorRequest, { status: 201 })) {
  const send = vi.fn(async (_body: CreateMentorRequest) => typeof reply === "function" ? reply() : reply.clone());
  const opts: RequestPostOptions = { mentors: mentors.items, send, sent: (id) => `/dashboard/community/mentors?sent=${id}` };
  return { opts, send };
}

const refusal = (status: number, code: string) => Response.json({ error: { code, message: "Refused." } }, { status });

describe("asking for time without JavaScript", () => {
  it("tells a request post from the conduct form, without using up the body", async () => {
    const request = post(ask());
    expect(await isRequestPost(request)).toBe(true);
    expect(request.bodyUsed).toBe(false);
    expect(await isRequestPost(post({ intent: "agree" }))).toBe(false);
    expect(await isRequestPost(new Request(PAGE))).toBe(false);
  });

  it("sends the trimmed note, the format and the attached work through the API's handler, then lands on the request", async () => {
    const { opts, send } = options();
    const project = { journeyId: projects.fareSplitter.journeyId, version: projects.fareSplitter.version };
    const result = await handleRequestPost(post(ask({ project: projectValue(project) })), opts);
    expect(result).toEqual({ kind: "redirect", location: `/dashboard/community/mentors?sent=${pendingMentorRequest.id}` });
    expect(send).toHaveBeenCalledWith({
      mentorId: david!.person.id, note: "Could you check my payment callback?", format: "WRITTEN_REVIEW",
      project: { type: "project", ...project },
    });
  });

  it("refuses a post from another origin, or without one, before reading anything", async () => {
    const { opts, send } = options();
    expect(await handleRequestPost(post(ask(), "https://elsewhere.test"), opts)).toEqual({ kind: "refuse", status: 403 });
    expect(await handleRequestPost(post(ask(), null), opts)).toEqual({ kind: "refuse", status: 403 });
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a mentor who is not listed, and a post that is not a request", async () => {
    const { opts, send } = options();
    expect(await handleRequestPost(post(ask({ mentorId: "someone-else" })), opts)).toEqual({ kind: "refuse", status: 400 });
    expect(await handleRequestPost(post({ ...ask(), intent: "agree" }), opts)).toEqual({ kind: "refuse", status: 400 });
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores work that is not a well-formed pick, rather than guessing", async () => {
    const { opts, send } = options();
    await handleRequestPost(post(ask({ project: "no-version" })), opts);
    expect(send.mock.calls[0]![0].project).toBeNull();
  });

  it("says a full mentor is full without sending", async () => {
    const { opts, send } = options();
    const result = await handleRequestPost(post(ask({ mentorId: mercy!.person.id, format: mercy!.formats[0]! })), opts);
    expect(result).toMatchObject({ kind: "render", status: 409, mentorId: mercy!.person.id, form: { status: "error", failure: "conflict" } });
    expect(send).not.toHaveBeenCalled();
  });

  it("comes back to the drawer with the fields to fix, keeping what was written", async () => {
    const { opts, send } = options();
    const result = await handleRequestPost(post(ask({ note: "   ", format: "NOT_A_FORMAT" })), opts);
    expect(result).toMatchObject({
      kind: "render", status: 400,
      form: { status: "editing", note: "   ", format: null, errors: { note: "Say what you'd like help with.", format: "Choose how you'd like their help." } },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("asks for the habits first when the server needs the code of conduct", async () => {
    const { opts } = options(refusal(403, "conduct_required"));
    expect(await handleRequestPost(post(ask()), opts)).toMatchObject({ kind: "render", status: 403, form: { status: "conduct", failure: null } });
  });

  it.each([
    [403, "forbidden", "notMember"],
    [409, "conflict", "conflict"],
    [429, "rate_limited", "limit"],
    [404, "not_found", "notFound"],
    [500, "server", "other"],
  ] as const)("keeps the note and says why after a %i %s", async (status, code, failure) => {
    const { opts } = options(refusal(status, code));
    expect(await handleRequestPost(post(ask()), opts)).toMatchObject({
      kind: "render", status, form: { status: "error", failure, note: "  Could you check my payment callback?  " },
    });
  });

  it("treats an unreadable answer as a server failure", async () => {
    const { opts } = options(() => new Response("<html>", { status: 502 }));
    expect(await handleRequestPost(post(ask()), opts)).toMatchObject({ kind: "render", status: 502, form: { failure: "other" } });
    const ok = options(() => Response.json({ unexpected: true }, { status: 201 }));
    expect(await handleRequestPost(post(ask()), ok.opts)).toMatchObject({ kind: "render", status: 500, form: { failure: "other" } });
  });
});
