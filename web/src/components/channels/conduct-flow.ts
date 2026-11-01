import type { ConductAcknowledgement } from "@/lib/platform/contracts";
import { CONDUCT_VERSION } from "@/lib/channels/conduct";
import { isSameOriginRequest } from "@/lib/agent-auth";
import { boundedForm } from "@/components/platform/onboarding/welcome-flow";

/**
 * Recording that someone has read "How we talk to each other". The first
 * time a person opens a channel, the channel page shows the habits with one
 * button; it posts here, and the page they asked for opens. Reading them
 * again later changes nothing. The record grants nothing either: what a
 * person may read or post is decided by the backend's channel rules.
 */

/** The backend's conduct store for one person (lib/channels/conduct.ts). */
export interface ConductActions {
  load(): Promise<ConductAcknowledgement | null>;
  /** Idempotent: agreeing again keeps the person agreed, and keeps the date they first did. */
  acknowledge(version: number): Promise<unknown>;
}

/** The form field that marks this post as agreeing to the habits, so a page can carry other forms too. */
export const CONDUCT_INTENT = "conduct";

/** Whether this person has agreed to the words as they are now. A change that bumps the version asks again. */
export function conductAgreed(record: ConductAcknowledgement | null): boolean {
  return record?.current === true;
}

export type ConductPostResult =
  | { kind: "redirect"; location: string }
  | { kind: "refuse"; status: 400 | 403 | 413 };

/**
 * Handles a post that agrees to the habits, then sends the person on to
 * `back` (303), or returns null when the request is not such a post. The
 * caller has already checked the session is a person's own browser session
 * and that `channels` is on for them. A post naming an older version than
 * the page now shows records nothing: the person goes back and reads the new
 * words first.
 */
export async function handleConductPost(request: Request, actions: ConductActions, back: string): Promise<ConductPostResult | null> {
  if (request.method !== "POST") return null;
  if (!isSameOriginRequest(request)) return { kind: "refuse", status: 403 };
  const form = await boundedForm(request);
  if (!form) return { kind: "refuse", status: 413 };
  if (form.get("intent") !== CONDUCT_INTENT) return { kind: "refuse", status: 400 };
  if (Number(form.get("version")) === CONDUCT_VERSION) await actions.acknowledge(CONDUCT_VERSION);
  return { kind: "redirect", location: back };
}
