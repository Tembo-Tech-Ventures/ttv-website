import { describe, expect, it } from "vitest";
import { AGENT_SESSION_DURATIONS, parseAgentSessionDuration } from "@/lib/agent-auth";
import { AGENT_LIFETIME_OPTIONS, DEFAULT_AGENT_LIFETIME, agentLifetimeLabel, agentSessionStatus, revokeSessionAction } from "./agent-access";

const NOW = new Date("2026-11-08T12:00:00Z");

describe("how the agent access page words a session", () => {
  it("offers every lifetime the store accepts, in words, with 8 hours the default", () => {
    expect(AGENT_LIFETIME_OPTIONS.map(({ label }) => label)).toEqual(["1 hour", "8 hours", "24 hours", "7 days"]);
    for (const { value } of AGENT_LIFETIME_OPTIONS) expect(AGENT_SESSION_DURATIONS).toContain(parseAgentSessionDuration(value));
    expect(AGENT_LIFETIME_OPTIONS.map(({ value }) => value)).toContain(DEFAULT_AGENT_LIFETIME);
    expect(agentLifetimeLabel(48)).toBe("2 days");
  });

  it("says whether a session still works, expiring at its moment", () => {
    expect(agentSessionStatus({ expiresAt: new Date("2026-11-08T13:00:00Z") }, NOW)).toBe("ACTIVE");
    expect(agentSessionStatus({ expiresAt: NOW }, NOW)).toBe("EXPIRED");
    expect(revokeSessionAction("session-1")).toBe("revoke-session-1");
  });
});
