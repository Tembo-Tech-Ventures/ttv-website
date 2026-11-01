// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createChannelStore } from "@/lib/platform/client/channel";
import { createComposer } from "@/lib/platform/client/composer";
import { FIXTURE_NOW, meByPersona, messages } from "@/lib/platform/fixtures";
import ChannelSurface from "./ChannelSurface";
import { channelFor, channelPage } from "./harness/fixture-pages";
import { createHarnessClient } from "./harness/harness-client";

// Count how often message words render: each MessageItem that renders draws its body once.
const bodies = vi.hoisted(() => ({ count: 0 }));
vi.mock("./MessageBody", () => ({
  default: ({ body }: { body: string }) => {
    bodies.count += 1;
    return <p>{body}</p>;
  },
}));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("does not render the messages again when only the reader's place in the list changes (#287 review)", async () => {
  const me = meByPersona.wanjiku;
  const channel = channelFor("cohort-04", me)!;
  const initial = channelPage(channel, me);
  const client = createHarnessClient({ me, channel, root: initial });
  const store = createChannelStore({ channelId: channel.id, enabled: true, viewerId: me.user.id, initial, api: client.api });
  const composer = createComposer({ store, me, api: client.api });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<ChannelSurface me={me} channel={channel} store={store} composer={composer} now={FIXTURE_NOW} shareables={null} />));
  await act(async () => new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  }));
  expect(bodies.count).toBeGreaterThan(0);

  const before = bodies.count;
  await act(async () => store.setAnchor(messages.duplicateQuestion.id));
  await act(async () => store.setAnchor(messages.sessionTime.id));
  expect(store.getState().anchorId).toBe(messages.sessionTime.id);
  expect(bodies.count).toBe(before);

  await act(async () => root.unmount());
  container.remove();
});
