import { moderationAttention } from "@/lib/attention/channel-producers";
import { CHANNEL_CLEF_TIMEOUT_MS, ClefCheckError, clefScreen } from "@/lib/channels/moderation/clef";
import { recordError } from "@/lib/observability/errors";
import type { ChannelKind, Message } from "@/lib/platform/contracts";
import type { FlagContext } from "@/lib/platform/server/flags";

/**
 * What a session note gets after the response, as every post through the channel API does
 * (channels/http.ts, `written`): Clef's check, then the admins' queue notice when the detectors or
 * Clef flagged or hid it. A note mentions nobody, so no mention notice. Nothing here fails the page:
 * Clef failing leaves the note as it is and is logged as a warning, without the text.
 */
export interface NoteCheckEnv {
  DB: D1Database;
  AI?: Pick<Ai, "run">;
  AI_GATEWAY_NAME?: string;
  DEPLOYMENT_VERSION?: string;
}

export function noteChecks(
  env: NoteCheckEnv & FlagContext["env"],
  cfContext: Pick<ExecutionContext, "waitUntil"> | undefined,
  route: string,
): (message: Message, channel: { id: string; kind: ChannelKind }) => void {
  return (message, channel) => {
    const work = (async () => {
      let outcome = null;
      try {
        outcome = await clefScreen(
          { db: env.DB, ai: env.AI, gatewayName: env.AI_GATEWAY_NAME, timeoutMs: CHANNEL_CLEF_TIMEOUT_MS },
          { id: message.id, channelId: channel.id, channelKind: channel.kind, body: message.body },
        );
      } catch (error) {
        await recordError(env.DB, {
          source: "request", route, version: env.DEPLOYMENT_VERSION,
          level: error instanceof ClefCheckError ? "warning" : "error",
          error: error instanceof ClefCheckError ? error : new Error("Session note check could not be applied."),
        });
      }
      if (message.moderation?.state === "FLAGGED" || outcome === "flagged" || outcome === "hidden") {
        await moderationAttention({ db: env.DB, env }, message.id);
      }
    })();
    if (cfContext) cfContext.waitUntil(work);
    else void work;
  };
}
