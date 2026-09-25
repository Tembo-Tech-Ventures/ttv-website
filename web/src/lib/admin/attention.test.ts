import { describe, expect, it, vi } from "vitest";
import { getAdminAttention } from "./attention";

describe("admin attention query", () => {
  it("loads bounded actionable rows with age thresholds and admin links", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const prepare = vi.fn((sql: string) => {
      const statement = {
        sql,
        values: [] as unknown[],
        bind: (...values: unknown[]) => {
          const bound = { sql, values };
          statements.push(bound);
          return bound;
        },
      };
      statements.push(statement);
      return statement;
    });
    const now = new Date("2026-09-25T04:30:00.000Z");
    const timestamp = Math.floor(now.getTime() / 1_000) - 60;
    const batch = vi.fn().mockResolvedValue([
      {
        results: [
          {
            id: "recording-1",
            title: "Workshop recording",
            processingError: "Bearer private-value failed",
            updatedAt: timestamp,
          },
        ],
      },
      {
        results: [
          {
            id: "import-1",
            name: "Drive folder",
            lastError: "token=private-value rejected",
            updatedAt: timestamp,
          },
        ],
      },
      {
        results: [
          {
            signature: "signature-1",
            source: "request",
            route: "/api/projects/:id",
            count: 14,
            lastSeenAt: timestamp,
          },
        ],
      },
      {
        results: [
          {
            id: "project-1",
            title: "Clinic booking",
            organization: "Baraka Health",
            createdAt: timestamp,
          },
        ],
      },
      {
        results: [
          {
            id: "contact-1",
            profileId: "profile-1",
            fromName: "Client",
            profileName: "Amina",
            createdAt: timestamp,
          },
        ],
      },
    ]);
    const db = { prepare, batch } as unknown as D1Database;

    const groups = await getAdminAttention(db, now);

    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0]).toHaveLength(5);
    expect(groups.map((group) => group.items[0]?.href)).toEqual([
      "/admin/recordings/recording-1",
      "/admin/recordings/import",
      "/admin#attention-error-signatures",
      "/admin/projects/project-1",
      "/admin/profiles/profile-1",
    ]);
    expect(JSON.stringify(groups)).not.toContain("private-value");
    expect(groups[2].items[0]).toMatchObject({
      title: "request · /api/projects/:id",
      detail: "14 occurrences",
    });

    const boundStatements = statements.filter((statement) => statement.values.length > 0);
    expect(boundStatements.map((statement) => statement.values[0])).toEqual([
      Math.floor(now.getTime() / 1_000) - 7 * 24 * 60 * 60,
      Math.floor(now.getTime() / 1_000) - 3 * 24 * 60 * 60,
      Math.floor(now.getTime() / 1_000) - 7 * 24 * 60 * 60,
    ]);
    for (const statement of batch.mock.calls[0][0]) {
      expect(statement.sql).toContain("LIMIT 10");
    }
  });
});
