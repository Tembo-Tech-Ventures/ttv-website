import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, MINIMAL_AUTH_SCHEMA, readMigration } from "@/test/sqlite-d1";
import { partnerAccessFlow } from "./partner-access-flow";

const recordError = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/observability/errors", () => ({ recordError }));

let setup: ReturnType<typeof createSqliteD1>;
beforeEach(() => {
  setup = createSqliteD1();
  setup.database.exec(MINIMAL_AUTH_SCHEMA);
  setup.database.exec(readMigration("0021_feature_flags.sql"));
  setup.database.exec(readMigration("0025_onboarding.sql"));
  setup.database.exec(`
    INSERT INTO user(id,name,email) VALUES ('wanjiru','Wanjiru Kamau','wanjiru@example.test'), ('amina','Amina Hassan','amina@example.test');
    INSERT INTO Roles(id,name) VALUES ('admin','ADMIN');
    INSERT INTO UserRoles(id,userId,roleId) VALUES ('amina-admin','amina','admin');
  `);
});
afterEach(() => { setup.database.close(); vi.clearAllMocks(); });

const PRODUCTION = { DEPLOYMENT_ENVIRONMENT: "production" };
const member = { id: "wanjiru" } as AuthUser;
const admin = { id: "amina" } as AuthUser;

function audiences(spaces: string, onboarding: string) {
  setup.database.prepare("UPDATE feature_flag SET audience=? WHERE key='spaces'").run(spaces);
  setup.database.prepare("UPDATE feature_flag SET audience=? WHERE key='onboarding'").run(onboarding);
}

function flow(user: AuthUser | null, env: Parameters<typeof partnerAccessFlow>[0]["env"] = PRODUCTION) {
  return partnerAccessFlow({ locals: { user }, db: setup.db, env, route: "/community/mentors" });
}

describe("partnerAccessFlow", () => {
  it.each([
    // [spaces, onboarding, anonymous visitor, signed-in member, signed-in admin]
    ["OFF", "OFF", "legacy", "legacy", "legacy"],
    ["ALL", "OFF", "legacy", "legacy", "legacy"],
    ["STAFF", "STAFF", "legacy", "legacy", "request"],
    ["ALL", "STAFF", "legacy", "legacy", "request"],
    ["ALL", "ALL", "request", "request", "request"],
    // Onboarding builds on spaces: it is never on without it.
    ["OFF", "ALL", "legacy", "legacy", "legacy"],
    ["STAFF", "ALL", "legacy", "legacy", "request"],
  ] as const)("spaces %s, onboarding %s: anonymous %s, member %s, admin %s", async (spaces, onboarding, anonymous, signedIn, staff) => {
    audiences(spaces, onboarding);
    expect(await flow(null)).toBe(anonymous);
    expect(await flow(member)).toBe(signedIn);
    expect(await flow(admin)).toBe(staff);
  });

  it("tells an anonymous visitor what signing in opens for an ordinary member, never for staff", async () => {
    audiences("STAFF", "STAFF");
    const roleQueries = vi.spyOn(setup.db, "prepare");
    expect(await flow(null)).toBe("legacy");
    // Only the audience read: the stand-in account is never looked up as a person.
    expect(roleQueries).toHaveBeenCalledOnce();
    expect(setup.database.prepare("SELECT count(*) AS n FROM user").get()).toEqual({ n: 2 });
  });

  it("follows the non-production override, and ignores it in production", async () => {
    expect(await flow(null, { DEPLOYMENT_ENVIRONMENT: "agent-pr-267", PLATFORM_FLAGS_OVERRIDE: "all" })).toBe("request");
    expect(await flow(member, { DEPLOYMENT_ENVIRONMENT: "agent-pr-267", PLATFORM_FLAGS_OVERRIDE: "all" })).toBe("request");
    expect(await flow(null, { DEPLOYMENT_ENVIRONMENT: "production", PLATFORM_FLAGS_OVERRIDE: "all" })).toBe("legacy");
  });

  it("keeps the legacy story, and records a warning, when the flags cannot be read", async () => {
    setup.database.exec("DROP TABLE feature_flag");
    expect(await flow(member)).toBe("legacy");
    expect(await flow(null)).toBe("legacy");
    expect(recordError).toHaveBeenCalledTimes(2);
    expect(recordError).toHaveBeenCalledWith(setup.db, expect.objectContaining({ route: "/community/mentors", level: "warning" }));
  });
});
