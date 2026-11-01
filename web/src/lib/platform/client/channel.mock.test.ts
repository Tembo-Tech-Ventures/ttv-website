import { describe, expect, it } from "vitest";
import { ROUTES } from "../contracts";
import {
  channelList, channels, cohortMessages, cohortThread, communityMessages, communityThread, messages, people, projects, sessionClip,
} from "../fixtures";
import { createChannelStore } from "./channel";
import { createChannelListStore } from "./channelList";
import { createChannelMockClient } from "./channel.mock";
import { createComposer } from "./composer";

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

  it("posts idempotently on the nonce and shows posts in later pages", async () => {
    const api = createChannelMockClient({ now: () => 1_000 });
    const body = { body: "Habari from the harness", clientNonce: "n1", parentId: null, embeds: [] };
    const first = await api.call(ROUTES.postMessage, { params: { id: channels.showYourWork.id }, body });
    const replay = await api.call(ROUTES.postMessage, { params: { id: channels.showYourWork.id }, body });
    expect(replay).toEqual(first);
    expect(first).toMatchObject({ author: people.wanjiku, clientNonce: "n1", createdAt: 1_000 });
    const latest = await api.call(ROUTES.listMessages, { params: { id: channels.showYourWork.id }, query: {} });
    expect(latest.items.filter(item => item.id === first.id)).toHaveLength(1);
    const reply = await api.call(ROUTES.postMessage, {
      params: { id: channels.showYourWork.id },
      body: { ...body, clientNonce: "n2", parentId: messages.projectPost.id, embeds: [{ type: "project", journeyId: projects.chamaLedger.journeyId, version: projects.chamaLedger.version }] },
    });
    expect(reply.embeds).toEqual([projects.chamaLedger]);
    const thread = await api.call(ROUTES.listMessages, { params: { id: channels.showYourWork.id }, query: { thread: messages.projectPost.id } });
    expect(thread.items).toContainEqual(reply);
    const clip = await api.call(ROUTES.postMessage, {
      params: { id: channels.cohort04.id },
      body: { ...body, clientNonce: "n3", embeds: [{ type: "sessionClip", recordingId: sessionClip.recordingId, startSeconds: 0, durationSeconds: 30 }] },
    });
    expect(clip.embeds).toEqual([sessionClip]);
    await expect(api.call(ROUTES.postMessage, {
      params: { id: channels.showYourWork.id }, body: { ...body, clientNonce: "n4", embeds: [{ type: "project", journeyId: "unknown", version: 1 }] },
    })).rejects.toMatchObject({ status: 400, code: "validation" });
  });

  it("lets the viewer edit, delete and react, and refuses everything else as the server would", async () => {
    const api = createChannelMockClient({ viewer: people.achieng });
    const id = messages.projectPost.id;
    const edited = await api.call(ROUTES.editMessage, { params: { id }, body: { body: "Updated" } });
    expect(edited).toMatchObject({ body: "Updated", edited: true });
    const { reactions } = await api.call(ROUTES.reactToMessage, { params: { id }, body: { kind: "useful", active: false } });
    expect(reactions).toEqual([{ kind: "useful", count: 5, mine: false }, { kind: "learned", count: 4, mine: false }]);
    const placeholder = await api.call(ROUTES.deleteMessage, { params: { id } });
    expect(placeholder).toMatchObject({ deleted: true, body: "", embeds: [] });
    expect(await api.call(ROUTES.deleteMessage, { params: { id } })).toEqual(placeholder);
    await expect(api.call(ROUTES.editMessage, { params: { id }, body: { body: "Too late" } })).rejects.toMatchObject({ status: 409 });
    await expect(api.call(ROUTES.reactToMessage, { params: { id }, body: { kind: "useful", active: true } })).rejects.toMatchObject({ status: 404 });
    await expect(api.call(ROUTES.editMessage, { params: { id: messages.mentorReply.id }, body: { body: "Not mine" } })).rejects.toMatchObject({ status: 403 });
    await expect(api.call(ROUTES.editMessage, { params: { id: "missing" }, body: { body: "x" } })).rejects.toMatchObject({ status: 404 });
    const latest = await api.call(ROUTES.listMessages, { params: { id: channels.showYourWork.id }, query: {} });
    expect(latest.items.find(item => item.id === id)?.deleted).toBe(true);
  });

  it("drives the composer end to end, and passes failures through for harness states", async () => {
    let offline = true;
    const api = createChannelMockClient({ failure: request => offline && request.method === "POST" ? new TypeError("offline") : undefined });
    const store = createChannelStore({ channelId: channels.help.id, enabled: true, mock: api });
    const composer = createComposer({ store, me: { user: people.wanjiku, flags: { tembo_channels: true } }, mock: api, storage: undefined });
    const release = composer.retain();
    await store.poll(new AbortController().signal);
    await expect(composer.send({ body: "Asante!", parentId: null, embeds: [] })).rejects.toMatchObject({ code: "network_error" });
    offline = false;
    const message = await composer.retry(composer.getState().outbox[0].clientNonce);
    expect(store.getState().messages.at(-1)).toEqual(message);
    await composer.react(messages.helpQuestion.id, "thanks", true);
    expect(store.getState().messages[0].reactions).toContainEqual({ kind: "thanks", count: 1, mine: true });
    expect(composer.mentionCandidates(channels.help.id)).toEqual({ tembo: true, people: [people.kevin] });
    release();
  });
});
