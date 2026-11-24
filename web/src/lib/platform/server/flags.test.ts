import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, featureFlagSeeds, MINIMAL_AUTH_SCHEMA, readMigration } from "@/test/sqlite-d1";
import { effective, getFlags, isFlagEnabled, REQUIRES, requireFlag, type FlagContext } from "./flags";
import { FlagAudience, FlagKey } from "@/lib/platform/contracts";

let setup: ReturnType<typeof createSqliteD1>;
beforeEach(() => {
  setup = createSqliteD1();
  setup.database.exec(MINIMAL_AUTH_SCHEMA);
  setup.database.exec(readMigration("0021_feature_flags.sql"));
  setup.database.exec(readMigration("0025_onboarding.sql"));
  setup.database.exec(featureFlagSeeds());
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

  it.each(["production", "Production", "PRODUCTION", "production-", " production", "--Production!!"])(
    "ignores the override for production identity %s and evaluates stored audiences", async environment => {
    setup.database.exec("UPDATE feature_flag SET audience='ALL' WHERE key='channels'");
    setup.database.exec("UPDATE feature_flag SET audience='STAFF' WHERE key='spaces'");
    const queries = vi.spyOn(setup.db, "prepare");
    const env = { DEPLOYMENT_ENVIRONMENT: environment, PLATFORM_FLAGS_OVERRIDE: "all" };
    expect(await getFlags(context({ env, isAdmin: false }))).toEqual({ ...uniform(false), channels: true });
    expect(await getFlags(context({ env, isAdmin: true }))).toEqual({ ...uniform(false), channels: true, spaces: true });
    expect(queries).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, "ALL", "true", "staff", " all "])("does not enable flags for override %s", async override => {
    expect(await getFlags(context({ env: { DEPLOYMENT_ENVIRONMENT: "staging", PLATFORM_FLAGS_OVERRIDE: override } }))).toEqual(uniform(false));
  });

  it("reads every key in one query, including onboarding", async () => {
    const queries = vi.spyOn(setup.db, "prepare");
    await getFlags(context());
    expect(queries).toHaveBeenCalledOnce();
    expect(queries.mock.calls[0][0]).toBe(
      `SELECT key, audience FROM feature_flag WHERE key IN (${FlagKey.options.map(() => "?").join(", ")})`
    );
    expect(FlagKey.options).toContain("onboarding");
  });

  it.each([
    { spaces: "OFF", onboarding: "ALL", isAdmin: true, expected: false },
    { spaces: "STAFF", onboarding: "ALL", isAdmin: false, expected: false },
    { spaces: "STAFF", onboarding: "ALL", isAdmin: true, expected: true },
    { spaces: "ALL", onboarding: "STAFF", isAdmin: false, expected: false },
    { spaces: "ALL", onboarding: "STAFF", isAdmin: true, expected: true },
    { spaces: "ALL", onboarding: "OFF", isAdmin: true, expected: false },
    { spaces: "ALL", onboarding: "ALL", isAdmin: false, expected: true },
  ] as const)("makes onboarding effective only with spaces: $spaces/$onboarding, admin $isAdmin", async ({ spaces, onboarding, isAdmin, expected }) => {
    setup.database.prepare("UPDATE feature_flag SET audience=? WHERE key='spaces'").run(spaces);
    setup.database.prepare("UPDATE feature_flag SET audience=? WHERE key='onboarding'").run(onboarding);
    const flags = await getFlags(context({ isAdmin }));
    expect(flags.onboarding).toBe(expected);
    expect(flags.spaces).toBe(spaces === "ALL" || (spaces === "STAFF" && isAdmin));
    expect(await requireFlag(context({ isAdmin }), "onboarding")).toEqual(expected ? null : expect.any(Response));
  });

  it("defaults missing keys to OFF and ignores future keys", async () => {
    setup.database.exec("DELETE FROM feature_flag WHERE key='spaces'");
    setup.database.exec("INSERT INTO feature_flag(key,audience) VALUES ('future','ALL')");
    expect(await getFlags(context())).toEqual(uniform(false));
    setup.database.exec("UPDATE feature_flag SET audience='ALL'");
    // onboarding and calls build on spaces, and check-ins and events on calls, so a missing spaces row keeps them off too.
    expect(await getFlags(context())).toEqual({
      ...uniform(true), spaces: false, onboarding: false, meetings: false, meeting_checkins: false, meeting_events: false,
    });
  });
});

