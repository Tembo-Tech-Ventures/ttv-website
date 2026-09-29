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
 * Drizzle wraps D1 failures, so inspect the bounded cause chain rather than
 * relying on the outer "Failed query" message (which can include bound data).
 */
export function d1OverloadMessage(error: unknown): string | null {
  let current: unknown = error;
  const seen = new Set<unknown>();

  for (let depth = 0; depth < 5 && current !== undefined; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);

    const message = messageFrom(current);
    const overload = D1_OVERLOAD_MESSAGES.find((candidate) =>
      message?.includes(candidate)
    );
    if (overload) return `D1_ERROR: ${overload}`;

    current = causeFrom(current);
  }

  return null;
}

export function isD1OverloadError(error: unknown): boolean {
  return d1OverloadMessage(error) !== null;
}
