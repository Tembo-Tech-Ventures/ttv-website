import { describe, expect, it } from "vitest";
import { readConfirmPost, runConfirmPost, splitContributions } from "./confirm-state";
import type { MentorReviewRequest } from "@/components/community/community-types";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const answering = (status: number, body: unknown = {}): typeof fetch => async () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("readConfirmPost", () => {
  it("reads this page's three forms, and nothing else", () => {
    expect(readConfirmPost(form({ intent: "set-aside", id: "j1", revision: "2", title: "Ledger" }))).toMatchObject({
      intent: "set-aside", id: "j1", expectedRevision: 2, title: "Ledger",
    });
    expect(readConfirmPost(form({ intent: "publish", id: "j1", revision: "2" }))).toBeNull();
    expect(readConfirmPost(form({ intent: "confirm", id: "", revision: "2" }))).toBeNull();
    expect(readConfirmPost(form({ intent: "confirm", id: "j1", revision: "0" }))).toBeNull();
    expect(readConfirmPost(form({ intent: "confirm", id: "j1", revision: "1.5" }))).toBeNull();
  });
});

describe("runConfirmPost", () => {
  const post = { intent: "confirm" as const, id: "j1", expectedRevision: 1, title: "Ledger", method: "Ran its tests", note: "I ran the ledger's tests and read its code." };

  it("refuses a thin note before asking the API, keeping what was written", async () => {
    const never: typeof fetch = async () => { throw new Error("not called"); };
    const outcome = await runConfirmPost({ ...post, note: "fine" }, never);
    expect(outcome).toMatchObject({ ok: false, status: 400, kept: { note: "fine", method: "Ran its tests" } });
    expect(outcome.ok === false && outcome.kept?.errors.note).toMatch(/20 characters/);
  });

  it("says a moved revision is a 409 and keeps the note", async () => {
    const outcome = await runConfirmPost(post, answering(409));
    expect(outcome).toMatchObject({ ok: false, status: 409, kept: { note: post.note } });
  });

  it("reads a server failure as a 503, never as the mentor's fault", async () => {
    expect(await runConfirmPost(post, answering(500))).toMatchObject({ ok: false, status: 503 });
    expect(await runConfirmPost({ ...post, intent: "undo" }, answering(502))).toMatchObject({ ok: false, status: 503, kept: null });
  });

  it("answers a recorded confirmation with a flash naming it", async () => {
    const outcome = await runConfirmPost(post, answering(201, { confirmation: { id: "c1", journeyVersion: 1 } }));
    expect(outcome).toEqual({ ok: true, flash: { tone: "success", title: "Confirmed: Ledger" } });
  });
});

describe("splitContributions", () => {
  it("counts only listed work that still waits", () => {
    const request = (id: string, status: MentorReviewRequest["status"], setAside = false): MentorReviewRequest => ({
      id, version: 1, memberName: "Achieng", claimTitle: id, claimDescription: "", evidence: [], status, setAside,
    });
    const { listed, setAside, waiting } = splitContributions([request("a", "pending"), request("b", "confirmed"), request("c", "pending", true)]);
    expect(listed.map((r) => r.id)).toEqual(["a", "b"]);
    expect(setAside.map((r) => r.id)).toEqual(["c"]);
    expect(waiting).toBe(1);
  });
});
