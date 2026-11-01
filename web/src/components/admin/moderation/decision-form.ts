import { Id, ModerationAction, ModerationActionKind, type ModerationActionKind as ActionKind } from "@/lib/platform/contracts";

/*
 * The decision form on /admin/moderation (U-2.4). It is a plain form post, so the queue works
 * without JavaScript; the enhancement in enhance.ts posts the same form and swaps in the page the
 * server renders back. Both paths go through this parser and the same server decision, so they
 * accept and refuse exactly the same things.
 */

export const REASON_MAX = 2000;

export type DecisionForm =
  | { ok: true; messageId: string; action: ActionKind; reason: string }
  | { ok: false; messageId: string | null; reason: string; error: string };

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

export function parseDecisionForm(form: FormData): DecisionForm {
  const messageId = Id.safeParse(text(form.get("messageId"))).data ?? null;
  const reason = text(form.get("reason")).trim();
  const action = ModerationActionKind.safeParse(form.get("action"));
  if (!messageId) return { ok: false, messageId: null, reason, error: "That case could not be found. Refresh the queue and try again." };
  if (!action.success) return { ok: false, messageId, reason, error: "Choose one of the decisions for this message." };
  if (!reason) return { ok: false, messageId, reason, error: "Write a reason. It is kept with your decision." };
  const parsed = ModerationAction.safeParse({ action: action.data, reason });
  if (!parsed.success) return { ok: false, messageId, reason, error: `Keep the reason under ${REASON_MAX} characters.` };
  return { ok: true, messageId, action: parsed.data.action, reason: parsed.data.reason };
}

/** A refusal the decision function raised: the channel lane's ChannelError has this shape. */
export interface DecisionRefusal { status: number; code?: string; message?: string }

export function isDecisionRefusal(error: unknown): error is DecisionRefusal {
  return error instanceof Error && typeof (error as { status?: unknown }).status === "number";
}

/**
 * What the card says when a decision is refused. Every one of them says nothing changed: the
 * queue never shows a decision it did not record.
 */
export function refusalMessage(refusal: DecisionRefusal): string {
  // The channel lane's refusals say exactly why ("This message was deleted."); they are written for people.
  const said = refusal.message?.trim();
  switch (refusal.status) {
    case 400:
      return `Nothing changed. ${said || "Check the reason and try again."}`;
    case 403:
      return `Nothing changed. ${said || "Only administrators can decide cases here."}`;
    case 404:
      return "Nothing changed. This message no longer exists, so there is nothing to decide.";
    case 409:
      return `Nothing changed. ${said || "Someone decided this case, or the message changed, while you were reading."} The case below is as it stands now.`;
    default:
      return "Nothing changed. The decision could not be saved. Try again.";
  }
}

/** The status the page answers a refused decision with: the refusal's own, or 500. */
export function refusalStatus(refusal: DecisionRefusal): number {
  return refusal.status >= 400 && refusal.status < 600 ? refusal.status : 500;
}
