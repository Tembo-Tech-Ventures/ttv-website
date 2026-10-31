// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { isSearchShortcut, onShellOverlay, requestShellOverlay, SHELL_OVERLAY_EVENT } from "./overlays";

const key = (overrides: Partial<KeyboardEventInit> = {}) =>
  new KeyboardEvent("keydown", { key: "k", ctrlKey: true, ...overrides });

describe("isSearchShortcut", () => {
  it("accepts Ctrl K and ⌘ K, in either case", () => {
    expect(isSearchShortcut(key())).toBe(true);
    expect(isSearchShortcut(key({ ctrlKey: false, metaKey: true }))).toBe(true);
    expect(isSearchShortcut(key({ key: "K" }))).toBe(true);
  });

  it("ignores a bare K, other modifiers and keys mid-composition", () => {
    expect(isSearchShortcut(key({ ctrlKey: false }))).toBe(false);
    expect(isSearchShortcut(key({ altKey: true }))).toBe(false);
    expect(isSearchShortcut(key({ shiftKey: true }))).toBe(false);
    expect(isSearchShortcut(key({ key: "j" }))).toBe(false);
    expect(isSearchShortcut({ ...key(), key: "k", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, isComposing: true })).toBe(false);
  });
});

describe("overlay requests", () => {
  it("reach only the overlay they name, with the trigger and how it was asked", () => {
    const search = vi.fn();
    const attention = vi.fn();
    const stopSearch = onShellOverlay("search", search);
    const stopAttention = onShellOverlay("attention", attention);
    const trigger = document.createElement("button");

    requestShellOverlay({ overlay: "search", trigger, via: "shortcut" });
    expect(search).toHaveBeenCalledWith({ overlay: "search", trigger, via: "shortcut" });
    expect(attention).not.toHaveBeenCalled();

    stopSearch();
    requestShellOverlay({ overlay: "search", trigger: null, via: "click" });
    expect(search).toHaveBeenCalledTimes(1);
    stopAttention();
  });

  it("ignores unrelated events on the same name", () => {
    const handler = vi.fn();
    const stop = onShellOverlay("attention", handler);
    window.dispatchEvent(new CustomEvent(SHELL_OVERLAY_EVENT));
    window.dispatchEvent(new CustomEvent(SHELL_OVERLAY_EVENT, { detail: { overlay: "elsewhere" } }));
    expect(handler).not.toHaveBeenCalled();
    stop();
  });
});
