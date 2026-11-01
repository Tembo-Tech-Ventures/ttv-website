import type { ChannelKind } from "@/lib/platform/contracts";
import { detectFindings, textKey, type Finding } from "./detectors";

/**
 * The pre-insert moderation hook (plan §3, step 1). Posting and editing call `screenMessage` before
 * they write, and store what it finds in the same statement as the message: findings mean FLAGGED
 * (the message stays visible until a person decides) plus a DETECTOR moderation_event. A screen
 * never hides a message or refuses a post, and does no I/O: the allowlist and the cross-channel
 * repeat check are SQL inside the guarded write, so a refused write costs nothing extra. Clef, the
 * one model-backed check, runs only after a write commits (clef.ts).
 */
export interface MessageScreeningInput {
  channel: { id: string; kind: ChannelKind; programId: string | null };
  authorId: string;
  body: string;
  /** null for a root message. */
  parentId: string | null;
  operation: "post" | "edit";
}

export interface MessageScreening {
  findings: Finding[];
  /** The whole text's allowlist key: when an admin kept this text, nothing in it is flagged. */
  textKey: string;
}

export type MessageScreen = (input: MessageScreeningInput) => MessageScreening | Promise<MessageScreening>;

export const screenMessage: MessageScreen = async ({ body }) => ({ findings: detectFindings(body), textKey: await textKey(body) });
