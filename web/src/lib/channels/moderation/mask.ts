import { MASKED_CONTACT, MAX_CONTACT_MASKS, type ModerationState } from "@/lib/platform/contracts";
import { CONTACT_REASONS, contactSpans, type Span } from "./detectors";

/**
 * Masking flagged contact details (owner decision, 2026-11-02; README.md beside this file). In a
 * FLAGGED message whose reasons include a phone number, an email address or a chat invitation, those
 * details are replaced with MASKED_CONTACT for every reader except the author, the channel's
 * moderators and admins. The rest of the message stays readable. An admin's "fine as is" makes the
 * message VISIBLE again and shows it whole; a hidden message follows the hidden rules instead.
 *
 * bodyForReader is the one choke point: every path that hands a message body to a reader goes
 * through it (toMessage for pages, the API, polling and tokens; search; and Tembo's inputs from
 * Phase 3, which pass the asking reader's privilege). The spans are recomputed on each read, so an
 * edit that removes the number unmasks the rest at once, and nothing about them is stored.
 */

export interface MaskSubject {
  body: string;
  moderationState: ModerationState;
  /** The stored moderation reasons, as parsed from moderationReasons. */
  reasons: readonly string[];
}

/** Whether readers without the privilege see this message's contact details masked. */
export function masksContactDetails({ moderationState, reasons }: Omit<MaskSubject, "body">): boolean {
  return moderationState === "FLAGGED" && reasons.some((reason) => CONTACT_REASONS.has(reason));
}

/** Details separated only by spaces and punctuation ("0712 345 678, 0733 445 566") share one marker. */
const BETWEEN_DETAILS = /^[\s\p{P}]*$/u;

/** The body with each span replaced by MASKED_CONTACT: past MAX_CONTACT_MASKS, one marker covers the rest. */
export function maskSpans(body: string, spans: readonly Span[]): string {
  let result = "";
  let last = 0;
  let masks = 0;
  for (const [start, end] of spans) {
    if (masks > 0 && BETWEEN_DETAILS.test(body.slice(last, start))) {
      last = Math.max(last, end);
      continue;
    }
    result += body.slice(last, start) + MASKED_CONTACT;
    masks += 1;
    if (masks === MAX_CONTACT_MASKS) return result;
    last = end;
  }
  return result + body.slice(last);
}

/**
 * Masked bodies by their text, most recently used last. Masking is linear but not free (a few
 * milliseconds for a long body full of numbers), and the same flagged messages are read again and
 * again by every reader of a channel, so an isolate keeps the latest ones. Keyed by the text itself,
 * an edit can never be served an older mask. Bounded by the characters it holds, keys and values
 * together, not by its entries: a few hundred of the longest bodies would hold about 11 MB of an
 * isolate's 128, and this keeps it near 4 MB (2 bytes a character at most) whatever the bodies are.
 */
export const MASK_CACHE_CHARS = 2_000_000;
const cache = new Map<string, string>();
let cachedChars = 0;

const charsOf = (body: string, result: string) => body.length + result.length;

function masked(body: string): string {
  const hit = cache.get(body);
  if (hit !== undefined) {
    cache.delete(body);
    cache.set(body, hit);
    return hit;
  }
  const result = maskSpans(body, contactSpans(body));
  cachedChars += charsOf(body, result);
  cache.set(body, result);
  // The oldest go first. The newest entry always stays: no body (10,000 characters) outgrows the bound.
  for (const [key, value] of cache) {
    if (cachedChars <= MASK_CACHE_CHARS || key === body) break;
    cache.delete(key);
    cachedChars -= charsOf(key, value);
  }
  return result;
}

/**
 * The body this reader may see. `privileged`: the reader wrote the message, moderates its channel or
 * is an admin. Everyone else gets the masked body while the message is FLAGGED for contact details.
 */
export function bodyForReader(subject: MaskSubject, privileged: boolean): string {
  if (privileged || !masksContactDetails(subject)) return subject.body;
  return masked(subject.body);
}
