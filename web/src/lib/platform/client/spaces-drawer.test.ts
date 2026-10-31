import { describe, expect, it } from "vitest";
import { CLOSED_DRAWER, spacesDrawerReducer as reduce } from "./spaces-drawer";

describe("drawer keyboard state", () => {
  it("opens at the first item, traps forward/backward Tab and returns focus on Escape", () => {
    let state = reduce(CLOSED_DRAWER, { type: "open", itemCount: 3 });
    expect(state).toEqual({ open: true, focusIndex: 0, focusTarget: "drawer" });
    state = reduce(state, { type: "key", key: "Tab", shiftKey: true, itemCount: 3 });
    expect(state.focusIndex).toBe(2);
    state = reduce(state, { type: "key", key: "Tab", itemCount: 3 });
    expect(state.focusIndex).toBe(0);
    state = reduce(state, { type: "focus", index: 1, itemCount: 3 });
    expect(state.focusTarget).toBeNull();
    state = reduce(state, { type: "key", key: "Tab", itemCount: 3 });
    expect(state.focusIndex).toBe(2);
    state = reduce(state, { type: "key", key: "Escape", itemCount: 3 });
    expect(state).toEqual({ open: false, focusIndex: null, focusTarget: "trigger" });
    expect(reduce(state, { type: "close" })).toBe(state);
    expect(reduce(state, { type: "key", key: "Tab", itemCount: 3 })).toBe(state);
  });
  it("leaves activation and unrelated keys to native links/buttons", () => {
    const state = reduce(CLOSED_DRAWER, { type: "open", itemCount: 1 });
    for (const key of ["Enter", " ", "ArrowDown", "Home", "End", "a"]) {
      expect(reduce(state, { type: "key", key, itemCount: 1 })).toBe(state);
    }
    expect(reduce(state, { type: "key", key: "Tab", itemCount: 1 }).focusIndex).toBe(0);
  });
  it.each([0, -1, 1.5, NaN, Infinity])("keeps an empty/invalid list (%s) focusable at the container", itemCount => {
    const state = reduce(CLOSED_DRAWER, { type: "open", itemCount });
    expect(state.focusIndex).toBeNull();
    for (const shiftKey of [false, true]) {
      expect(reduce(state, { type: "key", key: "Tab", shiftKey, itemCount })).toEqual(state);
    }
  });
  it("handles items removed while open and ignores invalid focus indexes", () => {
    let state = reduce(CLOSED_DRAWER, { type: "open", itemCount: 3 });
    for (const index of [-1, 3, 1.5, NaN]) expect(reduce(state, { type: "focus", index, itemCount: 3 })).toBe(state);
    state = reduce(state, { type: "focus", index: 2, itemCount: 3 });
    expect(reduce(state, { type: "key", key: "Tab", itemCount: 1 }).focusIndex).toBe(0);
    const empty = reduce(state, { type: "open", itemCount: 0 });
    expect(reduce(empty, { type: "key", key: "Tab", shiftKey: true, itemCount: 3 }).focusIndex).toBe(2);
    expect(reduce(CLOSED_DRAWER, { type: "focus", index: 0, itemCount: 3 })).toBe(CLOSED_DRAWER);
  });
});
