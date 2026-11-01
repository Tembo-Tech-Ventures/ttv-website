import { ErrorEnvelope } from "@/lib/platform/contracts";

export function platformJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function platformError(
  code: ErrorEnvelope["error"]["code"],
  message: string,
  status: number,
  retryAfterMs?: number
): Response {
  const response = platformJson(ErrorEnvelope.parse({ error: { code, message, retryAfterMs } }), status);
  if (retryAfterMs !== undefined) response.headers.set("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
  return response;
}

/** Admin APIs that answer in the platform envelope, including when the admin guards refuse them. */
const PLATFORM_ADMIN_APIS = ["/api/admin/platform-flags", "/api/admin/access-requests"];

/** Preserve existing admin guards, using the platform envelope on these APIs. */
export function platformAdminApiDenial(response: Response, pathname: string): Response {
  if (PLATFORM_ADMIN_APIS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return platformError("forbidden", "This request is not permitted.", 403);
  }
  return response;
}
