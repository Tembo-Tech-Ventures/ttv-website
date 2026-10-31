import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, MINIMAL_AUTH_SCHEMA, readMigration } from "@/test/sqlite-d1";
import { getFlags, isFlagEnabled, requireFlag, type FlagContext } from "./flags";
import { FlagAudience, FlagKey } from "./flag-contracts";

let setup: ReturnType<typeof createSqliteD1>;
beforeEach(() => {
  setup = createSqliteD1();
  setup.database.exec(MINIMAL_AUTH_SCHEMA);
  setup.database.exec(readMigration("0021_feature_flags.sql"));
  setup.database.exec("INSERT INTO user(id,name,email) VALUES ('amina','Amina Hassan','amina@example.test')");
});
afterEach(() => { setup.database.close(); vi.restoreAllMocks(); });

function context(overrides: Partial<FlagContext> = {}): FlagContext {
  return { db: setup.db, env: { DEPLOYMENT_ENVIRONMENT: "production" }, user: { id: "amina" }, ...overrides };
}
const uniform = (value: boolean) => Object.fromEntries(FlagKey.options.map(key => [key, value]));
const roleNames = ["STUDENT", "MENTOR", "INSTITUTION", "ADMIN"];
const combinations = Array.from({ length: 16 }, (_, mask) => roleNames.filter((_role, bit) => mask & (1 << bit)));

describe("flag audiences", () => {
  it.each(FlagAudience.options.flatMap(audience => combinations.map(roles => ({ audience, roles }))))(
    "$audience for $roles", async ({ audience, roles }) => {
      for (const role of roles) {
        setup.database.prepare("INSERT INTO Roles(id,name) VALUES (?,?)").run(role, role);
        setup.database.prepare("INSERT INTO UserRoles(id,userId,roleId) VALUES (?,'amina',?)").run(role, role);
      }
      setup.database.prepare("UPDATE feature_flag SET audience=?").run(audience);
      const queries = vi.spyOn(setup.db, "prepare");
      expect(await getFlags(context())).toEqual(uniform(audience === "ALL" || (audience === "STAFF" && roles.includes("ADMIN"))));
      expect(queries).toHaveBeenCalledTimes(audience === "STAFF" ? 2 : 1);
    }
  );

  it.each([true, false])("reuses a trusted ADMIN result (%s) without another role query", async isAdmin => {
    setup.database.exec("UPDATE feature_flag SET audience='STAFF'");
    const queries = vi.spyOn(setup.db, "prepare");
    expect(await getFlags(context({ isAdmin }))).toEqual(uniform(isAdmin));
    expect(queries).toHaveBeenCalledOnce();
  });

  it.each(FlagAudience.options)("keeps signed-out users disabled for %s even with the override", async audience => {
    setup.database.prepare("UPDATE feature_flag SET audience=?").run(audience);
    const queries = vi.spyOn(setup.db, "prepare");
    expect(await getFlags(context({ user: null, isAdmin: true, env: { PLATFORM_FLAGS_OVERRIDE: "all" } }))).toEqual(uniform(false));
    expect(queries).not.toHaveBeenCalled();
  });

  it.each(["staging", "agent-pr-235", "agent-task", "development", undefined])(
    "honours the override outside production (%s) without a DB query", async environment => {
      const queries = vi.spyOn(setup.db, "prepare");
      expect(await getFlags(context({ env: { DEPLOYMENT_ENVIRONMENT: environment, PLATFORM_FLAGS_OVERRIDE: "all" } }))).toEqual(uniform(true));
      expect(queries).not.toHaveBeenCalled();
    }
  );

  it("ignores the override in production and evaluates each stored audience", async () => {
    setup.database.exec("UPDATE feature_flag SET audience='ALL' WHERE key='channels'");
    setup.database.exec("UPDATE feature_flag SET audience='STAFF' WHERE key='spaces'");
    const env = { DEPLOYMENT_ENVIRONMENT: "production", PLATFORM_FLAGS_OVERRIDE: "all" };
    expect(await getFlags(context({ env, isAdmin: false }))).toEqual({ ...uniform(false), channels: true });
    expect(await getFlags(context({ env, isAdmin: true }))).toEqual({ ...uniform(false), channels: true, spaces: true });
  });

  it.each([undefined, "ALL", "true", "staff", " all "])("does not enable flags for override %s", async override => {
    expect(await getFlags(context({ env: { DEPLOYMENT_ENVIRONMENT: "staging", PLATFORM_FLAGS_OVERRIDE: override } }))).toEqual(uniform(false));
  });

  it("defaults missing keys to OFF and ignores future keys", async () => {
    setup.database.exec("DELETE FROM feature_flag WHERE key='spaces'");
    setup.database.exec("INSERT INTO feature_flag(key,audience) VALUES ('future','ALL')");
    expect(await getFlags(context())).toEqual(uniform(false));
  });
});

describe("request cache and API guard", () => {
  it("shares concurrent results across helpers and contexts using the same locals", async () => {
    const locals = {};
    const ctx = context({ locals });
    const queries = vi.spyOn(setup.db, "prepare");
    const [first, second, enabled] = await Promise.all([getFlags(ctx), getFlags(context({ locals })), isFlagEnabled(ctx, "spaces")]);
    expect(first).toBe(second);
    expect(enabled).toBe(false);
    expect(Object.isFrozen(first)).toBe(true);
    expect(queries).toHaveBeenCalledOnce();
    setup.database.exec("UPDATE feature_flag SET audience='ALL'");
    expect(await getFlags(ctx)).toBe(first);
    expect(await getFlags(context({ locals: {} }))).toEqual(uniform(true));
    expect(queries).toHaveBeenCalledTimes(2);
  });

  it("also caches on a stable context when locals is not supplied", async () => {
    const ctx = context();
    const queries = vi.spyOn(setup.db, "prepare");
    await getFlags(ctx);
    await isFlagEnabled(ctx, "channels");
    await requireFlag(ctx, "spaces");
    expect(queries).toHaveBeenCalledOnce();
  });

  it("does not share flags between signed-in and anonymous requests", async () => {
    setup.database.exec("UPDATE feature_flag SET audience='ALL'");
    expect(await getFlags(context())).toEqual(uniform(true));
    expect(await getFlags(context({ user: null }))).toEqual(uniform(false));
  });

  it("returns the flag_off 404 envelope, or null when enabled", async () => {
    const response = await requireFlag(context(), "spaces");
    expect(response?.status).toBe(404);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    expect(await response?.json()).toEqual({ error: { code: "flag_off", message: "Not found." } });
    setup.database.exec("UPDATE feature_flag SET audience='ALL' WHERE key='spaces'");
    expect(await requireFlag(context(), "spaces")).toBeNull();
  });

  it("never enables a feature on DB failure, including concurrent calls", async () => {
    const error = new Error("DB unavailable");
    const queries = vi.spyOn(setup.db, "prepare").mockImplementation(() => { throw error; });
    const ctx = context();
    const results = await Promise.allSettled([getFlags(ctx), requireFlag(ctx, "channels")]);
    expect(results).toEqual([{ status: "rejected", reason: error }, { status: "rejected", reason: error }]);
    expect(queries).toHaveBeenCalledOnce();
  });
});
