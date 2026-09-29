import { d1OverloadMessage } from "@/lib/db/d1-errors";
import { recordErrorInBackground } from "@/lib/observability/errors";

interface PublicPageDataOptions<T> {
  db: D1Database;
  fallback: T;
  load: () => Promise<T>;
  route: string;
  version?: string;
  waitUntil?: Pick<ExecutionContext, "waitUntil">;
}

export interface PublicPageData<T> {
  available: boolean;
  data: T;
}

export function markPublicDataUnavailable(response: {
  status: number;
  headers: Headers;
}) {
  response.status = 503;
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Retry-After", "30");
}

/**
 * Public reads may degrade only for the confirmed transient D1 overload. Other
 * failures keep propagating so the request middleware can report and surface
 * them normally.
 */
export async function loadPublicPageData<T>({
  db,
  fallback,
  load,
  route,
  version,
  waitUntil,
}: PublicPageDataOptions<T>): Promise<PublicPageData<T>> {
  try {
    return { available: true, data: await load() };
  } catch (error) {
    const overload = d1OverloadMessage(error);
    if (!overload) throw error;

    recordErrorInBackground(waitUntil, db, {
      source: "request",
      route,
      error: new Error(`Public page database read unavailable: ${overload}`),
      version,
    });
    return { available: false, data: fallback };
  }
}
