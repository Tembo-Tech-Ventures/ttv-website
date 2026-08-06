import { describe, expect, it, vi } from "vitest";
import {
  AGENT_PREVIEW_SESSION_MARKER,
  AGENT_PREVIEW_USER_ID,
  assertAgentEnvironmentName,
  deriveAgentPreviewAuthSecret,
  deriveAgentPreviewToken,
  seedAgentPreviewAccess,
  seedAgentPreviewFixtures,
} from "./agent-preview-auth.mjs";

describe("agent preview identity", () => {
  it("accepts bounded agent names and rejects ambiguous resource names", () => {
    expect(assertAgentEnvironmentName("agent-pr-55")).toBe("agent-pr-55");
    expect(() => assertAgentEnvironmentName("staging")).toThrow(
      'must start with "agent-"'
    );
    expect(() =>
      assertAgentEnvironmentName(`agent-${"a".repeat(40)}`)
    ).toThrow("at most 40");
    expect(() => assertAgentEnvironmentName("agent-trailing-")).toThrow(
      "may not end"
    );
  });

  it("derives separate, environment-specific session and auth secrets", () => {
    const secret = "s".repeat(32);
    const firstToken = deriveAgentPreviewToken(secret, "agent-pr-55");
    expect(firstToken).toHaveLength(64);
    expect(deriveAgentPreviewToken(secret, "agent-pr-56")).not.toBe(firstToken);
    expect(deriveAgentPreviewAuthSecret(secret, "agent-pr-55")).not.toBe(
      firstToken
    );
    expect(() => deriveAgentPreviewToken("too-short", "agent-pr-55")).toThrow(
      "at least 32"
    );
  });

  it("seeds an expiring isolated admin without exposing the token", async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ results: [{ id: "existing-admin-role" }] }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await seedAgentPreviewAccess({
      databaseId: "db-123",
      environmentName: "agent-pr-55",
      previewSecret: "p".repeat(32),
      executeQuery,
      now: new Date("2026-07-14T12:00:00.000Z"),
    });

    expect(result).toEqual({
      userId: "ttv-agent-preview-user",
      sessionId: "ttv-agent-preview-session",
      expiresAt: new Date("2026-07-14T20:00:00.000Z"),
    });
    expect(result).not.toHaveProperty("token");
    expect(executeQuery).toHaveBeenCalledTimes(5);
    expect(executeQuery.mock.calls[3][2]).toContain("existing-admin-role");
    expect(executeQuery.mock.calls[4][2]).toContain(
      AGENT_PREVIEW_SESSION_MARKER
    );
    expect(executeQuery.mock.calls[4][2][2]).toHaveLength(64);
  });
});

describe("seedAgentPreviewFixtures", () => {
  it("requires a database ID", async () => {
    await expect(
      seedAgentPreviewFixtures({
        databaseId: "",
        executeQuery: vi.fn(),
      })
    ).rejects.toThrow("database ID");
  });

  it("requires an executeQuery function", async () => {
    await expect(
      seedAgentPreviewFixtures({
        databaseId: "db-123",
        executeQuery: "not-a-function",
      })
    ).rejects.toThrow("query executor");
  });

  it("seeds all fixture data with idempotent statements", async () => {
    const executeQuery = vi.fn().mockResolvedValue([]);
    const now = new Date("2026-07-14T12:00:00.000Z");

    await seedAgentPreviewFixtures({
      databaseId: "db-fixture-test",
      executeQuery,
      now,
    });

    // Expected calls: curriculum, program, preview-user app,
    // amina user, amina app, amina profile, amina highlight x2,
    // kwame user, kwame app, kwame profile,
    // project approved, project pending = 13 total
    expect(executeQuery).toHaveBeenCalledTimes(13);

    // All calls should target the correct database
    for (const call of executeQuery.mock.calls) {
      expect(call[0]).toBe("db-fixture-test");
    }

    // Verify curriculum insert
    expect(executeQuery.mock.calls[0][1]).toContain("curriculum");
    expect(executeQuery.mock.calls[0][2]).toContain("ttv-fixture-curriculum");

    // Verify program insert
    expect(executeQuery.mock.calls[1][1]).toContain("program");
    expect(executeQuery.mock.calls[1][2]).toContain(
      "ttv-fixture-program-cohort-04"
    );
    expect(executeQuery.mock.calls[1][2]).toContain("Cohort 04");

    // Verify preview user application
    expect(executeQuery.mock.calls[2][1]).toContain("programApplication");
    expect(executeQuery.mock.calls[2][2]).toContain("ttv-fixture-app-preview");
    expect(executeQuery.mock.calls[2][2]).toContain(AGENT_PREVIEW_USER_ID);

    // Verify Amina user
    expect(executeQuery.mock.calls[3][2]).toContain("ttv-fixture-user-amina");
    expect(executeQuery.mock.calls[3][2]).toContain("Amina Fixture");

    // Verify Amina profile
    expect(executeQuery.mock.calls[5][2]).toContain(
      "ttv-fixture-profile-amina"
    );
    expect(executeQuery.mock.calls[5][2]).toContain("amina-preview");
    expect(executeQuery.mock.calls[5][2]).toContain("Kenya");

    // Verify Amina highlights
    expect(executeQuery.mock.calls[6][2]).toContain(
      "ttv-fixture-highlight-amina-1"
    );
    expect(executeQuery.mock.calls[7][2]).toContain(
      "ttv-fixture-highlight-amina-2"
    );

    // Verify Kwame user and profile
    expect(executeQuery.mock.calls[8][2]).toContain("ttv-fixture-user-kwame");
    expect(executeQuery.mock.calls[10][2]).toContain(
      "ttv-fixture-profile-kwame"
    );

    // Verify client projects
    expect(executeQuery.mock.calls[11][2]).toContain(
      "ttv-fixture-project-approved"
    );
    expect(executeQuery.mock.calls[11][2]).toContain("Savanna Logistics");
    expect(executeQuery.mock.calls[12][2]).toContain(
      "ttv-fixture-project-pending"
    );
    expect(executeQuery.mock.calls[12][2]).toContain("Baraka Health");

    // All SQL statements should use ON CONFLICT for idempotency
    for (const call of executeQuery.mock.calls) {
      expect(call[1]).toContain("ON CONFLICT");
    }
  });

  it("does NOT seed a studentProfile for the preview user", async () => {
    const executeQuery = vi.fn().mockResolvedValue([]);

    await seedAgentPreviewFixtures({
      databaseId: "db-123",
      executeQuery,
    });

    const profileInserts = executeQuery.mock.calls.filter(
      (call) =>
        call[1].includes("studentProfile") &&
        call[2].includes(AGENT_PREVIEW_USER_ID)
    );
    expect(profileInserts).toHaveLength(0);
  });
});
