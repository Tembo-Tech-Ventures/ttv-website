/** Only locally-authored messages cross the API/UI error boundary. */
export class UiApiError extends Error {
  constructor(public readonly status: number) {
    super(
      status === 401
        ? "Your session has ended. Sign in again to continue."
        : status === 403
          ? "Your account does not have access to this action."
          : status === 404
            ? "This contribution or profile is no longer available."
            : status === 409
              ? "This contribution changed since you opened it. Refresh and review the latest revision before confirming."
              : status === 429
                ? "Too many requests. Please wait a moment and try again."
                : status === 503 || status === 502
                  ? "This service is unavailable right now. Please try again later."
                  : status === 400 || status === 413
                    ? "Some details could not be accepted. Check the fields and try again."
                    : "The request could not be completed. Your draft is still here; please try again.",
    );
  }
}

export function displayUiError(error: unknown, fallback: string): string {
  return error instanceof UiApiError ? error.message : fallback;
}