describe("flags that build on others", () => {
  const set = (audiences: Partial<Record<FlagKey, FlagAudience>>) => {
    setup.database.exec("UPDATE feature_flag SET audience='OFF'");
    for (const [key, audience] of Object.entries(audiences)) {
      setup.database.prepare("UPDATE feature_flag SET audience=? WHERE key=?").run(audience, key);
    }
  };
  const on = (flags: Record<FlagKey, boolean>) => FlagKey.options.filter((key) => flags[key]);

  it("lists each flag's parents, none of them itself or unknown, with no cycle", () => {
    expect(REQUIRES).toEqual({
      onboarding: ["spaces"],
      mentor_requests: ["channels"],
      meetings: ["channels", "spaces"],
      meeting_checkins: ["meetings", "mentor_requests"],
      meeting_events: ["meetings"],
    });
    const ancestors = (key: FlagKey, seen: FlagKey[] = []): FlagKey[] => {
      expect(seen).not.toContain(key);
      return (REQUIRES[key] ?? []).flatMap((parent) => [parent, ...ancestors(parent, [...seen, key])]);
    };
    for (const key of FlagKey.options) {
      expect(FlagKey.options).toEqual(expect.arrayContaining([...ancestors(key)]));
      expect(ancestors(key)).not.toContain(key);
    }
  });

  it("seeds the three call flags OFF, so nobody has them", async () => {
    expect(setup.database.prepare("SELECT key, audience FROM feature_flag WHERE key LIKE 'meeting%' ORDER BY key").all())
      .toEqual([{ key: "meeting_checkins", audience: "OFF" }, { key: "meeting_events", audience: "OFF" }, { key: "meetings", audience: "OFF" }]);
    setup.database.exec("UPDATE feature_flag SET audience='ALL' WHERE key NOT LIKE 'meeting%'");
    expect(on(await getFlags(context({ isAdmin: true })))).toEqual(["spaces", "channels", "tembo_channels", "mentor_requests", "onboarding"]);
  });

  it.each([
    // Calls need both channels and spaces.
    { audiences: { meetings: "ALL", channels: "ALL" }, isAdmin: true, expected: ["channels"] },
    { audiences: { meetings: "ALL", spaces: "ALL" }, isAdmin: true, expected: ["spaces"] },
    { audiences: { meetings: "ALL", spaces: "ALL", channels: "ALL" }, isAdmin: false, expected: ["spaces", "channels", "meetings"] },
    { audiences: { meetings: "STAFF", spaces: "ALL", channels: "ALL" }, isAdmin: false, expected: ["spaces", "channels"] },
    { audiences: { meetings: "STAFF", spaces: "ALL", channels: "ALL" }, isAdmin: true, expected: ["spaces", "channels", "meetings"] },
    { audiences: { meetings: "ALL", spaces: "ALL", channels: "STAFF" }, isAdmin: false, expected: ["spaces"] },
    // Check-ins need calls and mentor requests, and through them channels and spaces.
    { audiences: { meeting_checkins: "ALL", meetings: "ALL", spaces: "ALL", channels: "ALL" }, isAdmin: true,
      expected: ["spaces", "channels", "meetings"] },
    { audiences: { meeting_checkins: "ALL", mentor_requests: "ALL", spaces: "ALL", channels: "ALL" }, isAdmin: true,
      expected: ["spaces", "channels", "mentor_requests"] },
    { audiences: { meeting_checkins: "ALL", mentor_requests: "ALL", meetings: "ALL", channels: "ALL" }, isAdmin: true,
      expected: ["channels", "mentor_requests"] },
    { audiences: { meeting_checkins: "ALL", mentor_requests: "ALL", meetings: "ALL", spaces: "ALL" }, isAdmin: true,
      expected: ["spaces"] },
    { audiences: { meeting_checkins: "ALL", mentor_requests: "ALL", meetings: "ALL", spaces: "ALL", channels: "ALL" }, isAdmin: false,
      expected: ["spaces", "channels", "mentor_requests", "meetings", "meeting_checkins"] },
    { audiences: { meeting_checkins: "ALL", mentor_requests: "ALL", meetings: "STAFF", spaces: "ALL", channels: "ALL" }, isAdmin: false,
      expected: ["spaces", "channels", "mentor_requests"] },
    { audiences: { meeting_checkins: "STAFF", mentor_requests: "ALL", meetings: "ALL", spaces: "ALL", channels: "ALL" }, isAdmin: true,
      expected: ["spaces", "channels", "mentor_requests", "meetings", "meeting_checkins"] },
    // Events need calls, and through them channels and spaces, but not mentor requests.
    { audiences: { meeting_events: "ALL", meetings: "ALL", spaces: "ALL", channels: "ALL" }, isAdmin: false,
      expected: ["spaces", "channels", "meetings", "meeting_events"] },
    { audiences: { meeting_events: "ALL", spaces: "ALL", channels: "ALL" }, isAdmin: true, expected: ["spaces", "channels"] },
    { audiences: { meeting_events: "ALL", meetings: "ALL", channels: "ALL" }, isAdmin: true, expected: ["channels"] },
  ] as { audiences: Partial<Record<FlagKey, FlagAudience>>; isAdmin: boolean; expected: FlagKey[] }[])(
    "$audiences, admin $isAdmin: $expected", async ({ audiences, isAdmin, expected }) => {
      set(audiences);
      expect(on(await getFlags(context({ isAdmin })))).toEqual(expected);
      for (const key of ["meetings", "meeting_checkins", "meeting_events"] as const) {
        expect(await requireFlag(context({ isAdmin }), key)).toEqual(expected.includes(key) ? null : expect.any(Response));
      }
    });

  it("makes every flag effective exactly when it and all its ancestors are on, for every combination", () => {
    for (let mask = 0; mask < 1 << FlagKey.options.length; mask++) {
      const own = Object.fromEntries(FlagKey.options.map((key, bit) => [key, Boolean(mask & (1 << bit))])) as Record<FlagKey, boolean>;
      const allOn = (key: FlagKey): boolean => own[key] && (REQUIRES[key] ?? []).every(allOn);
      expect(effective(own)).toEqual(Object.fromEntries(FlagKey.options.map((key) => [key, allOn(key)])));
    }
  });
});

