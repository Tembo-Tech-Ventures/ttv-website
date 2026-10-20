import { describe, expect, it } from "vitest";
import { feedbackUpdateFromForm, parseFeedbackUpdate } from "./api";

describe("parseFeedbackUpdate", () => {
  it("passes through only the fields that were sent", () => {
    expect(parseFeedbackUpdate({ status: "RESOLVED" })).toEqual({
      patch: { status: "RESOLVED" },
      expectedStatus: undefined,
    });
    expect(
      parseFeedbackUpdate({ response: null, expectedStatus: "NEW", adminNote: " note " })
    ).toEqual({ patch: { response: null, adminNote: "note" }, expectedStatus: "NEW" });
  });

  it("rejects non-objects, unknown fields and empty updates", () => {
    expect(() => parseFeedbackUpdate([])).toThrow("Send a JSON object.");
    expect(() => parseFeedbackUpdate({ owner: "x", tag: 1 })).toThrow(
      "Unknown fields: owner, tag."
    );
    expect(() => parseFeedbackUpdate({ expectedStatus: "NEW" })).toThrow("Nothing to update.");
    expect(() => parseFeedbackUpdate({ status: "NEW", expectedStatus: "OPEN" })).toThrow(
      "Unknown expectedStatus."
    );
    expect(() => parseFeedbackUpdate({ response: "x".repeat(2_001) })).toThrow(
      "The reply must be 2,000 characters or fewer."
    );
  });
});

describe("feedbackUpdateFromForm", () => {
  it("treats blank fields as clearing them", () => {
    const formData = new FormData();
    formData.set("status", "DECLINED");
    formData.set("response", "");
    formData.set("adminNote", "Duplicate of an earlier note");
    formData.set("resolutionUrl", " ");
    expect(feedbackUpdateFromForm(formData)).toEqual({
      patch: {
        status: "DECLINED",
        response: null,
        adminNote: "Duplicate of an earlier note",
        resolutionUrl: null,
      },
      expectedStatus: undefined,
    });
  });
});
