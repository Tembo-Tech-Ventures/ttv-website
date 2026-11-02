import { describe, expect, it, vi } from "vitest";
import type { Me } from "@/lib/platform/contracts";
import { channelList, channels, meByPersona } from "@/lib/platform/fixtures";
import { channelShortcuts, loadShortcutChannels, SHORTCUT_LIMIT } from "./channel-shortcuts";

const off = (me: Me): Me => ({ ...me, flags: { ...me.flags, channels: false } });
const ids = (model: ReturnType<typeof channelShortcuts>) => model?.channels.map(({ id }) => id);

describe("channelShortcuts (QA2-16)", () => {
  it("links the Cohort overview to the cohort's channels, with their unread counts", () => {
    const model = channelShortcuts(meByPersona.wanjiku, "cohort", channelList.items);
    expect(ids(model)).toEqual([channels.cohort04.id, channels.cohortHelp.id, channels.cohortAnnouncements.id]);
    expect(model?.channels[1]).toEqual({ id: channels.cohortHelp.id, href: "/dashboard/cohort/c/c04-help", name: "c04-help", unread: 2 });
    expect(model?.more).toBe(false);
  });

  it("links Community to a few community channels, never a direct conversation, and says where the rest are", () => {
    const model = channelShortcuts(meByPersona.wanjiku, "community", channelList.items);
    expect(model?.channels).toHaveLength(SHORTCUT_LIMIT);
    expect(model?.channels.every(({ href }) => href.startsWith("/dashboard/community/c/"))).toBe(true);
    expect(ids(model)).not.toContain(channels.davidConversation.id);
    expect(model?.more).toBe(true);
  });

  it("links a mentor's landing only to channels in spaces they can open", () => {
    // Mercy mentors in Community and has no Cohort space: no cohort channel is offered.
    const model = channelShortcuts(meByPersona.mercy, "mentoring", channelList.items);
    expect(model?.channels.every(({ href }) => href.startsWith("/dashboard/community/c/"))).toBe(true);
    expect(channelShortcuts(meByPersona.david, "mentoring", [channels.cohort04])?.channels.map(({ href }) => href)).toEqual(["/dashboard/cohort/c/cohort-04"]);
  });

  it("shows nothing while channels is off, whatever the list says", () => {
    for (const space of ["cohort", "community", "mentoring"] as const) {
      expect(channelShortcuts(off(meByPersona.david), space, channelList.items)).toBeNull();
    }
  });

  it("shows nothing without a list, on other pages, or with nothing open", () => {
    expect(channelShortcuts(meByPersona.wanjiku, "cohort", null)).toBeNull();
    expect(channelShortcuts(meByPersona.wanjiku, "profile", channelList.items)).toBeNull();
    expect(channelShortcuts(meByPersona.wanjiku, "cohort", [{ ...channels.cohort04, archivedAt: 1 }])).toBeNull();
  });
});

describe("loadShortcutChannels", () => {
  it("reads nothing while channels is off", async () => {
    const list = vi.fn(async () => channelList.items);
    expect(await loadShortcutChannels(off(meByPersona.wanjiku), list, async () => {})).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it("reports a failed read and leaves the card out", async () => {
    const report = vi.fn(async () => {});
    const failure = new Error("D1 down");
    expect(await loadShortcutChannels(meByPersona.wanjiku, async () => { throw failure; }, report)).toBeNull();
    expect(report).toHaveBeenCalledWith(failure);
    expect(await loadShortcutChannels(meByPersona.wanjiku, async () => channelList.items, report)).toBe(channelList.items);
  });
});
