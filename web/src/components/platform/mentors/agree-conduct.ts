import { ApiError } from "@/lib/platform/client/apiClient";
import { CONDUCT_INTENT } from "@/components/channels/conduct-flow";

/**
 * Records the person's agreement to how we talk to each other from the request drawer, with
 * JavaScript (QA4-05). It posts the page's own conduct form (`handleConductPost`, the same post the
 * drawer makes without JavaScript), so the page's gates hold: a person's own browser session, the same
 * origin, the version the drawer showed. The page answers with a redirect back to itself; that, unread,
 * is the success. Anything else throws, and the drawer sends nothing.
 */
export async function agreeToConduct(action: string, version: number, fetcher: typeof fetch = fetch): Promise<void> {
  let response: Response;
  try {
    response = await fetcher(action, {
      method: "POST",
      body: new URLSearchParams({ intent: CONDUCT_INTENT, version: String(version) }),
      credentials: "same-origin",
      redirect: "manual",
    });
  } catch (cause) {
    throw new ApiError("network_error", 0, "The agreement could not be sent", undefined, { cause });
  }
  const redirected = response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);
  if (!redirected && !response.ok) throw new ApiError("server", response.status, "The agreement was not recorded");
}
