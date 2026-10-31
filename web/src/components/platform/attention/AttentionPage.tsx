import { useEffect, useId, useRef } from "react";
import type { AttentionList, Me } from "@/lib/platform/contracts";
import { useAttention } from "@/lib/platform/client/attention";
import type { ApiClient } from "@/lib/platform/client/apiClient";
import { onShellOverlay } from "@/components/platform/shell/overlays";
import LiveRegions from "@/components/platform/overlays/LiveRegions";
import type { HarnessScenario } from "@/components/platform/overlays/harness-clients";
import { useHarnessClients } from "@/components/platform/overlays/harness-loader";
import { loadAndAnnounce, useAttentionOwner } from "./attention-client";
import { unreadTotal } from "./attention-display";
import AttentionInbox, { MarkAll, useNow } from "./AttentionInbox";
import "./attention.css";

type AttentionPageProps = {
  me: Me;
  /** The first page, read on the server, so the list is there before (and without) JavaScript. */
  initialList?: AttentionList;
  /** DEV harness only: answer from fixtures, in this scenario. Pages leave it out. */
  harness?: HarnessScenario;
};

/**
 * The attention page: the phone's way in (the bell leads here below the wide
 * layout), and a full-page inbox on any screen. This island owns the page's
 * attention store, so it also keeps the bell and tabs current; the bell, here,
 * brings you back to the top of the list.
 */
export default function AttentionPage({ me, initialList, harness }: AttentionPageProps) {
  const clients = useHarnessClients(harness);
  return <AttentionPageView me={me} initialList={initialList} api={clients?.attention} />;
}

/** The page itself, with its API client: the real one unless a harness or test supplies another. */
export function AttentionPageView({ me, initialList, api }: { me: Me; initialList?: AttentionList; api?: ApiClient }) {
  const owner = useAttentionOwner(me, { initialList, api });
  const { store } = owner;
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const now = useNow(initialList?.snapshotAt ?? null);
  const total = useAttention(store, (state) => unreadTotal(state.counts.unreadCounts, me.spaces));

  useEffect(() => {
    if (!initialList) void loadAndAnnounce(owner, () => store.refresh());
  }, [owner, store, initialList]);

  useEffect(
    () =>
      onShellOverlay("attention", () => {
        heading.current?.scrollIntoView({ block: "start" });
        heading.current?.focus();
      }),
    [],
  );

  return (
    <div className="attention-page">
      <header className="attention-page__header">
        <h1 id={headingId} ref={heading} tabIndex={-1} className="attention-page__title tracking-heading">
          Needs your attention
        </h1>
        <div className="attention-page__summary">
          <p className="attention-page__count" data-attention-total={total}>
            {total === 0 ? "You're all caught up." : `${total} new`}
          </p>
          <MarkAll owner={owner} me={me} />
        </div>
      </header>
      <AttentionInbox owner={owner} me={me} headingId={headingId} now={now} />
      <LiveRegions announcer={owner.announcer} name="attention" />
    </div>
  );
}
