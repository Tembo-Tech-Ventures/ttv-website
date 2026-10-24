import { describe, it, expect } from "vitest";
import { validateBrowserAssessment } from "./staging-browser-assessment.mjs";
const entries = [{ id: "entry", version: 1, confirmations: [{ id: "confirmation", journeyVersion: 1 }] }];
const result = () => ({ probe: { claimed: true, payloadBytes: 4000, payloadCharacters: 4000 }, assessment: { status: "completed", model: "workers-ai/@cf/google/gemma-4-26b-a4b-it", subject: { userId: "member" }, criteria: [{ criterionId: "criterion-1", status: "assessed", rating: 2, citations: [{ kind: "journey", id: "entry", version: 1, userId: "member" }] }] } });
describe("browser assessment evidence", () => {
  it("accepts the same member's current journey and confirmation references", () => {
    const value = result();
    expect(validateBrowserAssessment(value, "member", entries)).toEqual({ rating: 2, citationCount: 1 });
    value.assessment.criteria[0].citations[0] = { kind: "confirmation", id: "confirmation", version: 1, userId: "member" };
    expect(validateBrowserAssessment(value, "member", entries)).toEqual({ rating: 2, citationCount: 1 });
  });
  it("accepts current profile citations alongside journey evidence and rejects stale profile versions", () => {
    const value = result();
    value.assessment.subject.profileVersion = 2;
    value.assessment.criteria[0].citations.push({ kind: "profile", id: "member", version: 2, userId: "member" });
    expect(validateBrowserAssessment(value, "member", entries, 2)).toEqual({ rating: 2, citationCount: 2 });
    expect(() => validateBrowserAssessment(value, "member", entries, 3)).toThrow(/Expected values to be strictly equal/);
    value.assessment.criteria[0].citations = [value.assessment.criteria[0].citations[1]];
    expect(() => validateBrowserAssessment(value, "member", entries, 2)).toThrow(/assertion failed|falsy/i);
  });
  it.each([{ version: 0 }, { id: "unknown" }, { userId: "other" }, { kind: "profile" }])("rejects stale/foreign evidence %j", change => {
    const value = result(); Object.assign(value.assessment.criteria[0].citations[0], change);
    expect(() => validateBrowserAssessment(value, "member", entries)).toThrow(/.*/);
  });
  it.each([false, undefined])("requires a consumed bounded provider claim %s", claimed => {
    const value = result(); value.probe.claimed = claimed;
    expect(() => validateBrowserAssessment(value, "member", entries)).toThrow(/.*/);
  });
  it("rejects invalid output, unscored evidence and missing citation instead of claiming UI success", () => {
    for (const change of [{ status: "insufficient", rating: null }, { rating: 6 }, { citations: [] }]) {
      const value = result(); Object.assign(value.assessment.criteria[0], change);
      expect(() => validateBrowserAssessment(value, "member", entries)).toThrow(/.*/);
    }
  });
});
