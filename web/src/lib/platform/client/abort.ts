/** Also races transports/handlers that ignore their signal. Listeners always detach. */
export function abortable<T>(work: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return Promise.resolve(work);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("The operation was aborted", "AbortError"));
    Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    // Chunk long server-directed waits rather than overflowing setTimeout's signed int.
    const end = Date.now() + ms;
    let timer: ReturnType<typeof setTimeout>;
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted", "AbortError"));
    };
    const tick = () => {
      const remaining = end - Date.now();
      if (remaining > 0) timer = setTimeout(tick, Math.min(remaining, 2_147_483_647));
      else {
        signal?.removeEventListener("abort", abort);
        resolve();
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(tick, Math.min(ms, 2_147_483_647));
  });
}
