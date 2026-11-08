import { describe, expect, it, vi } from "vitest";
import type { UpdateMentorAvailability } from "@/lib/platform/contracts";
import { availability } from "@/lib/platform/fixtures";
import { handleAvailabilityPost, validateAvailability, valuesOf } from "./availability-post";

const ORIGIN = "https://ttv.test";
const PAGE = `${ORIGIN}/dashboard/mentoring/availability`;

function post(fields: [string, string][], origin: string | null = ORIGIN): Request {
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
  if (origin) headers.set("Origin", origin);
  return new Request(PAGE, { method: "POST", headers, body: new URLSearchParams(fields) });
}

const VALID: [string, string][] = [
  ["headline", "  Backend engineer · payments "], ["areas", " Mobile \r\n\r\nKotlin\n"], ["formats", "QUICK_QUESTION"],
  ["formats", "WRITTEN_REVIEW"], ["monthlyCapacity", " 2 "], ["bio", " Hi "],
];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const save = (reply: Response | Error) => vi.fn<(body: UpdateMentorAvailability) => Promise<Response>>(async () => {
  if (reply instanceof Error) throw reply;
  return reply;
});

describe("saving availability without JavaScript", () => {
  it("sends the API a trimmed body, one area a line and the formats in the contract's order", async () => {
    const send = save(json(200, availability));
    expect(await handleAvailabilityPost(post(VALID), send)).toEqual({ kind: "saved" });
    expect(send).toHaveBeenCalledWith({
      headline: "Backend engineer · payments", areas: ["Mobile", "Kotlin"], formats: ["WRITTEN_REVIEW", "QUICK_QUESTION"],
      monthlyCapacity: 2, bio: "Hi", paused: false,
    });
  });

  it("refuses a cross-site or oversized post before reading it", async () => {
    const send = save(json(200, availability));
    expect(await handleAvailabilityPost(post(VALID, "https://elsewhere.test"), send)).toEqual({ kind: "refuse", status: 403 });
    expect(await handleAvailabilityPost(post(VALID, null), send)).toEqual({ kind: "refuse", status: 403 });
    expect(await handleAvailabilityPost(post([...VALID, ["bio", "x".repeat(40_000)]]), send)).toEqual({ kind: "refuse", status: 413 });
    expect(send).not.toHaveBeenCalled();
  });

  it("explains each field to fix in the old editor's words, and keeps what was typed", async () => {
    const send = save(json(200, availability));
    const areas = ["Mobile", "mobile", "x".repeat(41)].join("\n");
    const result = await handleAvailabilityPost(post([["headline", ""], ["areas", areas], ["monthlyCapacity", "2.5"], ["bio", "x".repeat(2001)]]), send);
    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: "render", status: 400, failure: null,
      values: { headline: "", areas, formats: [], monthlyCapacity: "2.5", bio: "x".repeat(2001), paused: false },
      errors: {
        headline: "Write a headline of up to 120 characters.",
        areas: "List up to 20 areas, each once and up to 40 characters.",
        formats: "Offer at least one way to help.",
        monthlyCapacity: "Choose a number from 0 to 20.",
        bio: "Keep the bio to 2000 characters.",
      },
    });
  });

  it("takes the saved availability as it is", () => {
    expect(validateAvailability(valuesOf(availability))).toEqual({
      ok: true,
      body: { headline: availability.headline, areas: availability.areas, formats: availability.formats, monthlyCapacity: availability.monthlyCapacity, bio: availability.bio, paused: availability.paused },
    });
  });

  it("says the API's refusal, or a failed save, with everything kept", async () => {
    const refused = await handleAvailabilityPost(post(VALID), save(json(403, { error: { code: "forbidden", message: "Only mentors have availability." } })));
    expect(refused).toMatchObject({
      kind: "render", status: 403, errors: {},
      failure: { title: "Couldn't save your availability", detail: "Only mentors have availability. Everything you wrote is still here." },
      values: { headline: "  Backend engineer · payments " },
    });
    for (const failure of [json(500, { error: { code: "server", message: "Could not complete the mentor request." } }), new Error("network")]) {
      const result = await handleAvailabilityPost(post(VALID), save(failure));
      expect(result).toMatchObject({
        kind: "render", status: 500,
        failure: { title: "Couldn't save your availability", detail: "Everything you wrote is still here. Try saving again in a moment." },
      });
    }
  });
});
