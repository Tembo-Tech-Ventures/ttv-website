import type { SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "@/lib/auth";
import { startOnboardingForNewAccount, type SignUpEnv } from "./signup";
import { onboardingDatabase } from "./test-support";

const T = Date.parse("2026-11-01T08:00:00Z");
const setups: ReturnType<typeof onboardingDatabase>[] = [];
function setup(flags: { spaces?: string; onboarding?: string } = {}) {
  const fixture = onboardingDatabase();
  setups.push(fixture);
  for (const [key, audience] of Object.entries(flags)) {
    fixture.database.prepare("UPDATE feature_flag SET audience=? WHERE key=?").run(audience, key);
  }
  const env = (overrides: Partial<SignUpEnv> = {}): SignUpEnv => ({ DB: fixture.db, DEPLOYMENT_ENVIRONMENT: "production", ...overrides });
  const onboarding = () => fixture.rows("SELECT userId, stage FROM member_onboarding");
  return { ...fixture, env, onboarding };
}
afterEach(() => { setups.splice(0).forEach(fixture => fixture.database.close()); vi.restoreAllMocks(); });

describe("startOnboardingForNewAccount", () => {
  it.each([
    { spaces: "ALL", onboarding: "ALL", started: true },
    { spaces: "ALL", onboarding: "STAFF", started: false },
    { spaces: "ALL", onboarding: "OFF", started: false },
    { spaces: "STAFF", onboarding: "ALL", started: false },
    { spaces: "OFF", onboarding: "ALL", started: false },
  ])("spaces $spaces, onboarding $onboarding: started $started", async ({ spaces, onboarding, started }) => {
    const { env, onboarding: rows } = setup({ spaces, onboarding });
    await startOnboardingForNewAccount(env(), "wairimu", T);
    expect(rows()).toEqual(started ? [{ userId: "wairimu", stage: "NEW" }] : []);
  });

  it("never treats a new account as staff, whatever its id", async () => {
    const { env, grant, onboarding } = setup({ spaces: "STAFF", onboarding: "STAFF" });
    grant("wairimu", "ADMIN");
    await startOnboardingForNewAccount(env(), "wairimu", T);
    expect(onboarding()).toEqual([]);
  });

  it.each(["staging", "agent-pr-260", undefined])("follows the override outside production (%s)", async environment => {
    const { env, onboarding } = setup();
    await startOnboardingForNewAccount(env({ DEPLOYMENT_ENVIRONMENT: environment, PLATFORM_FLAGS_OVERRIDE: "all" }), "wairimu", T);
    expect(onboarding()).toEqual([{ userId: "wairimu", stage: "NEW" }]);
  });

  it("ignores the override in production", async () => {
    const { env, onboarding } = setup();
    await startOnboardingForNewAccount(env({ DEPLOYMENT_ENVIRONMENT: "Production", PLATFORM_FLAGS_OVERRIDE: "all" }), "wairimu", T);
    expect(onboarding()).toEqual([]);
  });

  it.each([
    ["the flag read", "DROP TABLE feature_flag"],
    ["the onboarding write", "DROP TABLE member_onboarding"],
  ])("fails open when %s fails, and records a warning without private details", async (_name, sql) => {
    const { env, database, rows } = setup({ spaces: "ALL", onboarding: "ALL" });
    database.exec(sql);
    await expect(startOnboardingForNewAccount(env(), "wairimu", T)).resolves.toBeUndefined();
    const [event] = rows("SELECT source, route, level, message FROM errorEvent");
    expect(event).toMatchObject({ source: "request", route: "/api/auth/[...all]", level: "warning" });
    expect(JSON.stringify(event)).not.toContain("wairimu");
  });

  it("still resolves when the error ledger is down too", async () => {
    const { env, database } = setup({ spaces: "ALL", onboarding: "ALL" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    database.exec("DROP TABLE member_onboarding; DROP TABLE errorEvent");
    await expect(startOnboardingForNewAccount(env(), "wairimu", T)).resolves.toBeUndefined();
  });
});

/** createAuth builds its own Drizzle client, which reads D1 rows as arrays through raw(). */
function drizzleReadyD1({ db, database }: ReturnType<typeof setup>): D1Database {
  return Object.assign(Object.create(db) as D1Database, {
    prepare(query: string) {
      const statement = db.prepare(query);
      const bind = statement.bind.bind(statement);
      return Object.assign(statement, {
        bind: (...values: unknown[]) => Object.assign(bind(...values), {
          async raw() {
            const native = database.prepare(query);
            native.setReturnArrays(true);
            return native.all(...values.map(value => typeof value === "boolean" ? Number(value) : value) as SQLInputValue[]);
          },
        }),
      });
    },
  });
}

describe("Better Auth user.create hook in createAuth", () => {
  async function signUp(fixture: ReturnType<typeof setup>, overrides: Record<string, string> = {}) {
    const auth = createAuth({
      DB: drizzleReadyD1(fixture), BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-for-better-auth",
      BETTER_AUTH_URL: "https://example.test", GITHUB_CLIENT_ID: "client", GITHUB_CLIENT_SECRET: "secret",
      DEPLOYMENT_ENVIRONMENT: "production", ...overrides,
    } as Parameters<typeof createAuth>[0]);
    const { internalAdapter } = await auth.$context;
    return internalAdapter.createUser({ name: "Njambi Wanjiru", email: "njambi@example.test", emailVerified: true });
  }
  const newcomer = (fixture: ReturnType<typeof setup>) =>
    fixture.rows("SELECT o.stage FROM member_onboarding o JOIN user u ON u.id = o.userId WHERE u.email = 'njambi@example.test'");

  it("starts onboarding for an account created while onboarding is open to everyone", async () => {
    const fixture = setup({ spaces: "ALL", onboarding: "ALL" });
    const user = await signUp(fixture);
    expect(user).toMatchObject({ email: "njambi@example.test" });
    expect(newcomer(fixture)).toEqual([{ stage: "NEW" }]);
  });

  it("writes nothing while the flag is off", async () => {
    const fixture = setup({ spaces: "ALL", onboarding: "OFF" });
    await signUp(fixture);
    expect(fixture.rows("SELECT email FROM user WHERE email = 'njambi@example.test'")).toHaveLength(1);
    expect(newcomer(fixture)).toEqual([]);
  });

  it("follows the non-production override", async () => {
    const fixture = setup();
    await signUp(fixture, { DEPLOYMENT_ENVIRONMENT: "agent-pr-260", PLATFORM_FLAGS_OVERRIDE: "all" });
    expect(newcomer(fixture)).toEqual([{ stage: "NEW" }]);
  });

  it("never breaks sign-up when onboarding cannot be written", async () => {
    const fixture = setup({ spaces: "ALL", onboarding: "ALL" });
    fixture.database.exec("DROP TABLE member_onboarding");
    const user = await signUp(fixture);
    expect(user).toMatchObject({ email: "njambi@example.test" });
    expect(fixture.rows("SELECT email FROM user WHERE email = 'njambi@example.test'")).toHaveLength(1);
    expect(fixture.rows("SELECT level FROM errorEvent")).toEqual([{ level: "warning" }]);
  });
});
