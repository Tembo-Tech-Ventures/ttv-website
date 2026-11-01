import type { ErrorCode } from "@/lib/platform/contracts";

/** A refusal the HTTP layer turns into the error envelope. */
export class ChannelError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly status: number, readonly retryAfterMs?: number) {
    super(message);
  }
}
