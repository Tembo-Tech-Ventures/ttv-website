import { describe, expect, it } from "vitest";
import { meByPersona } from "@/lib/platform/fixtures";
import { awaitingConfirmation, awaitingConfirmationShort, awaitingConfirmationText } from "./awaiting-confirmation";

describe("awaitingConfirmation", () => {
  it("is zero without the Mentoring space, even if a payload carried a count", () => {
    expect(awaitingConfirmation(meByPersona.wanjiku)).toBe(0);
    expect(awaitingConfirmation({ ...meByPersona.wanjiku, mentoring: { awaitingConfirmation: 5 } })).toBe(0);
  });

  it("is the server's count for a mentor, and unknown (never zero) when the server sent none", () => {
    expect(awaitingConfirmation({ ...meByPersona.david, mentoring: { awaitingConfirmation: 4 } })).toBe(4);
    expect(awaitingConfirmation({ ...meByPersona.david, mentoring: { awaitingConfirmation: 0 } })).toBe(0);
    expect(awaitingConfirmation(meByPersona.david)).toBeNull();
  });
});

describe("awaitingConfirmationText", () => {
  it("counts in words a mentor can act on", () => {
    expect(awaitingConfirmationText(1)).toBe("1 shared contribution is waiting for your confirmation.");
    expect(awaitingConfirmationText(4)).toBe("4 shared contributions are waiting for your confirmation.");
  });
});

describe("awaitingConfirmationShort", () => {
  it("is the same count as a phrase for a control's name", () => {
    expect(awaitingConfirmationShort(1)).toBe("1 shared contribution to confirm");
    expect(awaitingConfirmationShort(4)).toBe("4 shared contributions to confirm");
  });
});
