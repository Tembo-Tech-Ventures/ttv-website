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

    // profile reset, curriculum, program, cohort-application reset, ten cohort
    // users, six eligible cohort applications, preview app, amina user/app,
    // amina profile, invalid-completion user/app/profile, two amina highlights,
    // kwame user/app/profile, and two projects = 34 total
    expect(executeQuery).toHaveBeenCalledTimes(34);

    // All calls should target the correct database
    for (const call of executeQuery.mock.calls) {
      expect(call[0]).toBe("db-fixture-test");
    }

    // Content-based lookups keep the assertions stable if statement order
    // shifts; the reset must still run first.
    const calls = executeQuery.mock.calls;
    const findByParam = (value) =>
      calls.find((call) => (call[2] ?? []).includes(value));
    const findInsertByParam = (table, value) =>
      calls.find(
        (call) =>
          call[1].includes(`INSERT INTO "${table}"`) &&
          (call[2] ?? []).includes(value)
      );

    expect(calls[0][1]).toContain('DELETE FROM "studentProfile"');

    expect(findByParam("ttv-fixture-curriculum")?.[1]).toContain("curriculum");
    const programCall = findByParam("ttv-fixture-program-cohort-04");
    expect(programCall?.[1]).toContain("program");
    expect(programCall?.[2]).toContain("Cohort 04");

    const cohortReset = calls.find((call) =>
      call[1].includes('DELETE FROM "programApplication"')
    );
    expect(cohortReset?.[2]).toContain(
      "ttv-fixture-user-cohort-desktop-current"
    );
    expect(cohortReset?.[2]).toContain(
      "ttv-fixture-user-cohort-mobile-current"
    );

    const desktopCurrent = findInsertByParam(
      "user",
      "ttv-fixture-user-cohort-desktop-current"
    );
    expect(desktopCurrent?.[2]).toContain(
      "Cohort Desktop Current Learner"
    );
    expect(
      findInsertByParam(
        "programApplication",
        "ttv-fixture-user-cohort-desktop-current"
      )
    ).toBeUndefined();

    const desktopPending = findInsertByParam(
      "programApplication",
      "ttv-fixture-app-cohort-desktop-pending"
    );
    expect(desktopPending?.[2]).toContain("PENDING");
    expect(
      findInsertByParam(
        "programApplication",
        "ttv-fixture-app-cohort-mobile-audit"
      )?.[2]
    ).toContain("AUDIT");

    const previewApp = findByParam("ttv-fixture-app-preview");
    expect(previewApp?.[1]).toContain("programApplication");
    expect(previewApp?.[2]).toContain(AGENT_PREVIEW_USER_ID);

    expect(findByParam("ttv-fixture-user-amina")?.[2]).toContain(
      "Amina Fixture"
    );
    const aminaProfile = findByParam("ttv-fixture-profile-amina");
    expect(aminaProfile?.[2]).toContain("amina-preview");
    expect(aminaProfile?.[2]).toContain("Kenya");
    const invalidCompletionApp = findByParam(
      "ttv-fixture-app-invalid-completion"
    );
    expect(invalidCompletionApp?.[1]).toContain("'COMPLETED'");
    expect(invalidCompletionApp?.[1]).toContain('"completedAt" = NULL');
    expect(
      findByParam("ttv-fixture-profile-invalid-completion")?.[2]
    ).toContain("invalid-completion-preview");

    expect(findByParam("ttv-fixture-highlight-amina-1")).toBeDefined();
    expect(findByParam("ttv-fixture-highlight-amina-2")).toBeDefined();

    expect(findByParam("ttv-fixture-user-kwame")).toBeDefined();
    expect(findByParam("ttv-fixture-profile-kwame")?.[2]).toContain(
      "kwame-preview"
    );

    expect(findByParam("ttv-fixture-project-approved")?.[2]).toContain(
      "Savanna Logistics"
    );
    expect(findByParam("ttv-fixture-project-pending")?.[2]).toContain(
      "Baraka Health"
    );

    // Every INSERT must be idempotent; deterministic DELETEs only reset
    // isolated fixture rows before recreating their convergent state.
    for (const call of executeQuery.mock.calls) {
      if (call[1].trimStart().startsWith("DELETE")) continue;
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
        call[1].includes("INSERT") &&
        call[1].includes("studentProfile") &&
        call[2].includes(AGENT_PREVIEW_USER_ID)
    );
    expect(profileInserts).toHaveLength(0);
  });

  it("resets the preview user's profile before seeding fixtures", async () => {
    const executeQuery = vi.fn().mockResolvedValue([]);

    await seedAgentPreviewFixtures({
      databaseId: "db-123",
      executeQuery,
    });

    const firstCall = executeQuery.mock.calls[0];
    expect(firstCall[1]).toContain('DELETE FROM "studentProfile"');
    expect(firstCall[2]).toEqual([AGENT_PREVIEW_USER_ID]);
  });
});
