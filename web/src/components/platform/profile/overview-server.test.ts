import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db/schema";

vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1" } }));
const { opportunityFacts } = await import("./overview-server");

/** A database that fails the test if anything reads it. */
const untouchable = new Proxy({}, { get: (_, key) => { throw new Error(`read ${String(key)}`); } }) as unknown as Database;

function database(projects: { id: string; title: string; organization: string }[], raised: string[]) {
  return {
    query: {
      clientProject: { findMany: vi.fn(async () => projects) },
      projectInterest: { findMany: vi.fn(async () => raised.map((projectId) => ({ projectId }))) },
    },
  } as unknown as Database;
}

const PUBLISHED = { id: "profile-1", status: "PUBLISHED" as const };

describe("opportunityFacts", () => {
  it("reads nothing while the journey has not opened Opportunities, even with a published profile", async () => {
    await expect(opportunityFacts(untouchable, PUBLISHED, false)).resolves.toEqual({ gate: "published", items: [] });
  });

  it("reads nothing behind the page's own gate: no profile, a draft or a suspended one", async () => {
    await expect(opportunityFacts(untouchable, null, true)).resolves.toEqual({ gate: "no_profile", items: [] });
    await expect(opportunityFacts(untouchable, { id: "p", status: "DRAFT" }, true)).resolves.toMatchObject({ gate: "not_published", items: [] });
    await expect(opportunityFacts(untouchable, { id: "p", status: "SUSPENDED" }, true)).resolves.toMatchObject({ items: [] });
  });

  it("lists approved projects with the person's raised hands once both are open", async () => {
    const db = database([{ id: "a", title: "Inventory sync", organization: "Shop" }, { id: "b", title: "Fees reminder", organization: "School" }], ["b"]);
    await expect(opportunityFacts(db, PUBLISHED, true)).resolves.toEqual({
      gate: "published",
      items: [
        { id: "a", title: "Inventory sync", organization: "Shop", interested: false },
        { id: "b", title: "Fees reminder", organization: "School", interested: true },
      ],
    });
  });
});
