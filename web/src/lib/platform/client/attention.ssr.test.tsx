import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { attention, attentionCount } from "../fixtures";
import { createApiClient } from "./apiClient";
import { createAttentionStore, useAttention, useAttentionBadge, useAttentionCount } from "./attention";

it("imports without browser globals and renders immutable hydration snapshots without requests", () => {
  expect(typeof window).toBe("undefined"); expect(typeof document).toBe("undefined");
  const fetch = vi.fn(); const store = createAttentionStore({ enabled: true, api: createApiClient({ fetch }), initialList: attention, initialCounts: attentionCount });
  function View() {
    const count = useAttentionCount(store); const badge = useAttentionBadge(store, "cohort"); const items = useAttention(store, state => state.items);
    return <span>{count}:{badge}:{items.length}</span>;
  }
  const snapshot = store.getServerSnapshot(); expect(renderToString(<View />)).toBe("<span>4<!-- -->:<!-- -->2<!-- -->:<!-- -->6</span>");
  expect(fetch).not.toHaveBeenCalled(); expect(store.getServerSnapshot()).toBe(snapshot);
  store.stop(); expect(store.getServerSnapshot()).toBe(snapshot);
});
