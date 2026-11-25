import type { Meeting, MeetingJoin } from "@/lib/platform/contracts";

/**
 * The meeting routes as the call room calls them (README.md beside this file, "The API"). Types only
 * from the contracts: the routes are same-origin and parse their own answers with the contracts, so
 * the island doesn't carry Zod and every contract in its chunk just to read them again.
 *
 * Each call resolves to what happened, never throws for an answer the room has a screen for:
 * `missing` is the same 404 as every refusal (the call is gone for this person: removed, or never
 * theirs), `conflict` is the call's state (hasn't opened, ended, full: the server's words),
 * `conduct` asks for the code of conduct, `unavailable` is a provider or network failure worth
 * trying again.
 */

export type RoomAnswer<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "missing" | "conduct" | "unavailable" }
  | { ok: false; kind: "conflict"; message: string };

const PATH = "/api/meetings";

async function call<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<RoomAnswer<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) },
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ok: false, kind: "unavailable" };
  }
  if (response.ok) return { ok: true, value: await response.json() as T };
  if (response.status === 404) return { ok: false, kind: "missing" };
  const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  if (response.status === 409) return { ok: false, kind: "conflict", message: body?.error?.message ?? "" };
  if (response.status === 403 && body?.error?.code === "conduct_required") return { ok: false, kind: "conduct" };
  return { ok: false, kind: "unavailable" };
}

const at = (id: string, action?: string) => `${PATH}/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;
const post = { method: "POST", body: "{}" } as const;

export const roomApi = {
  get: (id: string, signal?: AbortSignal) => call<Meeting>(at(id), {}, signal),
  join: (id: string) => call<MeetingJoin>(at(id, "join"), post),
  leave: (id: string) => call<Meeting>(at(id, "leave"), post),
  /** On page hide, where a fetch may be cut off: the browser sends this one after the page is gone. */
  leaveOnExit: (id: string) => fetch(at(id, "leave"), { ...post, credentials: "same-origin", keepalive: true, headers: { "content-type": "application/json" } }),
  remove: (id: string, userId: string) => call<Meeting>(at(id, "remove"), { method: "POST", body: JSON.stringify({ userId }) }),
  end: (id: string) => call<Meeting>(at(id, "end"), post),
};

export type RoomApi = typeof roomApi;
