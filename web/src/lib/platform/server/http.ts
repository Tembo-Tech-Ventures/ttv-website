import { ErrorEnvelope } from "./flag-contracts";

export function platformJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function platformError(
  code: ErrorEnvelope["error"]["code"],
  message: string,
  status: number
): Response {
  return platformJson(ErrorEnvelope.parse({ error: { code, message } }), status);
}

/** Preserve existing admin guards, using the platform envelope on these APIs. */
export function platformFlagsAdminDenial(response: Response, pathname: string): Response {
  if (pathname === "/api/admin/platform-flags" || pathname.startsWith("/api/admin/platform-flags/")) {
    return platformError("forbidden", "This request is not permitted.", 403);
  }
  return response;
}
