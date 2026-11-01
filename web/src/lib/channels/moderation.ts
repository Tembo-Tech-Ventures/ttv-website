import type { ChannelKind } from "@/lib/platform/contracts";

/**
 * The pre-insert moderation hook (plan §3, step 1). Posting and editing call `screenMessage` before
 * they write, and store what it finds in the same statement as the message: reasons mean FLAGGED
 * (the message stays visible until a person decides) plus a DETECTOR moderation_event. A screen
 * never hides a message or refuses a post.
 *
 * This is a passthrough today. B-2.5 replaces the body with its deterministic detectors (phone
 * numbers in Kenyan and international spellings, emails, WhatsApp and Telegram links, shorteners,
 * mention floods, repeats across channels). Clef runs after the response and is not part of it.
 */
export interface MessageScreeningInput {
  channel: { id: string; kind: ChannelKind; programId: string | null };
  authorId: string;
  body: string;
  /** null for a root message. */
  parentId: string | null;
  operation: "post" | "edit";
}

/** Plain-language reasons shown to the author and moderators. Empty: nothing to flag. */
export interface MessageScreening { reasons: string[] }

export type MessageScreen = (input: MessageScreeningInput) => MessageScreening | Promise<MessageScreening>;

export const screenMessage: MessageScreen = () => ({ reasons: [] });
