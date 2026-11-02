import { ROUTES, type SessionClipEmbed } from "@/lib/platform/contracts";
import type { ApiClient } from "@/lib/platform/client/apiClient";

/** Session moments that mention `query` (GET /api/channels/:id/shareables?q=), cancelled by `signal`. */
export type MomentFinder = (query: string, signal: AbortSignal) => Promise<readonly SessionClipEmbed[]>;

/** The channel's moment search over B-2.4's shareables route: only clips the caller may share here come back. */
export function shareablesFinder(api: ApiClient, channelId: string): MomentFinder {
  return async (q, signal) => (await api.call(ROUTES.listShareables, { params: { id: channelId }, query: { q }, signal })).clips;
}

export type MomentSearchState =
  /** No words yet: the recent sessions the page brought are offered instead. */
  | { status: "idle" }
  | { status: "searching"; query: string }
  | { status: "found"; query: string; clips: readonly SessionClipEmbed[] }
  | { status: "failed"; query: string };

/** Long enough to let someone finish a word, short enough to feel like it answers the typing. */
export const MOMENT_SEARCH_DEBOUNCE_MS = 250;
/** The server's limit on `q` (ShareablesQuery). */
export const MAX_MOMENT_QUERY = 200;

const IDLE: MomentSearchState = { status: "idle" };

/**
 * Searching session moments as someone types: one request per pause in the
 * typing, and only the newest one counts. A newer query, clearing the box or
 * closing the finder aborts the request in flight, so a slow answer to an
 * old query can never replace the answer to the current one.
 */
export function createMomentSearch(find: MomentFinder, onChange: (state: MomentSearchState) => void, debounceMs = MOMENT_SEARCH_DEBOUNCE_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: AbortController | null = null;
  let current = "";

  function cancel() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    inFlight?.abort();
    inFlight = null;
  }

  async function run(query: string) {
    const controller = new AbortController();
    inFlight = controller;
    try {
      const clips = await find(query, controller.signal);
      if (!controller.signal.aborted) onChange({ status: "found", query, clips });
    } catch {
      if (!controller.signal.aborted) onChange({ status: "failed", query });
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  }

  return {
    /** The box's words now. Repeating the current query changes nothing. */
    search(text: string) {
      const query = text.trim().slice(0, MAX_MOMENT_QUERY);
      if (query === current) return;
      current = query;
      cancel();
      if (query === "") {
        onChange(IDLE);
        return;
      }
      onChange({ status: "searching", query });
      timer = setTimeout(() => {
        timer = null;
        void run(query);
      }, debounceMs);
    },
    /** Search the current words again, after a failure. */
    retry() {
      if (current === "") return;
      cancel();
      onChange({ status: "searching", query: current });
      void run(current);
    },
    dispose: cancel,
  };
}
