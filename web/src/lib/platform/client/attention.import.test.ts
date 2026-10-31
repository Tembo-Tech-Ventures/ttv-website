import { expect, it, vi } from "vitest";

// Production entry points must stay usable without loading any synthetic transport/data.
vi.mock("../fixtures", () => { throw new Error("Synthetic fixtures imported by the production attention entry"); });
vi.mock("./mockTransport", () => { throw new Error("Mock transport imported by the production attention entry"); });

it("loads production attention hooks/store without synthetic fixture modules", async () => {
  const { createAttentionStore, useAttention, useAttentionCount, useAttentionBadge } = await import("./attention");
  const store = createAttentionStore();
  expect(store.getState().counts.count).toBe(0);
  expect([useAttention, useAttentionCount, useAttentionBadge].every(hook => typeof hook === "function")).toBe(true);
  store.stop();
});
