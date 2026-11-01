import { describe, expect, it, vi } from "vitest";
import { onboardingDatabase } from "@/lib/onboarding/test-support";
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
      {
        results: [
          {
            id: "feedback-1",
            kind: "BUG",
            message: "The   apply button\ndoes nothing",
            userName: "Kwame",
            createdAt: timestamp,
          },
          {
            id: "feedback-2",
            kind: "IDEA",
            message: "",
            userName: "Amina",
            createdAt: timestamp,
          },
        ],
      },
      {
        results: [
          {
            id: "access-1",
            role: "INSTITUTION",
            organisation: "Savanna Mobile Labs",
            userName: "Joseph",
            createdAt: now.getTime() - 60_000,
          },
          {
            id: "access-2",
            role: "MENTOR",
            organisation: null,
            userName: " ",
            createdAt: now.getTime(),
          },
        ],
      },
    ]);
    const db = { prepare, batch } as unknown as D1Database;

    const groups = await getAdminAttention(db, now);

    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0]).toHaveLength(7);
    expect(groups.map((group) => group.items[0]?.href)).toEqual([
      "/admin/access-requests",
      "/admin/feedback/feedback-1",
      "/admin/recordings/recording-1",
      "/admin/recordings/import",
      "/admin#attention-error-signatures",
      "/admin/projects/project-1",
      "/admin/profiles/profile-1",
    ]);
    expect(JSON.stringify(groups)).not.toContain("private-value");
    expect(groups[0].items).toEqual([
      { id: "access-1", title: "Institution access for Joseph", detail: "Savanna Mobile Labs",
        href: "/admin/access-requests", occurredAt: "2026-09-25T04:29:00.000Z" },
      { id: "access-2", title: "Mentor access for a member", detail: "Waiting for a decision",
        href: "/admin/access-requests", occurredAt: "2026-09-25T04:30:00.000Z" },
    ]);
    expect(groups[1].items).toMatchObject([
      { title: "Something's broken from Kwame", detail: "The apply button does nothing" },
      { title: "Idea from Amina", detail: "Screenshot only" },
    ]);
    expect(groups[4].items[0]).toMatchObject({
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

  it("lists pending access requests oldest first, without the requester's note", async () => {
    const { db, database } = onboardingDatabase();
    try {
      database.exec(`INSERT INTO access_request (id, userId, role, status, note, decidedAt, createdAt, updatedAt) VALUES
        ('newer', 'otieno', 'MENTOR', 'PENDING', 'Private note: I review Kotlin and Swift apps.', NULL, 2000, 2000),
        ('older', 'wairimu', 'MENTOR', 'PENDING', 'Private note: I review Kotlin and Swift apps.', NULL, 1000, 1000),
        ('decided', 'wairimu', 'MENTOR', 'DECLINED', 'Private note: I review Kotlin and Swift apps.', 500, 100, 500);
        INSERT INTO access_request (id, userId, role, note, organisation, scopeAcknowledgedAt, createdAt, updatedAt)
        VALUES ('institution', 'otieno', 'INSTITUTION', 'Private note: we hire junior mobile developers.', 'Savanna Mobile Labs', 3000, 3000, 3000);`);
      // The test D1's batch runs statements without returning rows; these are all reads.
      const reads = { prepare: db.prepare.bind(db), batch: (statements: D1PreparedStatement[]) => Promise.all(statements.map((statement) => statement.all())) };
      const group = (await getAdminAttention(reads as unknown as D1Database)).find((candidate) => candidate.id === "access-requests");
      expect(group?.items.map((item) => [item.id, item.title, item.detail])).toEqual([
        ["older", "Mentor access for Wairimu Ndung'u", "Waiting for a decision"],
        ["newer", "Mentor access for Otieno Ouma", "Waiting for a decision"],
        ["institution", "Institution access for Otieno Ouma", "Savanna Mobile Labs"],
      ]);
      expect(JSON.stringify(group)).not.toContain("Private note");
    } finally {
      database.close();
    }
  });
});
