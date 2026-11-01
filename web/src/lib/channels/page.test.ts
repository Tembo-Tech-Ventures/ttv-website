import { afterEach, describe, expect, it, vi } from "vitest";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { findReadableChannel } from "./access";
import { loadChannelPage } from "./page";
import { channelDatabase, VIEWER, type ChannelFixture } from "./test-support";

const fixtures: ChannelFixture[] = [];
afterEach(() => { fixtures.splice(0).forEach(({ database }) => database.close()); vi.restoreAllMocks(); });

async function setup() {
  const s = channelDatabase();
  fixtures.push(s);
  const user = { id: VIEWER };
  const channel = (await findReadableChannel(s.db, user, { space: "community", slug: "help" }, await capabilitiesFor(s.db, user)))!;
  return { s, channel };
}

describe("loadChannelPage", () => {
  it("renders the latest roots, the open thread and the read marker, without moving the marker", async () => {
    const { s, channel } = await setup();
    const [first, second] = [s.message("help"), s.message("help")];
    const reply = s.message("help", { parentId: first });
    s.database.prepare("INSERT INTO channel_read(userId, channelId, lastReadMessageId, readAt) VALUES (?, ?, ?, 1)").run(VIEWER, channel.id, first);
    const before = s.database.prepare("SELECT * FROM channel_read").all();
    const page = await loadChannelPage(s.db, s.d1, VIEWER, channel, { thread: first });
    expect(page.initial.items.map((item) => item.id)).toEqual([first, second]);
    expect(page.thread?.items.map((item) => item.id)).toEqual([reply]);
    expect(page.thread?.thread).toBe(first);
    expect(page.read).toEqual({ lastReadMessageId: first, unreadCount: 1 });
    expect(s.database.prepare("SELECT * FROM channel_read").all()).toEqual(before);
  });

  it.each([
    ["no thread", undefined], ["an empty thread parameter", ""], ["an id that is too long", "x".repeat(256)],
    ["a missing message", "message-missing"], ["a reply", "reply"], ["another channel's message", "elsewhere"],
  ])("gives thread null for %s, and the page still renders", async (_name, thread) => {
    const { s, channel } = await setup();
    const root = s.message("help");
    const ids: Record<string, string> = { reply: s.message("help", { parentId: root }), elsewhere: s.message("introductions") };
    const page = await loadChannelPage(s.db, s.d1, VIEWER, channel, { thread: thread && (ids[thread] ?? thread) });
    expect(page.thread).toBeNull();
    expect(page.initial.items.map((item) => item.id)).toEqual([root]);
    expect(page.read).toEqual({ lastReadMessageId: null, unreadCount: 1 });
  });

  it("reads in two statements, four with a thread", async () => {
    const { s, channel } = await setup();
    const root = s.message("help");
    const prepare = vi.spyOn(s.d1, "prepare");
    await loadChannelPage(s.db, s.d1, VIEWER, channel);
    expect(prepare).toHaveBeenCalledTimes(2);
    prepare.mockClear();
    await loadChannelPage(s.db, s.d1, VIEWER, channel, { thread: root });
    expect(prepare).toHaveBeenCalledTimes(4);
  });

  it("propagates database failures instead of rendering an empty channel", async () => {
    const { s, channel } = await setup();
    const prepare = s.d1.prepare.bind(s.d1);
    vi.spyOn(s.d1, "prepare").mockImplementation(((query: string) => {
      if (query.includes("parentId = ?5")) throw new Error("D1 unavailable");
      return prepare(query);
    }) as typeof s.d1.prepare);
    await expect(loadChannelPage(s.db, s.d1, VIEWER, channel, { thread: s.message("help") })).rejects.toThrow("D1 unavailable");
  });
});
