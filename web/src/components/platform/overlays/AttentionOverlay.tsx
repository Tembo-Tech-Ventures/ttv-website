import { useEffect } from "react";
import type { Me } from "@/lib/platform/contracts";
import type { ApiClient } from "@/lib/platform/client/apiClient";
import AttentionPanel from "@/components/platform/attention/AttentionPanel";
import type { Announcer } from "@/components/platform/attention/attention-announcer";
import { useAttentionOwner } from "@/components/platform/attention/attention-client";

type AttentionOverlayProps = {
  me: Me;
  /** The overlays island's announcer, whose live region was in the page before this loaded. */
  announcer: Announcer;
  /** Count at once: loaded for a poll that was due, or because another island asked (QA4-07). */
  countNow: boolean;
  api?: ApiClient;
};

/**
 * The page's attention store and panel, which PlatformOverlays loads on demand: the store, its API
 * client and the contract schemas it validates with are about 30 KB gzipped, so they wait until the
 * bell is pressed, a count is due, or another island asks for one.
 */
export default function AttentionOverlay({ me, announcer, countNow, api }: AttentionOverlayProps) {
  const owner = useAttentionOwner(me, { api, announcer });
  // Counts poll (and the bell stays current) whether or not the panel is open.
  useEffect(() => owner.store.retain(), [owner]);
  useEffect(() => {
    if (countNow) owner.store.refreshCounts().catch(() => { /* The store keeps the error; the next poll tries again. */ });
  }, [owner, countNow]);
  return <AttentionPanel owner={owner} me={me} />;
}
