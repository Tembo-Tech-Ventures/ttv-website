import { describe, expect, it, vi } from "vitest";
import type { Me } from "@/lib/platform/contracts";
import { attention, meByPersona } from "@/lib/platform/fixtures";
import { attentionPageData } from "./attention-page-data";

const wanjiku = meByPersona.wanjiku;
const list = () => Promise.resolve(attention);

describe("attentionPageData", () => {
  it("is missing while the spaces flag is off, signed out or for a token (a thrown Response)", async () => {
    const reader = vi.fn(list);
    const data = await attentionPageData({ context: () => Promise.reject(new Response(null, { status: 404 })), cookie: null, list: reader });
    expect(data).toEqual({ kind: "missing" });
    expect(reader).not.toHaveBeenCalled();
  });

  it("lets other failures loading context surface", async () => {
    await expect(attentionPageData({ context: () => Promise.reject(new Error("db down")), cookie: null, list })).rejects.toThrow("db down");
  });

  it("is missing when Me says the flag is off, even if context resolved", async () => {
    const off: Me = { ...wanjiku, flags: { ...wanjiku.flags, spaces: false } };
    expect(await attentionPageData({ context: () => Promise.resolve(off), cookie: null, list })).toEqual({ kind: "missing" });
  });

  it("sits in the space the person was last in, if they still have it", async () => {
    const data = await attentionPageData({ context: () => Promise.resolve(wanjiku), cookie: "ttv-last-space=community", list });
    expect(data).toMatchObject({ kind: "page", space: "community" });
    const elsewhere = await attentionPageData({ context: () => Promise.resolve(wanjiku), cookie: "ttv-last-space=admin", list });
    expect(elsewhere).toMatchObject({ kind: "page", space: "cohort" });
  });

  it("renders the first page from the service, contract fields only", async () => {
    const extra = { ...attention, items: attention.items.map((item) => ({ ...item, userId: "secret" })) };
    const data = await attentionPageData({ context: () => Promise.resolve(wanjiku), cookie: null, list: () => Promise.resolve(extra) });
    expect(data.kind === "page" && data.initialList?.items).toHaveLength(attention.items.length);
    expect(JSON.stringify(data)).not.toContain("secret");
  });

  it("still renders when the list cannot be read, leaving the island to load it", async () => {
    const data = await attentionPageData({ context: () => Promise.resolve(wanjiku), cookie: null, list: () => Promise.reject(new Error("busy")) });
    expect(data).toEqual({ kind: "page", me: wanjiku, space: "cohort" });
  });
});
