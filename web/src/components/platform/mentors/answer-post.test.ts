import { describe, expect, it, vi } from "vitest";
import { acceptedMentorRequest, pendingMentorRequest, people } from "@/lib/platform/fixtures";
import { CHOOSE_MENTOR, DIDNT_GO_THROUGH, FIX_AND_SEND, REPORT_REQUIRED, suggestField, type AnswerIntent } from "./answer-fields";
import { handleAnswerPost, settleAnswer, type AnswerBody, type AnswerPostOptions, type PostedAnswer } from "./answer-post";

const ORIGIN = "https://ttv.test";
const PAGE = `${ORIGIN}/dashboard/mentoring/requests`;
const ID = pendingMentorRequest.id;

function post(fields: Record<string, string>, origin: string | null = ORIGIN): Request {
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
  if (origin) headers.set("Origin", origin);
  return new Request(PAGE, { method: "POST", headers, body: new URLSearchParams(fields) });
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refusal = (status: number, code: string, message = "Refused.") => json(status, { error: { code, message } });

function options(reply: Response = json(200, pendingMentorRequest)) {
  const send = vi.fn<(intent: AnswerIntent, requestId: string, body: AnswerBody) => Promise<Response>>(async () => reply);
  return { send, answered: (id: string) => `/dashboard/mentoring/requests?answered=${id}` } satisfies AnswerPostOptions;
}

describe("answering a request without JavaScript", () => {
  it("hands the API the same bodies the island sends, and lands on the queue naming the request", async () => {
    const cases: [Record<string, string>, AnswerIntent, AnswerBody][] = [
      [{ intent: "accept", requestId: ID }, "accept", {}],
      [{ intent: "decline", requestId: ID, note: "" }, "decline", {}],
      [{ intent: "decline", requestId: ID, note: "  Try me in December?  " }, "decline", { note: "Try me in December?" }],
      [{ intent: "redirect", requestId: ID, [suggestField(ID)]: people.samuel.id, note: "" }, "redirect", { mentorId: people.samuel.id }],
      [{ intent: "redirect", requestId: ID, [suggestField(ID)]: people.samuel.id, note: "He ships Android apps." }, "redirect", { mentorId: people.samuel.id, note: "He ships Android apps." }],
      [{ intent: "report", requestId: ID, reason: " Asked for my phone number. " }, "report", { reason: "Asked for my phone number." }],
    ];
    for (const [fields, intent, body] of cases) {
      const opts = options();
      expect(await handleAnswerPost(post(fields), opts)).toEqual({ kind: "redirect", location: `/dashboard/mentoring/requests?answered=${ID}` });
      expect(opts.send).toHaveBeenCalledWith(intent, ID, body);
    }
  });

  it("refuses another site's post, an oversized body, an unknown intent and a missing request before the API", async () => {
    const opts = options();
    expect(await handleAnswerPost(post({ intent: "accept", requestId: ID }, "https://elsewhere.test"), opts)).toEqual({ kind: "refuse", status: 403 });
    expect(await handleAnswerPost(post({ intent: "accept", requestId: ID }, null), opts)).toEqual({ kind: "refuse", status: 403 });
    const big = new Request(PAGE, { method: "POST", headers: { Origin: ORIGIN, "Content-Length": String(10_000_000) }, body: "x" });
    expect(await handleAnswerPost(big, opts)).toEqual({ kind: "refuse", status: 413 });
    expect(await handleAnswerPost(post({ intent: "withdraw", requestId: ID }), opts)).toEqual({ kind: "refuse", status: 400 });
    expect(await handleAnswerPost(post({ intent: "accept" }), opts)).toEqual({ kind: "refuse", status: 400 });
    expect(await handleAnswerPost(post({ intent: "accept", requestId: "x".repeat(256) }), opts)).toEqual({ kind: "refuse", status: 400 });
    expect(opts.send).not.toHaveBeenCalled();
  });

  it("asks for a reason or a mentor before the API, keeping what was written", async () => {
    const opts = options();
    expect(await handleAnswerPost(post({ intent: "report", requestId: ID, reason: "   " }), opts)).toEqual({
      kind: "render", status: 400,
      answer: { requestId: ID, panel: "report", note: "   ", mentorId: null, status: 400, code: "validation", message: null, error: REPORT_REQUIRED },
    });
    expect(await handleAnswerPost(post({ intent: "redirect", requestId: ID, note: "Ask Samuel." }), opts)).toMatchObject({
      kind: "render", status: 400, answer: { panel: "suggest", note: "Ask Samuel.", mentorId: null, error: CHOOSE_MENTOR },
    });
    expect(opts.send).not.toHaveBeenCalled();
  });

  it("brings the API's refusal back with its status, the panel and what was written", async () => {
    const result = await handleAnswerPost(
      post({ intent: "redirect", requestId: ID, [suggestField(ID)]: people.samuel.id, note: "He ships Android apps." }),
      options(refusal(400, "validation", "Suggest another mentor who is taking requests.")),
    );
    expect(result).toEqual({
      kind: "render", status: 400,
      answer: {
        requestId: ID, panel: "suggest", note: "He ships Android apps.", mentorId: people.samuel.id,
        status: 400, code: "validation", message: "Suggest another mentor who is taking requests.", error: null,
      },
    });
    // A personal access token, or a body that isn't the API's envelope: the API's status, no sentence.
    expect(await handleAnswerPost(post({ intent: "accept", requestId: ID }), options(refusal(403, "forbidden")))).toMatchObject({
      kind: "render", status: 403, answer: { panel: null, code: "forbidden" },
    });
    expect(await handleAnswerPost(post({ intent: "accept", requestId: ID }), options(new Response("down", { status: 502 })))).toMatchObject({
      kind: "render", status: 502, answer: { code: "server", message: null },
    });
  });
});

describe("settleAnswer", () => {
  const posted = (rest: Partial<PostedAnswer> = {}): PostedAnswer => ({
    requestId: ID, panel: "decline", note: "Try me in December?", mentorId: null, status: 503, code: "server", message: "Busy.", error: null, ...rest,
  });

  it("asks to fix a field, and otherwise says it didn't go through, the panel open on what was written", () => {
    expect(settleAnswer(posted({ status: 400, code: "validation", message: null, error: REPORT_REQUIRED, panel: "report" }), pendingMentorRequest))
      .toMatchObject({ panel: "report", error: REPORT_REQUIRED, failure: FIX_AND_SEND });
    expect(settleAnswer(posted(), pendingMentorRequest)).toEqual({
      requestId: ID, panel: "decline", note: "Try me in December?", mentorId: null, error: null, failure: DIDNT_GO_THROUGH,
    });
    // Only a sentence the mentor can act on is the API's own.
    expect(settleAnswer(posted({ status: 400, code: "validation", message: "Suggest another mentor who is taking requests." }), pendingMentorRequest).failure)
      .toBe("Suggest another mentor who is taking requests.");
    expect(settleAnswer(posted({ status: 403, code: "forbidden", message: "Same-origin request required." }), pendingMentorRequest).failure).toBe(DIDNT_GO_THROUGH);
  });

  it("says what happened instead when the request moved on meanwhile, with no panel to send again", () => {
    const withdrawn = { ...pendingMentorRequest, status: "WITHDRAWN" as const };
    expect(settleAnswer(posted({ status: 409, code: "conflict", message: "This request was withdrawn." }), withdrawn)).toMatchObject({
      panel: null, failure: "This request from Wanjiku Mwangi was withdrawn, so nothing changed.",
    });
    expect(settleAnswer(posted({ status: 409, code: "conflict" }), { ...acceptedMentorRequest, id: ID }).failure).toContain("was already accepted, so nothing changed.");
    const reported = { ...pendingMentorRequest, check: "reported" as const };
    expect(settleAnswer(posted({ status: 409, code: "conflict", message: "You reported this request. TTV is checking it." }), reported)).toMatchObject({
      panel: null, failure: "You reported this request. TTV is checking it.",
    });
  });
});