describe("request cache and API guard", () => {
  it("invalidates an early cache when authentication or the trusted role changes", async () => {
    setup.database.exec("UPDATE feature_flag SET audience='STAFF'");
    const locals = {};
    const queries = vi.spyOn(setup.db, "prepare");
    expect(await getFlags(context({ locals, user: null }))).toEqual(uniform(false));
    expect(await getFlags(context({ locals, isAdmin: false }))).toEqual(uniform(false));
    expect(await getFlags(context({ locals, isAdmin: true }))).toEqual(uniform(true));
    expect(await getFlags(context({ locals, user: null, isAdmin: true }))).toEqual(uniform(false));
    expect(queries).toHaveBeenCalledTimes(2);
  });

  it("lets a read that found the ADMIN role itself serve callers that pass it, so an admin page reads flags once", async () => {
    setup.database.exec("UPDATE feature_flag SET audience='STAFF'");
    setup.database.exec("INSERT INTO Roles(id,name) VALUES ('ADMIN','ADMIN'); INSERT INTO UserRoles(id,userId,roleId) VALUES ('a','amina','ADMIN')");
    const locals = {};
    const queries = vi.spyOn(setup.db, "prepare");
    // Started beside the ADMIN guard, before it sets locals.isAdmin.
    const early = getFlags(context({ locals }));
    expect(await getFlags(context({ locals, isAdmin: true }))).toEqual(uniform(true));
    expect(await early).toEqual(uniform(true));
    // The flags and the role, once each.
    expect(queries).toHaveBeenCalledTimes(2);
  });

  it("reads again when a trusted ADMIN result contradicts an earlier trusted one", async () => {
    setup.database.exec("UPDATE feature_flag SET audience='STAFF'");
    const locals = {};
    const queries = vi.spyOn(setup.db, "prepare");
    expect(await getFlags(context({ locals, isAdmin: true }))).toEqual(uniform(true));
    expect(await getFlags(context({ locals }))).toEqual(uniform(true));
    expect(await getFlags(context({ locals, isAdmin: false }))).toEqual(uniform(false));
    expect(queries).toHaveBeenCalledTimes(2);
  });

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
