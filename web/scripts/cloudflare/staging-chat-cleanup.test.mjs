import { describe, expect, it, vi } from "vitest";
vi.mock("./staging-fixture-target.mjs", () => ({ assertVerifiedStagingFixtureTarget: target => { if (!target.verified) throw new Error("Unverified target"); }, STAGING_FIXTURE_ORIGIN: "https://staging.tembotechventures.com", verifyStagingFixtureTarget: vi.fn() }));
import { cleanupIncident, INCIDENT_USERS } from "./staging-chat-cleanup.mjs";
function fixture() {
  return { verified: true, expectedVersion: "c96608f0d0585478f8bf9881d741e3e56467cdb8", executeQuery: vi.fn(async sql => [{ results: sql.startsWith("SELECT id") ? INCIDENT_USERS.map(id => ({ id, email: `${id}@invalid.ttv` })) : sql.startsWith("SELECT") ? [{ remaining: 0 }] : [] }]) };
}
describe("fixed chat incident cleanup", () => {
  it("revokes credentials first, verifies cascaded data and never selects token material", async () => {
    const target = fixture(), audit = vi.fn(); await cleanupIncident(target, audit);
    const calls = target.executeQuery.mock.calls;
    expect(calls[1][0]).toContain('DELETE FROM "session"');
    expect(calls[2][0]).toContain('DELETE FROM "personal_access_token"');
    expect(calls.every(([, params]) => params === INCIDENT_USERS)).toBe(true);
    expect(calls.some(([sql]) => /SELECT.*token/i.test(sql) && !sql.includes("COUNT(*)"))).toBe(false);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: "incident-credentials", revoked: true }));
    expect(audit).toHaveBeenLastCalledWith(expect.objectContaining({ cleanup: "passed" }));
  });
  it("rejects unverified target, different deployment and unexpected identity before deletes", async () => {
    for (const change of [{ verified: false }, { expectedVersion: "b".repeat(40) }]) {
      const target = Object.assign(fixture(), change);
      await expect(cleanupIncident(target)).rejects.toThrow(/.*/);
      expect(target.executeQuery).not.toHaveBeenCalled();
    }
    const target = fixture(); target.executeQuery.mockResolvedValueOnce([{ results: [{ id: INCIDENT_USERS[0], email: "real@example.com" }] }]);
    await expect(cleanupIncident(target)).rejects.toThrow("identity mismatch");
    expect(target.executeQuery).toHaveBeenCalledTimes(1);
  });
  it("continues cleanup after a revoke failure and reports incomplete instead of success", async () => {
    const target = fixture(), audit = vi.fn();
    target.executeQuery.mockImplementationOnce(async () => [{ results: [] }]).mockRejectedValueOnce(new Error("private details"));
    await expect(cleanupIncident(target, audit)).rejects.toThrow("cleanup incomplete");
    expect(target.executeQuery.mock.calls.some(([sql]) => sql.startsWith('DELETE FROM "user"'))).toBe(true);
    expect(audit).toHaveBeenLastCalledWith(expect.objectContaining({ cleanup: "failed" }));
    expect(JSON.stringify(audit.mock.calls)).not.toContain("private details");
  });
});
