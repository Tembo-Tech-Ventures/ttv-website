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
  if (!Number.isFinite(ms) || ms < 0 || ms > 2_147_483_647) throw new RangeError("Invalid delay");
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
