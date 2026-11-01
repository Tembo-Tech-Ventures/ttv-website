import { describe, expect, it, vi } from "vitest";
import type { Me } from "@/lib/platform/contracts";
import { channelList, channels, meByPersona } from "@/lib/platform/fixtures";
import { loadSidebarChannels } from "./sidebar-channels";

const off = (me: Me): Me => ({ ...me, flags: { ...me.flags, channels: false } });

describe("the channels a sidebar lists", () => {
  it("are never read while channels is off for the person, so the sidebar stays as it was", async () => {
    const list = vi.fn(async () => channelList.items);
    const report = vi.fn(async () => {});
    for (const space of ["community", "cohort"] as const) {
      expect(await loadSidebarChannels(off(meByPersona.wanjiku), space, list, report)).toBeNull();
    }
    expect(list).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("are only read for Community and Cohort, the spaces that have channels", async () => {
    const list = vi.fn(async () => channelList.items);
    for (const space of ["mentoring", "discover", "admin", "profile"] as const) {
      expect(await loadSidebarChannels(meByPersona.amina, space, list, vi.fn())).toBeNull();
    }
    expect(list).not.toHaveBeenCalled();
  });

  it("are what the backend says this person can read, with the open channel marked", async () => {
    const items = [channels.introductions, channels.help];
    expect(await loadSidebarChannels(meByPersona.lucy, "community", async () => items, vi.fn(), channels.help.id))
      .toEqual({ items, currentId: channels.help.id });
    expect(await loadSidebarChannels(meByPersona.lucy, "community", async () => items, vi.fn())).toEqual({ items, currentId: null });
  });

  it("leave the sidebar as it was when the list fails, and report why", async () => {
    const failure = new Error("D1 unavailable");
    const report = vi.fn(async () => {});
    expect(await loadSidebarChannels(meByPersona.wanjiku, "cohort", async () => { throw failure; }, report)).toBeNull();
    expect(report).toHaveBeenCalledExactlyOnceWith(failure);
  });
});
