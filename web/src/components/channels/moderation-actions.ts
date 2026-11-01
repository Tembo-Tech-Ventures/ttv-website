import { ROUTES } from "@/lib/platform/contracts";
import { createApiClient, type ApiClient } from "@/lib/platform/client/apiClient";
import type { ChannelStore } from "@/lib/platform/client/channel";
import { WRITE_TIMEOUT_MS } from "@/lib/platform/client/composer";
import type { ModerationActions } from "./actions";

type ModerationOptions = {
  /** The open channel's store: a moderated message replaces its cached copy, as an edit's confirmation does. */
  store: Pick<ChannelStore, "update">;
  api?: ApiClient;
  timeoutMs?: number;
};

/**
 * Reports and in-place moderation (B-2.5's routes) for one channel view.
 * Neither is optimistic: a report changes nothing the reader sees, and hiding
 * is a decision a moderator should see confirmed before the message changes.
 * Each call gives up after the composer's write timeout, so a hung request
 * cannot leave a form spinning.
 */
export function createModerationActions({ store, api = createApiClient(), timeoutMs = WRITE_TIMEOUT_MS }: ModerationOptions): ModerationActions {
  return {
    async report(messageId, reason) {
      await api.call(ROUTES.reportMessage, { params: { id: messageId }, body: { reason }, signal: AbortSignal.timeout(timeoutMs) });
    },
    async moderate(messageId, action, reason) {
      const message = await api.call(ROUTES.moderateMessage, {
        params: { messageId }, body: { action, reason }, signal: AbortSignal.timeout(timeoutMs),
      });
      store.update([message]);
      return message;
    },
  };
}
