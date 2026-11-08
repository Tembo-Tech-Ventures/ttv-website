import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import type { Me } from "@/lib/platform/contracts";
import { createAttentionAnnouncer } from "@/components/platform/attention/attention-announcer";
import {
  onAttentionRefresh, onShellOverlay, requestShellOverlay, type ShellOverlay, type ShellOverlayRequest,
} from "@/components/platform/shell/overlays";
import { clearRecentSearches, onShellSignOut, recentSearchKey } from "@/components/platform/search/recent-searches";
import type { HarnessScenario } from "./harness-clients";
import { useHarnessClients } from "./harness-loader";
import LiveRegions from "./LiveRegions";

type PlatformOverlaysProps = {
  /** The signed-in person's context, from getSpaceContext. Nothing else about the session. */
  me: Me;
  /**
   * Whether this island owns attention (the panel, the live counts). The
   * attention page owns its own inbox, so it mounts these overlays without it.
   */
  attention?: boolean;
  /** The person's one cohort's name ("Cohort 05"), for search's cohort scope; null keeps "Your cohort" (T07). */
  cohortLabel?: string | null;
  /** DEV harness only: answer from fixtures, in this scenario, instead of the API. */
  harness?: HarnessScenario;
};

/**
 * When the attention store's first count is due: it starts from the counts `Me` was rendered with and
 * waits this long before asking again (lib/platform/client/attention.ts). Loading it then, and
 * counting at once, keeps the bell exactly as fresh as when the store loaded with the page.
 */
export const FIRST_COUNT_MS = 30_000;

const loadSearch = () => import("@/components/platform/search/SearchOverlay");
const loadAttention = () => import("./AttentionOverlay");

/**
 * A component fetched the first time it is wanted. A failed fetch (a dropped connection, a deploy
 * that replaced the chunk) is forgotten, so the next request tries again.
 */
function useOnDemand<P>(load: () => Promise<{ default: ComponentType<P> }>) {
  const [Component, setComponent] = useState<ComponentType<P> | null>(null);
  const flight = useRef<Promise<void> | null>(null);
  const start = useCallback(() => {
    flight.current ??= load().then(
      (module) => setComponent(() => module.default),
      (error: unknown) => {
        flight.current = null;
        console.error("An overlay could not load; the next request tries again.", error);
      },
    );
  }, [load]);
  return [Component, start] as const;
}

/**
 * Loads an overlay on its first request and asks again once it listens. The overlay's own listener
 * subscribes in its effect, which runs before this island's, so the repeated request reaches it with
 * the trigger that made it (focus goes back there on close).
 */
function useOverlayOnRequest(overlay: ShellOverlay, loaded: boolean, start: () => void, enabled = true) {
  const pending = useRef<ShellOverlayRequest | null>(null);
  const isLoaded = useRef(loaded);
  isLoaded.current = loaded;
  useEffect(() => {
    if (!enabled) return undefined;
    return onShellOverlay(overlay, (request) => {
      if (isLoaded.current) return;
      pending.current = request;
      start();
    });
  }, [overlay, start, enabled]);
  useEffect(() => {
    const request = pending.current;
    if (!loaded || !request) return;
    pending.current = null;
    requestShellOverlay(request);
  }, [loaded]);
}

/**
 * The first count is due as the store would have counted: FIRST_COUNT_MS after the page was rendered
 * (once it is visible), or as soon as the person comes back to the tab (focus, or the page shown).
 */
function useWhenCountDue(enabled: boolean, onDue: () => void) {
  useEffect(() => {
    if (!enabled) return undefined;
    // A hidden page counts nothing; the person showing it again is due enough.
    const due = () => {
      if (!document.hidden) onDue();
    };
    const timer = setTimeout(due, FIRST_COUNT_MS);
    document.addEventListener("visibilitychange", due);
    window.addEventListener("focus", due);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", due);
      window.removeEventListener("focus", due);
    };
  }, [enabled, onDue]);
}

/**
 * The shell's overlays for a space page: search everything (Ctrl K / ⌘ K) and the attention panel.
 * Mount it in SpacesLayout's `overlays` slot with `client:idle` and pass `overlays={["search",
 * "attention"]}`, so the shell shows their triggers.
 *
 * Neither panel is in the page's first download (S7). Search loads on its first request. Attention,
 * whose store also keeps the bell's counts, loads on the first of: the bell, its first count falling
 * due, or another island asking for a count. A request made before this island hydrated is held for
 * it (onShellOverlay), and the live region attention speaks through is here from the start.
 */
export default function PlatformOverlays({ me, attention = true, cohortLabel = null, harness }: PlatformOverlaysProps) {
  const clients = useHarnessClients(harness);
  const ownsAttention = attention && me.flags.spaces === true;
  const [Search, startSearch] = useOnDemand(loadSearch);
  const [Attention, startAttention] = useOnDemand(loadAttention);
  const [announcer] = useState(createAttentionAnnouncer);
  const [countNow, setCountNow] = useState(false);
  useEffect(() => () => announcer.dispose(), [announcer]);

  useOverlayOnRequest("search", Search !== null, startSearch);
  useOverlayOnRequest("attention", Attention !== null, startAttention, ownsAttention);
  const countDue = useCallback(() => {
    setCountNow(true);
    startAttention();
  }, [startAttention]);
  useWhenCountDue(ownsAttention && Attention === null, countDue);
  useEffect(() => (ownsAttention && Attention === null ? onAttentionRefresh(countDue) : undefined), [ownsAttention, Attention, countDue]);
  /* Recent searches are this person's alone: drop anyone else's, and all of them on sign-out, even
     when search never loaded on this page (SearchOverlay does the same for its own state). */
  useEffect(() => {
    clearRecentSearches(recentSearchKey(me.user.id));
    return onShellSignOut(() => clearRecentSearches());
  }, [me.user.id]);
  // Set once the listeners above are attached, after hydration: "listening", for tests and for anyone checking.
  const [listening, setListening] = useState(false);
  useEffect(() => setListening(true), []);

  return (
    <>
      <span hidden data-platform-overlays data-listening={listening || undefined} />
      {Search && <Search me={me} cohortLabel={cohortLabel} client={clients?.search} />}
      {ownsAttention && (
        <>
          {Attention && <Attention me={me} announcer={announcer} countNow={countNow} api={clients?.attention} />}
          <LiveRegions announcer={announcer} name="attention" />
        </>
      )}
    </>
  );
}
