import { delay, throwIfAborted } from "./abort";
import { ApiError } from "./apiError";

export interface RetryOptions {
  /** Additional attempts, after the original request. Default 2. */
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  safe: boolean,
  options: RetryOptions,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    throwIfAborted(signal);
    try {
      return await operation();
    } catch (error) {
      throwIfAborted(signal);
      if (!(error instanceof ApiError) || !safe || attempt >= options.maxRetries) throw error;
      if (!(error.code === "network_error" && error.status === 0)
        && error.status !== 429 && !(error.status >= 500 && error.status < 600)) throw error;
      const ceiling = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** attempt);
      const jitter = ceiling * (0.5 + Math.random() * 0.5);
      await delay(Math.max(jitter, error.retryAfterMs ?? 0), signal);
    }
  }
}
