import { describe, expect, it } from "vitest";
import { ROUTES } from "../contracts";
import { channelList, channels, cohortMessages, cohortThread, communityMessages, communityThread, messages } from "../fixtures";
import { createChannelStore } from "./channel";
import { createChannelListStore } from "./channelList";
import { createChannelMockClient } from "./channel.mock";

describe("channel mock client", () => {
  it("serves the fixture scenes and threads through the validated API client", async () => {
    const api = createChannelMockClient();
    const call = (id: string, query = {}) => api.call(ROUTES.listMessages, { params: { id }, query });
    expect(await api.call(ROUTES.listChannels)).toEqual(channelList);
    expect(await call(channels.showYourWork.id)).toEqual(communityMessages);
    expect(await call(channels.showYourWork.id, { thread: communityThread.thread! })).toEqual(communityThread);
    expect(await call(channels.cohort04.id)).toEqual(cohortMessages);
    expect(await call(channels.cohort04.id, { thread: cohortThread.thread! })).toEqual(cohortThread);
    const help = await call(channels.help.id);
    expect(help.items.map(item => item.id)).toEqual([messages.helpQuestion.id]);
    const older = await call(channels.showYourWork.id, { before: communityMessages.beforeCursor! });
    expect(older).toMatchObject({ items: [], beforeCursor: null });
    const since = await call(channels.showYourWork.id, { since: "cursor" });
    expect(since).toMatchObject({ items: [], sinceCursor: "cursor", removedIds: [] });
    expect(await call("empty")).toMatchObject({ items: [], beforeCursor: null });
  });

  it("drives a channel store and the shared unread list without the network", async () => {
    const api = createChannelMockClient();
    const list = createChannelListStore({ enabled: true, mock: api });
    await list.refresh();
    const store = createChannelStore({ channelId: channels.help.id, enabled: true, mock: api, onRead: list.applyRead });
    await store.poll(new AbortController().signal);
    expect(store.getState().messages.map(item => item.id)).toEqual([messages.helpQuestion.id]);
    expect(await store.markRead(messages.helpQuestion.id)).toBe(true);
    expect(list.getState().channels.find(channel => channel.id === channels.help.id)?.unreadCount).toBe(0);
    await list.refresh();
    expect(list.getState().channels.find(channel => channel.id === channels.help.id)?.unreadCount).toBe(0);
    // Each mock client is isolated.
    const fresh = await createChannelMockClient().call(ROUTES.listChannels);
    expect(fresh.items.find(channel => channel.id === channels.help.id)?.unreadCount).toBe(3);
  });
});
