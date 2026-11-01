import type { EmbedRef, Message, MessageEmbed, ProjectEmbed, ReactionKind, SessionClipEmbed } from "@/lib/platform/contracts";

/**
 * What the message list asks of the channel's writer. S-2.2's composer
 * (`createComposer`) is the implementation: each change shows at once and
 * resolves when the server has confirmed it, or rejects with its ApiError.
 */
export interface ChannelActions {
  edit(messageId: string, body: string): Promise<Message>;
  remove(messageId: string): Promise<Message>;
  react(messageId: string, kind: ReactionKind, active: boolean): Promise<unknown>;
}

/** The two things a moderator does to a message in place. "keep" belongs to the admin queue (U-2.4). */
export type InPlaceModeration = "hide" | "restore";

/**
 * Reporting, moderating and asking for a review: one-shot calls, each
 * resolving when the server has accepted it or rejecting with its ApiError.
 * A changed message comes back confirmed and replaces the cached copy.
 * Hiding is for the channel's moderators, restoring for admins (B-2.5). `requestReview`
 * is absent until the server offers it, and so is the button.
 */
export interface ModerationActions {
  report(messageId: string, reason: string): Promise<void>;
  moderate(messageId: string, action: InPlaceModeration, reason: string): Promise<Message>;
  requestReview?: (messageId: string, note: string | null) => Promise<void>;
}

/** Work a person can attach from the composer, resolved by the page. */
export type Shareables = { projects: readonly ProjectEmbed[]; clips: readonly SessionClipEmbed[] };
export const NO_SHAREABLES: Shareables = { projects: [], clips: [] };

export function embedRef(embed: MessageEmbed): EmbedRef {
  return embed.type === "project"
    ? { type: "project", journeyId: embed.journeyId, version: embed.version }
    : { type: "sessionClip", recordingId: embed.recordingId, startSeconds: embed.startSeconds, durationSeconds: embed.durationSeconds };
}

export function sameEmbed(a: MessageEmbed | EmbedRef, b: MessageEmbed | EmbedRef): boolean {
  return a.type === "project" && b.type === "project"
    ? a.journeyId === b.journeyId && a.version === b.version
    : a.type === "sessionClip" && b.type === "sessionClip" && a.recordingId === b.recordingId && a.startSeconds === b.startSeconds;
}
