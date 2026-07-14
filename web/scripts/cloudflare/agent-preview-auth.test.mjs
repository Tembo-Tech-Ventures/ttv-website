import { describe, expect, it, vi } from "vitest";
import {
  AGENT_PREVIEW_SESSION_MARKER,
  assertAgentEnvironmentName,
  deriveAgentPreviewAuthSecret,
  deriveAgentPreviewToken,
  seedAgentPreviewAccess,
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
