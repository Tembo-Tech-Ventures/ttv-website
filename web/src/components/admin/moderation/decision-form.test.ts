import { describe, expect, it } from "vitest";
import { REASON_MAX, isDecisionRefusal, parseDecisionForm, refusalMessage, refusalStatus } from "./decision-form";

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};

describe("parseDecisionForm", () => {
  it("accepts a decision with a trimmed reason", () => {
    expect(parseDecisionForm(form({ messageId: "m1", action: "hide", reason: "  Off topic  " })))
      .toEqual({ ok: true, messageId: "m1", action: "hide", reason: "Off topic" });
  });

  it.each(["hide", "restore", "keep"])("accepts %s", (action) => {
    expect(parseDecisionForm(form({ messageId: "m1", action, reason: "r" })).ok).toBe(true);
  });

  it("requires a reason, keeping the case it belongs to", () => {
    expect(parseDecisionForm(form({ messageId: "m1", action: "keep", reason: "   " })))
      .toEqual({ ok: false, messageId: "m1", reason: "", error: "Write a reason. It is kept with your decision." });
  });

  it("refuses an action that is not a decision", () => {
    const parsed = parseDecisionForm(form({ messageId: "m1", action: "delete", reason: "x" }));
    expect(parsed).toMatchObject({ ok: false, messageId: "m1", reason: "x" });
  });

  it("refuses a missing case without inventing one", () => {
    expect(parseDecisionForm(form({ action: "hide", reason: "x" }))).toMatchObject({ ok: false, messageId: null });
  });

  it("refuses a reason over the limit, and keeps it to edit", () => {
    const long = "a".repeat(REASON_MAX + 1);
    expect(parseDecisionForm(form({ messageId: "m1", action: "hide", reason: long })))
      .toEqual({ ok: false, messageId: "m1", reason: long, error: `Keep the reason under ${REASON_MAX} characters.` });
  });
});

describe("refusals", () => {
  class Refused extends Error {
    constructor(readonly status: number, message = "Refused") { super(message); }
  }

  it("recognises an error that carries a status", () => {
    expect(isDecisionRefusal(new Refused(409))).toBe(true);
    expect(isDecisionRefusal(new Error("boom"))).toBe(false);
    expect(isDecisionRefusal({ status: 409 })).toBe(false);
  });

  it.each([400, 403, 404, 409, 429, 500, 503])("says nothing changed for %i", (status) => {
    expect(refusalMessage(new Refused(status))).toMatch(/^Nothing changed\./);
  });

  it("says why a decision conflicted, in the server's words when it gave them", () => {
    expect(refusalMessage(new Refused(409, "This message was deleted.")))
      .toBe("Nothing changed. This message was deleted. The case below is as it stands now.");
    expect(refusalMessage(new Refused(409, " "))).toContain("Someone decided this case");
  });

  it("passes the server's validation message through", () => {
    expect(refusalMessage(new Refused(400, "Reason is too long."))).toBe("Nothing changed. Reason is too long.");
  });

  it("answers with the refusal's own status, or 500", () => {
    expect(refusalStatus({ status: 409 })).toBe(409);
    expect(refusalStatus({ status: 200 })).toBe(500);
    expect(refusalStatus({ status: 302 })).toBe(500);
  });
});
