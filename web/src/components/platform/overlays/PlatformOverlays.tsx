import { useEffect } from "react";
import type { Me } from "@/lib/platform/contracts";
import type { ApiClient } from "@/lib/platform/client/apiClient";
import AttentionPanel from "@/components/platform/attention/AttentionPanel";
import { useAttentionOwner } from "@/components/platform/attention/attention-client";
import SearchOverlay from "@/components/platform/search/SearchOverlay";
import type { HarnessScenario } from "./harness-clients";
import { useHarnessClients } from "./harness-loader";
import LiveRegions from "./LiveRegions";

type PlatformOverlaysProps = {
  /** The signed-in person's context, from getSpaceContext. Nothing else about the session. */
  me: Me;
  /**
   * Whether this island owns attention (the panel, the live counts). The
   * attention page owns its own inbox, so it mounts these overlays without it.
   */
  attention?: boolean;
  /** DEV harness only: answer from fixtures, in this scenario, instead of the API. */
  harness?: HarnessScenario;
};

function AttentionOverlay({ me, api }: { me: Me; api?: ApiClient }) {
  const owner = useAttentionOwner(me, { api });
  // Counts poll (and the bell stays current) whether or not the panel is open.
  useEffect(() => owner.store.retain(), [owner]);
  return (
    <>
      <AttentionPanel owner={owner} me={me} />
      <LiveRegions announcer={owner.announcer} name="attention" />
    </>
  );
}

/**
 * The shell's overlays for a space page: search everything (Ctrl K / ⌘ K) and
 * the attention panel. Mount it in SpacesLayout's `overlays` slot and pass
 * `overlays={["search", "attention"]}`, so the shell shows their triggers.
 */
export default function PlatformOverlays({ me, attention = true, harness }: PlatformOverlaysProps) {
  const clients = useHarnessClients(harness);
  return (
    <>
      <SearchOverlay me={me} client={clients?.search} />
      {attention && <AttentionOverlay me={me} api={clients?.attention} />}
    </>
  );
}
