const D1_OVERLOAD_MESSAGES = [
  "D1 DB is overloaded. Requests queued for too long.",
  "D1 DB is overloaded. Too many requests queued.",
] as const;

function messageFrom(value: unknown): string | null {
  if (value instanceof Error) return value.message;
  if (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
  ) {
    return value.message;
  }
  return typeof value === "string" ? value : null;
}

function causeFrom(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("cause" in value)) {
    return undefined;
  }
  return value.cause;
}

/**
 * Failures where the statement may or may not have run, and running it again
 * is the documented remedy. Cloudflare reports a dropped connection between
 * the Worker and D1 as "Network connection lost".
 */
const D1_TRANSIENT_MESSAGES = [
  ...D1_OVERLOAD_MESSAGES,
  "Network connection lost.",
] as const;

/**
 * Drizzle wraps D1 failures, so inspect the bounded cause chain rather than
 * relying on the outer "Failed query" message (which can include bound data).
 */
function findD1Message(
  error: unknown,
  candidates: readonly string[]
): string | null {
  let current: unknown = error;
  const seen = new Set<unknown>();

  for (let depth = 0; depth < 5 && current !== undefined; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);

    const message = messageFrom(current);
    const match = candidates.find((candidate) => message?.includes(candidate));
    if (match) return `D1_ERROR: ${match}`;

    current = causeFrom(current);
  }

  return null;
}

export function d1OverloadMessage(error: unknown): string | null {
  return findD1Message(error, D1_OVERLOAD_MESSAGES);
}

export function isD1TransientError(error: unknown): boolean {
  return findD1Message(error, D1_TRANSIENT_MESSAGES) !== null;
}

/**
 * Runs a D1 operation, retrying transient failures a bounded number of times.
 * The statement may have committed before the connection dropped, so callers
 * must make `operation` safe to repeat. It receives the attempt number (from
 * 1) so a retry can first check whether the earlier attempt landed.
 */
export async function retryTransientD1<T>(
  operation: (attempt: number) => Promise<T>,
  { attempts = 3, delayMs = 100 }: { attempts?: number; delayMs?: number } = {}
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= attempts || !isD1TransientError(error)) throw error;
      await new Promise((resolve) => {
        setTimeout(resolve, delayMs * attempt);
      });
    }
  }
}

export function isD1OverloadError(error: unknown): boolean {
  return d1OverloadMessage(error) !== null;
}
