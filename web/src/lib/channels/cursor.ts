import { z } from "zod";

/**
 * Opaque message-list cursors (README.md beside this file, "Reading messages"). A cursor names one
 * feed (a channel's root messages, or one thread's replies) and a position in it: `before` a
 * message's seq, or `since` a changeSeq checkpoint. Positions come from the channel's own counter,
 * so they mean nothing in another feed; the feed is bound by a hash, so a cursor used elsewhere is
 * refused instead of paging the wrong list. Cursors carry no authority: every request is
 * authorised again, and a cursor only narrows what the caller may already read.
 */
export type CursorDirection = "before" | "since";

/** 400: not a cursor of this kind for this feed. Clients drop it and load a fresh latest page. */
export class CursorInvalidError extends Error {}
/** 410: a well-formed cursor this server can no longer honour (another format, or a reset feed). */
export class CursorExpiredError extends Error {}

const VERSION = 1;
const Payload = z.strictObject({ v: z.int(), f: z.string().length(16), d: z.enum(["before", "since"]), p: z.int().nonnegative() });

/** A short, stable digest of the feed. Not a secret: it only keeps cursors in their own feed. */
async function feedKey(channelId: string, thread: string | null): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${channelId}\u0000${thread ?? ""}`));
  return Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const toBase64Url = (text: string) => btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

export async function encodeCursor(
  channelId: string, thread: string | null, direction: CursorDirection, position: number,
): Promise<string> {
  return toBase64Url(JSON.stringify({ v: VERSION, f: await feedKey(channelId, thread), d: direction, p: position }));
}

/** The position a cursor holds for this feed and direction, or a typed error. */
export async function decodeCursor(
  value: string, channelId: string, thread: string | null, direction: CursorDirection,
): Promise<number> {
  let payload: z.infer<typeof Payload>;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    payload = Payload.parse(JSON.parse(atob(padded)));
  } catch {
    throw new CursorInvalidError("Invalid message cursor.");
  }
  if (payload.v !== VERSION) throw new CursorExpiredError("This message cursor has expired.");
  if (payload.d !== direction || payload.f !== await feedKey(channelId, thread)) {
    throw new CursorInvalidError("Invalid message cursor.");
  }
  return payload.p;
}
