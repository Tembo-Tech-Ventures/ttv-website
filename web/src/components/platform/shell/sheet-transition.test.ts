import { describe, expect, it, vi } from "vitest";
import { keepsSheet, SHEET_STORAGE_KEY, sheetTransitionScript, type SheetKey } from "./sheet-transition";

const ORIGIN = "https://tembotechventures.com";

describe("keepsSheet", () => {
  it("keeps the sheet while the space stays, whatever the path", () => {
    const from = { url: `${ORIGIN}/admin/programs/p1`, sheet: "space:admin" };
    expect(keepsSheet(from, { url: `${ORIGIN}/admin/programs/p1`, sheet: "space:admin" })).toBe(true);
    expect(keepsSheet(from, { url: `${ORIGIN}/admin/users`, sheet: "space:admin" })).toBe(true);
  });

  it("moves the sheet between spaces, even on one path (the DEV harness switches by query)", () => {
    expect(
      keepsSheet(
        { url: `${ORIGIN}/dev/platform-shell?space=cohort`, sheet: "space:cohort" },
        { url: `${ORIGIN}/dev/platform-shell?space=community`, sheet: "space:community" },
      ),
    ).toBe(false);
    expect(keepsSheet({ url: `${ORIGIN}/dashboard/cohort`, sheet: "space:cohort" }, { url: `${ORIGIN}/admin`, sheet: "space:admin" })).toBe(false);
  });

  it("moves it from one onboarding step to the next, or into a space, but not on a rejected post-back", () => {
    const choose = { url: `${ORIGIN}/dashboard/welcome`, sheet: "onboarding:choose" };
    expect(keepsSheet(choose, { url: `${ORIGIN}/dashboard/welcome?step=request`, sheet: "onboarding:request" })).toBe(false);
    expect(keepsSheet(choose, { url: `${ORIGIN}/dashboard/community`, sheet: "space:community" })).toBe(false);
    expect(keepsSheet(choose, { url: `${ORIGIN}/dashboard/welcome`, sheet: "onboarding:choose" })).toBe(true);
  });

  it("without a record of the page left, keeps it only for a post-back to the same path", () => {
    const to = { url: `${ORIGIN}/admin/programs/p1?saved=1`, sheet: "space:admin" };
    expect(keepsSheet({ url: `${ORIGIN}/admin/programs/p1`, sheet: null }, to)).toBe(true);
    expect(keepsSheet({ url: `${ORIGIN}/dashboard/cohort`, sheet: null }, to)).toBe(false);
  });
});

/** Runs the shipped inline script against a stand-in page, as the browser would before first render. */
function page(sheet: SheetKey, href: string, options: { storage?: Map<string, string>; from?: string | null } = {}) {
  const storage = options.storage ?? new Map<string, string>();
  const listeners = new Map<string, (event: Event) => void>();
  const sessionStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
  };
  const fakeGlobal = { navigation: { activation: options.from === undefined ? null : { from: options.from === null ? null : { url: options.from } } } };
  // oxlint-disable-next-line no-new-func -- the script is ours, and evaluating it as the browser would is the point
  new Function("addEventListener", "sessionStorage", "location", "globalThis", sheetTransitionScript(sheet))(
    (type: string, listener: (event: Event) => void) => listeners.set(type, listener),
    sessionStorage,
    { href },
    fakeGlobal,
  );
  return {
    storage,
    /** Fires pagereveal with a transition and reports whether the script skipped it. */
    reveal(withTransition = true) {
      const skipTransition = vi.fn();
      listeners.get("pagereveal")?.(Object.assign(new Event("pagereveal"), { viewTransition: withTransition ? { skipTransition } : null }));
      return skipTransition.mock.calls.length > 0;
    },
    leave: () => listeners.get("pageswap")?.(new Event("pageswap")),
  };
}

describe("sheetTransitionScript", () => {
  const programs = `${ORIGIN}/admin/programs/p1`;

  it("skips the transition after a post-back in the same space", () => {
    const before = page("space:admin", programs);
    before.leave();
    expect(JSON.parse(before.storage.get(SHEET_STORAGE_KEY)!)).toEqual({ url: programs, sheet: "space:admin" });
    expect(page("space:admin", programs, { storage: before.storage, from: programs }).reveal()).toBe(true);
  });

  it("keeps it when the space changes", () => {
    const before = page("space:cohort", `${ORIGIN}/dashboard/cohort`);
    before.leave();
    expect(page("space:community", `${ORIGIN}/dashboard/community`, { storage: before.storage, from: `${ORIGIN}/dashboard/cohort` }).reveal()).toBe(false);
  });

  it("ignores a record left by another page, and falls back to comparing paths", () => {
    const storage = new Map([[SHEET_STORAGE_KEY, JSON.stringify({ url: `${ORIGIN}/dashboard/cohort`, sheet: "space:admin" })]]);
    expect(page("space:admin", `${ORIGIN}/admin/users`, { storage, from: `${ORIGIN}/dashboard/community` }).reveal()).toBe(false);
    expect(page("space:admin", programs, { storage, from: programs }).reveal()).toBe(true);
    storage.set(SHEET_STORAGE_KEY, "not json");
    expect(page("space:admin", programs, { storage, from: programs }).reveal()).toBe(true);
  });

  it("leaves a first load, a cross-origin arrival and reduced motion (no transition) alone", () => {
    expect(page("space:admin", programs).reveal()).toBe(false);
    expect(page("space:admin", programs, { from: null }).reveal()).toBe(false);
    expect(page("space:admin", programs, { from: programs }).reveal(false)).toBe(false);
  });

  it("escapes the key so it cannot close its script element", () => {
    expect(sheetTransitionScript("space:</script>")).not.toContain("</script>");
  });
});
