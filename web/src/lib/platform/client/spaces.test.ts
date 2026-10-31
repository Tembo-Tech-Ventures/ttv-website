// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { Me } from "../contracts";
import { meByPersona } from "../fixtures";
import { createSpacesController, type SpacesBrowser } from "./spaces";
import { useSpaces } from "./hooks/spaces";

function cookies(initial = "", secure = true) {
  let value = initial;
  return { readCookie: vi.fn(() => value), writeCookie: vi.fn((next: string) => { value = next; }), isHTTPS: vi.fn(() => secure) };
}
afterEach(() => vi.restoreAllMocks());

describe("spaces controller", () => {
  it("is SSR safe, request isolated and never fetches or writes on construction/render", () => {
    expect(typeof window).toBe("undefined"); expect(typeof document).toBe("undefined");
    const fetch = vi.spyOn(globalThis, "fetch");
    const ports = cookies();
    const first = createSpacesController({ me: meByPersona.wanjiku, cookieHeader: "ttv-last-space=profile", browser: ports });
    const second = createSpacesController({ me: meByPersona.lucy });
    function View() { const state = useSpaces(first); return createElement("span", null, state.selectedSpace); }
    expect(renderToString(createElement(View))).toBe("<span>profile</span>");
    expect(ports.readCookie).not.toHaveBeenCalled(); expect(ports.writeCookie).not.toHaveBeenCalled();
    expect(first.getServerSnapshot()).toBe(first.getState());
    first.switchSpace("community");
    expect(first.getServerSnapshot().selectedSpace).toBe("profile");
    expect(second.getState().selectedSpace).toBe("community");
    expect(fetch).not.toHaveBeenCalled();
    // Default browser ports can also be invoked without window/document.
    expect(() => second.hydratePreference()).not.toThrow();
    expect(second.getState().preferenceStatus).toBe("unavailable");
  });
  it("hydrates a preference, lets an authorized URL win and writes the exact HTTPS cookie", () => {
    const ports = cookies("ttv-last-space=profile");
    const state = createSpacesController({ me: meByPersona.wanjiku, explicitSpace: "cohort", browser: ports });
    state.hydratePreference();
    expect(state.getState().selectedSpace).toBe("cohort");
    expect(ports.writeCookie).toHaveBeenLastCalledWith("ttv-last-space=cohort; Path=/dashboard; SameSite=Lax; Max-Age=31536000; Secure");
    expect(state.getState().preferenceStatus).toBe("saved");
    state.dispatchDrawer({ type: "open", itemCount: 4 });
    expect(state.switchSpace("profile")).toBe(true);
    expect(state.getState().selectedSpace).toBe("profile");
    expect(state.getState().drawer.open).toBe(false);
    expect(ports.writeCookie).toHaveBeenLastCalledWith(expect.stringContaining("ttv-last-space=profile;"));
  });
  it("hydrates the browser cookie only after the server snapshot and supports local HTTP", () => {
    const ports = cookies("ttv-last-space=profile", false);
    const state = createSpacesController({ me: meByPersona.lucy, browser: ports });
    expect(state.getState().selectedSpace).toBe("community");
    state.hydratePreference();
    expect(state.getState().selectedSpace).toBe("profile");
    expect(state.getServerSnapshot().selectedSpace).toBe("community");
    expect(ports.writeCookie).toHaveBeenLastCalledWith("ttv-last-space=profile; Path=/dashboard; SameSite=Lax; Max-Age=31536000");
  });
  it.each(["admin", "mentoring", "%70rofile", "bogus", ""])("rejects stale/inaccessible cookie %s and heals it", cookie => {
    const ports = cookies(`ttv-last-space=${cookie}`);
    const state = createSpacesController({ me: meByPersona.lucy, browser: ports });
    state.hydratePreference();
    expect(state.getState().selectedSpace).toBe("community");
    expect(state.switchSpace("admin")).toBe(false);
    expect(state.switchSpace(null)).toBe(false);
    expect(ports.writeCookie).toHaveBeenCalledTimes(1);
  });
  it("revalidates selection, drawer and identity against fresh Me on revocation/logout", () => {
    const ports = cookies("ttv-last-space=mentoring");
    const state = createSpacesController({ me: meByPersona.david, explicitSpace: "mentoring", browser: ports });
    state.hydratePreference();
    state.dispatchDrawer({ type: "open", itemCount: 3 });
    state.setContext(meByPersona.lucy);
    expect(state.getState()).toMatchObject({ selectedSpace: "community", drawer: { open: false }, me: { user: meByPersona.lucy.user } });
    expect(state.switchSpace("mentoring")).toBe(false);
    expect(state.setContext(null)).toBe(true);
    expect(state.getState()).toMatchObject({ enabled: false, selectedSpace: null, spaces: [], me: null });
    expect(state.switchSpace("community")).toBe(false);
  });
  it("rejects invalid context and clears stale authority", () => {
    const state = createSpacesController({ me: meByPersona.amina });
    expect(state.setContext({ ...meByPersona.amina, spaces: ["admin", "community"] } as Me)).toBe(false);
    expect(state.getState()).toMatchObject({ me: null, enabled: false, spaces: [], selectedSpace: null });
    expect(() => createSpacesController({ me: { ...meByPersona.lucy, spaces: ["injected"] } as unknown as Me })).toThrow(/Invalid option/);
    state.setContext({ ...meByPersona.lucy, spaces: [] });
    expect(state.getState().selectedSpace).toBeNull();
    expect(state.switchSpace(null)).toBe(false);
    expect(state.switchSpace("profile")).toBe(false);
  });
  it("keeps OFF inert including hydration, switching and drawer interactions", () => {
    const ports = cookies("ttv-last-space=admin");
    const off = { ...meByPersona.amina, flags: { ...meByPersona.amina.flags, spaces: false } };
    const state = createSpacesController({ me: off, browser: ports, explicitSpace: "admin" });
    state.hydratePreference(); state.dispatchDrawer({ type: "open", itemCount: 4 });
    expect(state.switchSpace("admin")).toBe(false);
    expect(state.handleDrawerKey("Tab", 4)).toBe(false);
    expect(state.getState()).toMatchObject({ enabled: false, spaces: [], selectedSpace: null, drawer: { open: false } });
    expect(ports.readCookie).not.toHaveBeenCalled(); expect(ports.writeCookie).not.toHaveBeenCalled();
    state.setContext(meByPersona.amina, "admin");
    state.dispatchDrawer({ type: "open", itemCount: 4 });
    state.setContext(off);
    expect(state.getState().drawer.open).toBe(false);
    expect(state.getState().selectedSpace).toBeNull();
  });
  it("requires no browser storage or server mutation in fixture mock mode", () => {
    const ports = cookies();
    const state = createSpacesController({ mock: "joseph", browser: ports });
    state.hydratePreference();
    expect(state.switchSpace("discover")).toBe(true);
    expect(state.switchSpace("admin")).toBe(false);
    expect(state.getState().me).toEqual(meByPersona.joseph);
    expect(ports.readCookie).not.toHaveBeenCalled(); expect(ports.writeCookie).not.toHaveBeenCalled();
  });
  it("publishes drawer keyboard intents and unsubscribes", () => {
    const state = createSpacesController({ mock: "lucy" });
    const listener = vi.fn(); const stop = state.subscribe(listener);
    expect(state.handleDrawerKey("Escape", 3)).toBe(false);
    state.dispatchDrawer({ type: "open", itemCount: 3 });
    expect(state.handleDrawerKey("Enter", 3)).toBe(false);
    expect(state.handleDrawerKey("Tab", 3, true)).toBe(true);
    expect(state.getState().drawer.focusIndex).toBe(2);
    expect(state.handleDrawerKey("Escape", 3)).toBe(true);
    expect(state.getState().drawer.focusTarget).toBe("trigger");
    expect(listener).toHaveBeenCalledTimes(3);
    state.dispatchDrawer({ type: "close" });
    expect(listener).toHaveBeenCalledTimes(3);
    stop(); state.switchSpace("profile");
    expect(listener).toHaveBeenCalledTimes(3);
  });
  it.each(["read", "write", "protocol", "silent"])("cookie %s failure leaves authorized switching usable", failure => {
    const ports: SpacesBrowser = cookies("ttv-last-space=profile");
    if (failure === "read") ports.readCookie = () => { throw new Error("disabled"); };
    if (failure === "write") ports.writeCookie = () => { throw new Error("disabled"); };
    if (failure === "protocol") ports.isHTTPS = () => { throw new Error("unavailable"); };
    if (failure === "silent") ports.writeCookie = () => {};
    const state = createSpacesController({ me: meByPersona.lucy, browser: ports });
    expect(() => state.hydratePreference()).not.toThrow();
    expect(state.switchSpace("community")).toBe(true);
    expect(state.getState()).toMatchObject({ selectedSpace: "community", preferenceStatus: "unavailable" });
  });
});
