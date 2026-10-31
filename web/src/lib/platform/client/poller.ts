export interface PollResult { changed: boolean }

export interface PollingOptions {
  run: (signal: AbortSignal) => PollResult | Promise<PollResult>;
  intervalMs: number;
  maxIntervalMs?: number;
  backoff?: number;
  /** Additional activity condition; document visibility is always respected. */
  isActive?: () => boolean;
}

/** Explicit lifecycle. A stopped run must settle before a restarted poller can run. */
export function createPoller({
  run, intervalMs, maxIntervalMs = intervalMs * 6, backoff = 2, isActive = () => true,
}: PollingOptions) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0
    || !Number.isFinite(maxIntervalMs) || maxIntervalMs < intervalMs || maxIntervalMs > 2_147_483_647
    || !Number.isFinite(backoff) || backoff < 1) throw new RangeError("Invalid polling intervals or backoff");
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let immediate = false;
  let interval = intervalMs;
  let doc: Document | undefined;
  let win: Window | undefined;
  const active = () => !doc?.hidden && isActive();
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const increase = () => { interval = Math.min(maxIntervalMs, interval * backoff); };
  const schedule = (ms: number) => { clear(); timer = setTimeout(() => { void tick(); }, ms); };

  async function tick() {
    clear();
    // Only refresh (when no run exists) and a completed run can schedule tick.
    if (!active()) return;
    const current = new AbortController();
    controller = current;
    immediate = false;
    try {
      const result = await run(current.signal);
      if (!current.signal.aborted) {
        if (result.changed) interval = intervalMs;
        else increase();
      }
    } catch {
      if (!current.signal.aborted) increase();
    } finally {
      controller = undefined;
      if (started && active()) schedule(immediate ? 0 : interval);
    }
  }

  function refresh() {
    if (!started) return;
    clear();
    if (!active()) {
      controller?.abort();
      return;
    }
    interval = intervalMs;
    if (controller) immediate = true;
    else void tick();
  }

  return {
    start() {
      if (started) return;
      started = true;
      doc = typeof document === "undefined" ? undefined : document;
      win = typeof window === "undefined" ? undefined : window;
      doc?.addEventListener("visibilitychange", refresh);
      win?.addEventListener("focus", refresh);
      refresh();
    },
    /** Re-evaluate isActive, or request a fresh run. Safe during an in-flight run. */
    refresh,
    stop() {
      started = false;
      immediate = false;
      clear();
      controller?.abort();
      doc?.removeEventListener("visibilitychange", refresh);
      win?.removeEventListener("focus", refresh);
    },
  };
}
