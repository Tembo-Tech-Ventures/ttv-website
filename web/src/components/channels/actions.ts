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
