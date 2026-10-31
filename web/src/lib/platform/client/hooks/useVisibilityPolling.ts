import { useCallback, useEffect, useRef } from "react";
import { createPoller, type PollingOptions } from "../poller";
import { throwIfAborted } from "../abort";

export interface VisibilityPollingOptions extends PollingOptions {
  enabled?: boolean;
}

/** Pass run backed by a real or mock ApiClient. Callback changes do not restart timers. */
export function useVisibilityPolling(options: VisibilityPollingOptions): () => void {
  const latest = useRef(options);
  const current = useRef<ReturnType<typeof createPoller> | undefined>(undefined);
  const settled = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => { latest.current = options; });
  const { intervalMs, maxIntervalMs, backoff, enabled = true } = options;
  useEffect(() => {
    if (!enabled) return;
    const poller = createPoller({
      intervalMs, maxIntervalMs, backoff,
      run: signal => {
        // Keep the gate across effect restarts too: an old callback may ignore abort.
        const next = settled.current.then(() => {
          throwIfAborted(signal);
          return latest.current.run(signal);
        });
        settled.current = next.then(() => undefined, () => undefined);
        return next;
      },
      isActive: () => latest.current.isActive?.() ?? true,
    });
    current.current = poller;
    poller.start();
    return () => { poller.stop(); current.current = undefined; };
  }, [intervalMs, maxIntervalMs, backoff, enabled]);
  return useCallback(() => current.current?.refresh(), []);
}
