import { Me, SpaceId } from "../contracts";
import { createStore } from "./store";
import { CLOSED_DRAWER, spacesDrawerReducer, type SpacesDrawerAction, type SpacesDrawerState } from "./spaces-drawer";
import { readLastSpaceCookie, selectDefaultSpace, serializeLastSpaceCookie } from "./spaces-selection";

export interface SpacesState {
  me: Me | null;
  enabled: boolean;
  spaces: readonly SpaceId[];
  selectedSpace: SpaceId | null;
  drawer: SpacesDrawerState;
  preferenceStatus: "idle" | "saved" | "unavailable";
}

/** Lazy ports: construction and SSR never touch browser globals or write cookies. */
export interface SpacesBrowser {
  readCookie(): string;
  writeCookie(value: string): void;
  isHTTPS(): boolean;
}

function browser(): SpacesBrowser {
  return {
    readCookie: () => typeof document === "undefined" ? "" : document.cookie,
    writeCookie(value) {
      if (typeof document === "undefined") throw new Error("Cookies unavailable");
      document.cookie = value;
    },
    isHTTPS: () => typeof window !== "undefined" && window.location.protocol === "https:",
  };
}

export type SpacesOptions = {
  me: Me | null;
  explicitSpace?: unknown;
  /** Only this parsed enum may be serialized into island props; never the request Cookie header. */
  lastSpace?: SpaceId | null;
  /** Null disables persistence (for fixture harnesses); undefined uses lazy browser ports. */
  browser?: SpacesBrowser | null;
};

/** One controller per island/request. No network calls, navigation, global listeners or server writes. */
export function createSpacesController(options: SpacesOptions) {
  const initial = Me.safeParse(options.me);
  let me = initial.success ? initial.data : null;
  let explicitSpace = options.explicitSpace;
  let lastSpace: unknown = options.lastSpace;
  const ports = options.browser === undefined ? browser() : options.browser;

  function context(): Pick<SpacesState, "me" | "enabled" | "spaces" | "selectedSpace"> {
    const enabled = me?.flags.spaces === true;
    const spaces = enabled ? me!.spaces : [];
    return { me, enabled, spaces, selectedSpace: selectDefaultSpace(spaces, { explicitSpace, lastSpace }) };
  }
  const store = createStore<SpacesState>({ ...context(), drawer: CLOSED_DRAWER, preferenceStatus: "idle" });

  function persist() {
    const state = store.getState();
    if (!ports || !state.enabled || !state.selectedSpace) return;
    let preferenceStatus: SpacesState["preferenceStatus"];
    try {
      ports.writeCookie(serializeLastSpaceCookie(state.selectedSpace, ports.isHTTPS()));
      // Browsers may silently refuse a cookie (blocked storage, sandboxed frame).
      preferenceStatus = readLastSpaceCookie(ports.readCookie()) === state.selectedSpace ? "saved" : "unavailable";
    } catch { preferenceStatus = "unavailable"; }
    store.setState(previous => previous.preferenceStatus === preferenceStatus ? previous : { ...previous, preferenceStatus });
  }

  const actions = {
    /** Call on the browser after hydration; the server already supplied the no-JS default. */
    hydratePreference() {
      if (!ports || !store.getState().enabled) return;
      let preferenceStatus = store.getState().preferenceStatus;
      try { lastSpace = readLastSpaceCookie(ports.readCookie()); }
      catch { lastSpace = null; preferenceStatus = "unavailable"; }
      store.setState(previous => ({ ...previous, ...context(), preferenceStatus }));
      // A server fallback is not a user choice. Save only an authorized explicit visit.
      const explicit = SpaceId.safeParse(explicitSpace);
      if (explicit.success && store.getState().spaces.includes(explicit.data)) persist();
    },
    /** Apply a newly validated /me payload. Null/invalid data revokes shell access immediately. */
    setContext(value: Me | null, urlSpace: unknown = explicitSpace): boolean {
      const result = Me.safeParse(value);
      me = result.success ? result.data : null;
      explicitSpace = urlSpace;
      store.setState(previous => ({ ...previous, ...context(), drawer: CLOSED_DRAWER, preferenceStatus: "idle" }));
      return value === null || result.success;
    },
    /** UI navigates after a true result. A preference never grants access to a space. */
    switchSpace(value: unknown): boolean {
      const state = store.getState();
      const parsed = SpaceId.safeParse(value);
      if (!state.enabled || !parsed.success || !state.spaces.includes(parsed.data)) return false;
      const selected = parsed.data;
      explicitSpace = selected;
      lastSpace = selected;
      store.setState(previous => ({ ...previous, selectedSpace: selected, drawer: CLOSED_DRAWER }));
      persist();
      return true;
    },
    dispatchDrawer(action: SpacesDrawerAction) {
      if (!store.getState().enabled) return;
      store.setState(previous => {
        const drawer = spacesDrawerReducer(previous.drawer, action);
        return drawer === previous.drawer ? previous : { ...previous, drawer };
      });
    },
    /** Return true when the UI should preventDefault and apply the resulting focus intent. */
    handleDrawerKey(key: string, itemCount: number, shiftKey = false): boolean {
      if (!store.getState().drawer.open || (key !== "Tab" && key !== "Escape")) return false;
      actions.dispatchDrawer({ type: "key", key, itemCount, shiftKey });
      return true;
    },
  };
  return { getState: store.getState, getServerSnapshot: store.getServerSnapshot, subscribe: store.subscribe, ...actions };
}

export type SpacesController = ReturnType<typeof createSpacesController>;
