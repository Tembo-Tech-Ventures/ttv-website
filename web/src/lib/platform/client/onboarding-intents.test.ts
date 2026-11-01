import { describe, expect, it } from "vitest";
import { Intent, IntentSet, type OnboardingState } from "../contracts";
import { onboardingByPersona } from "../fixtures";
import {
  initialSelection, intentSelectionReducer, parseIntentHint, type IntentSelection, type IntentSelectionAction,
} from "./onboarding-intents";

const selection = (intents: Intent[], extra: Partial<IntentSelection> = {}): IntentSelection => ({ intents, empty: false, dirty: false, ...extra });
const reduce = (state: IntentSelection, ...actions: IntentSelectionAction[]) => actions.reduce(intentSelectionReducer, state);

describe("intent selection reducer", () => {
  it.each<[string, Intent[], Intent, Intent[]]>([
    ["adds a first intent", [], "MENTOR", ["MENTOR"]],
    ["combines member, mentor and institution in canonical order", ["INSTITUTION", "MEMBER"], "MENTOR", ["MEMBER", "MENTOR", "INSTITUTION"]],
    ["removes a selected intent", ["MEMBER", "MENTOR"], "MEMBER", ["MENTOR"]],
    ["EXPLORING replaces every other intent", ["MEMBER", "MENTOR", "INSTITUTION"], "EXPLORING", ["EXPLORING"]],
    ["any other intent replaces EXPLORING", ["EXPLORING"], "INSTITUTION", ["INSTITUTION"]],
    ["EXPLORING can be switched off again", ["EXPLORING"], "EXPLORING", []],
  ])("toggle: %s", (_name, from, intent, expected) => {
    const next = intentSelectionReducer(selection(from, { empty: true }), { type: "toggle", intent });
    expect(next).toEqual({ intents: expected, empty: false, dirty: true });
  });

  it("keeps EXPLORING exclusive under every toggle sequence", () => {
    // Every sequence of four toggles over the four intents: 256 paths, each step checked against the contract.
    for (let code = 0; code < 4 ** 4; code++) {
      let state = selection([]);
      for (let step = 0; step < 4; step++) {
        state = intentSelectionReducer(state, { type: "toggle", intent: Intent.options[Math.floor(code / 4 ** step) % 4] });
        expect(IntentSet.safeParse(state.intents).success).toBe(true);
        expect(state.intents).toEqual(Intent.options.filter(intent => state.intents.includes(intent)));
      }
    }
  });

  it("'I'm just looking around' selects EXPLORING alone", () => {
    expect(intentSelectionReducer(selection(["MEMBER", "MENTOR"], { empty: true }), { type: "explore" }))
      .toEqual({ intents: ["EXPLORING"], empty: false, dirty: true });
  });

  it("continue with nothing chosen raises the empty error once, and choosing clears it", () => {
    const empty = intentSelectionReducer(selection([]), { type: "continue" });
    expect(empty).toEqual({ intents: [], empty: true, dirty: false });
    expect(intentSelectionReducer(empty, { type: "continue" })).toBe(empty);
    const chosen = selection(["MEMBER"]);
    expect(intentSelectionReducer(chosen, { type: "continue" })).toBe(chosen);
    expect(intentSelectionReducer(empty, { type: "toggle", intent: "MEMBER" }).empty).toBe(false);
  });

  it.each<[unknown, Intent | null]>([
    ["mentor", "MENTOR"], ["institution", "INSTITUTION"], ["member", "MEMBER"], ["MENTOR", "MENTOR"], ["Institution", "INSTITUTION"],
    ["exploring", null], ["EXPLORING", null], ["admin", null], ["", null], [" mentor", null], ["constructor", null],
    ["__proto__", null], [undefined, null], [null, null], [["mentor"], null], [{ intent: "mentor" }, null],
  ])("parses the partner-page hint %j as %j", (value, expected) => expect(parseIntentHint(value)).toBe(expected));

  it("a hint preselects a card, adds to existing choices and never selects EXPLORING", () => {
    expect(intentSelectionReducer(selection(["MEMBER"]), { type: "hint", intent: "mentor" }))
      .toEqual({ intents: ["MEMBER", "MENTOR"], empty: false, dirty: true });
    expect(intentSelectionReducer(selection(["EXPLORING"]), { type: "hint", intent: "institution" }).intents).toEqual(["INSTITUTION"]);
    const held = selection(["MENTOR"]);
    expect(intentSelectionReducer(held, { type: "hint", intent: "mentor" })).toBe(held);
    expect(intentSelectionReducer(held, { type: "hint", intent: "exploring" })).toBe(held);
    expect(intentSelectionReducer(held, { type: "hint", intent: "admin" })).toBe(held);
  });

  describe("sync with server truth", () => {
    it("replaces a clean selection, and any selection on first load", () => {
      expect(intentSelectionReducer(selection(["MEMBER"]), { type: "sync", from: ["MEMBER"], to: ["MENTOR", "MEMBER"] }))
        .toEqual({ intents: ["MEMBER", "MENTOR"], empty: false, dirty: false });
      expect(intentSelectionReducer(selection(["MEMBER"], { dirty: true, empty: true }), { type: "sync", from: null, to: ["INSTITUTION"] }))
        .toEqual({ intents: ["INSTITUTION"], empty: false, dirty: false });
    });

    it.each<[string, Intent[], Intent[], Intent[], Intent[], boolean]>([
      ["a withdraw removes the intent but keeps local additions", ["MEMBER", "MENTOR", "INSTITUTION"], ["MEMBER", "MENTOR"], ["MEMBER"], ["MEMBER", "INSTITUTION"], true],
      ["a server addition joins local edits", ["MEMBER"], [], ["MENTOR"], ["MEMBER", "MENTOR"], true],
      ["a server EXPLORING replaces local edits", ["MEMBER"], [], ["EXPLORING"], ["EXPLORING"], false],
      ["a server addition drops a local EXPLORING", ["EXPLORING"], [], ["MENTOR"], ["MENTOR"], false],
      ["a locally removed intent the server still holds stays removed", ["MEMBER"], ["MEMBER", "MENTOR"], ["MEMBER", "MENTOR"], ["MEMBER"], true],
      ["edits that now match the server become clean", ["MEMBER", "MENTOR"], ["MEMBER"], ["MEMBER", "MENTOR"], ["MEMBER", "MENTOR"], false],
    ])("dirty: %s", (_name, local, from, to, expected, dirty) => {
      const next = intentSelectionReducer(selection(local, { dirty: true }), { type: "sync", from, to });
      expect(next).toEqual({ intents: expected, empty: false, dirty });
      expect(IntentSet.safeParse(next.intents).success).toBe(true);
    });

    it("keeps the empty error only while still empty", () => {
      const empty = selection([], { dirty: true, empty: true });
      expect(intentSelectionReducer(empty, { type: "sync", from: [], to: [] }).empty).toBe(true);
      expect(intentSelectionReducer(empty, { type: "sync", from: [], to: ["MEMBER"] }).empty).toBe(false);
    });
  });

  it("never mutates its input", () => {
    const state = selection(["MEMBER", "MENTOR"], { dirty: true });
    const frozen = structuredClone(state);
    reduce(state, { type: "toggle", intent: "EXPLORING" }, { type: "hint", intent: "institution" }, { type: "continue" },
      { type: "sync", from: ["MEMBER"], to: ["INSTITUTION"] }, { type: "explore" });
    expect(state).toEqual(frozen);
  });
});

describe("initial selection", () => {
  const base: OnboardingState = onboardingByPersona.wairimu;

  it("starts from saved intents, or prefills inferred ones when nothing is saved (S4)", () => {
    expect(initialSelection(onboardingByPersona.mercyAkinyi).intents).toEqual(["MEMBER", "MENTOR"]);
    expect(initialSelection({ ...base, stage: "PROMPT", inferred: ["MENTOR", "MEMBER"] }).intents).toEqual(["MEMBER", "MENTOR"]);
    expect(initialSelection({ ...base, intents: ["INSTITUTION"], inferred: ["MEMBER"] }).intents).toEqual(["INSTITUTION"]);
    expect(initialSelection(null)).toEqual({ intents: [], empty: false, dirty: false });
  });

  it("applies the hint on top, in revisit mode too", () => {
    expect(initialSelection(base, "institution")).toEqual({ intents: ["INSTITUTION"], empty: false, dirty: true });
    expect(initialSelection(onboardingByPersona.mercyAkinyi, "institution").intents).toEqual(["MEMBER", "MENTOR", "INSTITUTION"]);
    expect(initialSelection(base, "nonsense")).toEqual({ intents: [], empty: false, dirty: false });
  });
});
