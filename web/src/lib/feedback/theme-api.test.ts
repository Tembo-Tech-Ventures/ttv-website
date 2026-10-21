import { describe, expect, it } from "vitest";
import { feedbackUpdateFromForm, parseFeedbackUpdate } from "./api";
import { parseThemeCreate, parseThemeUpdate, themeUpdateFromForm } from "./theme-api";

describe("parseThemeCreate", () => {
  it("normalises a new theme and defaults its change to undecided", () => {
    expect(parseThemeCreate({ title: " Dark  mode ", kind: "IDEA" })).toEqual({
      title: "Dark mode",
      summary: "",
      kind: "IDEA",
      change: null,
    });
    expect(parseThemeCreate({ title: "x", kind: "BUG", change: "FIX", summary: "s" }).change).toBe("FIX");
  });

  it("rejects unknown fields and changes", () => {
    expect(() => parseThemeCreate({ title: "x", kind: "IDEA", students: ["amina"] })).toThrow(
      "Unknown field: students."
    );
    expect(() => parseThemeCreate({ title: "x", kind: "IDEA", change: "REWRITE" })).toThrow(/FIX, SIMPLIFY, ADD/);
    expect(() => parseThemeCreate(null)).toThrow("Send a JSON object.");
  });
});

describe("parseThemeUpdate", () => {
  it("requires a message for students before shipping or declining", () => {
    expect(() => parseThemeUpdate({ status: "SHIPPED" })).toThrow(/needs a studentMessage/);
    expect(() => parseThemeUpdate({ status: "DECLINED", studentMessage: "  " })).toThrow(/needs a studentMessage/);
    expect(parseThemeUpdate({ status: "SHIPPED", studentMessage: "Done!", prUrl: "https://x/pull/1" })).toEqual({
      patch: { status: "SHIPPED", prUrl: "https://x/pull/1" },
      studentMessage: "Done!",
    });
  });

  it("validates links, status and emptiness", () => {
    expect(() => parseThemeUpdate({ issueUrl: "ftp://x" })).toThrow(/http\(s\)/);
    expect(() => parseThemeUpdate({ status: "DONE" })).toThrow("Unknown theme status.");
    expect(() => parseThemeUpdate({ studentMessage: "hi" })).toThrow("Nothing to update.");
    expect(parseThemeUpdate({ change: null, issueUrl: null }).patch).toEqual({ change: null, issueUrl: null });
  });

  it("reads the console form, treating blank fields as clearing them", () => {
    const form = new FormData();
    form.set("title", "Dark mode");
    form.set("summary", "");
    form.set("status", "PLANNED");
    form.set("kind", "IDEA");
    form.set("change", "");
    form.set("issueUrl", "");
    form.set("prUrl", "");
    form.set("studentMessage", "");
    form.set("decisionNote", "Approved in the 2026-10-26 digest");
    expect(themeUpdateFromForm(form)).toEqual({
      patch: {
        title: "Dark mode",
        summary: "",
        status: "PLANNED",
        kind: "IDEA",
        change: null,
        issueUrl: null,
        prUrl: null,
        decisionNote: "Approved in the 2026-10-26 digest",
      },
      studentMessage: null,
    });
  });
});

describe("note theme fields", () => {
  it("accepts a theme id, null, and a sensitive flag", () => {
    expect(parseFeedbackUpdate({ themeId: "t1" }).patch).toEqual({ themeId: "t1" });
    expect(parseFeedbackUpdate({ themeId: null, sensitive: true }).patch).toEqual({
      themeId: null,
      sensitive: true,
    });
    expect(() => parseFeedbackUpdate({ themeId: "" })).toThrow(/theme id or null/);
    expect(() => parseFeedbackUpdate({ sensitive: "yes" })).toThrow(/true or false/);
  });

  it("reads the console's theme select and sensitive checkbox", () => {
    const form = new FormData();
    form.set("status", "NEW");
    form.set("themeId", "");
    expect(feedbackUpdateFromForm(form).patch).toMatchObject({ themeId: null, sensitive: false });
    form.set("themeId", "t1");
    form.set("sensitive", "on");
    expect(feedbackUpdateFromForm(form).patch).toMatchObject({ themeId: "t1", sensitive: true });
  });
});
