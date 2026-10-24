import { describe, expect, it, vi } from "vitest";
import { verifyStagingFixtureTarget, assertVerifiedStagingFixtureTarget, STAGING_FIXTURE_DATABASE_ID as dbId } from "./staging-fixture-target.mjs";
function fixture() {
  const accountId = "a".repeat(32), expectedVersion = "b".repeat(40);
  const account = { id: accountId };
  const settings = { bindings: [{ name: "DB", type: "d1", id: dbId }, { name: "DEPLOYMENT_ENVIRONMENT", text: "staging" }, { name: "DEPLOYMENT_VERSION", text: expectedVersion }] };
  const database = { uuid: dbId, name: "ttv-website-db-staging" };
  const health = { service: "ttv-website", environment: "staging", version: expectedVersion, checks: { db: "ok" } };
  const api = vi.fn(async path => path === "" ? account : path.endsWith("settings") ? settings : path.endsWith(dbId) ? database : []);
  return { account, settings, database, health, options: { environmentName: "staging", accountId, expectedVersion, baseUrl: "https://ttv-website-staging.fixture.workers.dev", api, fetchImpl: vi.fn(async () => Response.json(health)) } };
}
describe("staging fixture target", () => {
  it("verifies read-only then binds executor to exact staging DB", async () => {
    const { options } = fixture();
    const target = await verifyStagingFixtureTarget(options);
    expect(() => assertVerifiedStagingFixtureTarget(target)).not.toThrow();
    expect(() => assertVerifiedStagingFixtureTarget({ ...target })).toThrow("verified staging");
    expect(options.api.mock.calls.every(c => c.length === 1)).toBe(true);
    await target.executeQuery("SELECT id FROM user WHERE id=?", ["fixture"]);
    expect(options.api).toHaveBeenLastCalledWith(`/d1/database/${dbId}/query`, { method: "POST", body: { sql: "SELECT id FROM user WHERE id=?", params: ["fixture"] } });
    expect(Object.isFrozen(target)).toBe(true);
  });
  it.each(["production", "agent-pr-172", ""])("rejects %s without network", async environmentName => {
    const { options } = fixture();
    await expect(verifyStagingFixtureTarget({ ...options, environmentName })).rejects.toThrow("Exact staging");
    expect(options.api).not.toHaveBeenCalled();
  });
  it.each(["https://ttv-website-production.fixture.workers.dev", "https://example.com", "http://ttv-website-staging.fixture.workers.dev", "https://ttv-website-staging.fixture.workers.dev/path"])("rejects origin %s", async baseUrl => {
    const { options } = fixture();
    await expect(verifyStagingFixtureTarget({ ...options, baseUrl })).rejects.toThrow("shared staging");
    expect(options.api).not.toHaveBeenCalled();
  });
  it.each(["account", "binding", "database", "revision", "health"])("rejects %s mismatch before writes", async mismatch => {
    const f = fixture();
    if (mismatch === "account") f.account.id = "c".repeat(32);
    if (mismatch === "binding") f.settings.bindings[0].id = "production-db";
    if (mismatch === "database") f.database.name = "production";
    if (mismatch === "revision") f.settings.bindings[2].text = "c".repeat(40);
    if (mismatch === "health") f.health.environment = "production";
    await expect(verifyStagingFixtureTarget(f.options)).rejects.toThrow("preflight failed");
    expect(f.options.api.mock.calls.every(c => c.length === 1)).toBe(true);
  });
  it("sanitizes failed query bindings", async () => {
    const { options } = fixture();
    const target = await verifyStagingFixtureTarget(options);
    options.api.mockRejectedValue(new Error("sensitive binding"));
    await expect(target.executeQuery("INSERT", ["credential"])).rejects.toThrow(/^Staging fixture database operation failed\.$/);
  });
});
