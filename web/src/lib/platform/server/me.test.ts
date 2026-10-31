import { afterEach, describe, expect, it, vi } from "vitest";
import { readMigration } from "@/test/sqlite-d1";
import { DEMO_PREFIX } from "@/lib/staging-demo-policy";
import { ErrorEnvelope, FlagKey, Me, ROUTES, SPACE_ORDER } from "../contracts";
import { CAPABILITY_ROLE_MATRIX, type CapabilityCase } from "./capabilities.fixtures";
import { createCapabilityDatabase } from "./capabilities.test-support";
import { getFlags, requireFlag } from "./flags";

const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
import { GET } from "@/pages/api/platform/me";
import { getSpaceContext } from "./space-context";

const databases: ReturnType<typeof createCapabilityDatabase>["database"][] = [];
const zeroCounts = { cohort: 0, community: 0, mentoring: 0, discover: 0, admin: 0, profile: 0 };
function setup(fixture: Partial<CapabilityCase> = {}, userId?: string) {
  const result = createCapabilityDatabase(fixture, userId);
  databases.push(result.database);
  result.database.exec(readMigration("0021_feature_flags.sql"));
  result.database.exec("UPDATE feature_flag SET audience='ALL' WHERE key='spaces'");
  const user: AuthUser | null = result.user ? {
    id: result.user.id, name: "Wanjiku Njeri", image: "https://example.test/avatar.png",
    email: "synthetic@example.test", emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0),
  } : null;
  const context = { locals: { user, session: null } } as Parameters<typeof GET>[0];
  const db = result.db.$client;
  Object.assign(mocks.env, { DB: db, DEPLOYMENT_ENVIRONMENT: "production", PLATFORM_FLAGS_OVERRIDE: undefined });
  const queries = vi.spyOn(db, "prepare");
  return { ...result, db, context, queries };
}
afterEach(() => {
  databases.splice(0).forEach(db => db.close());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function request(context: Parameters<typeof GET>[0]) {
  const response = await GET(context);
  if (!(response instanceof Response)) throw new Error("Expected a response");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  return { response, body: await response.json() };
}

describe("real /me and Astro context adapters", () => {
  it.each(CAPABILITY_ROLE_MATRIX)("$name", async fixture => {
    const { context, queries } = setup(fixture);
    const { response, body } = await request(context);
    if (fixture.signedIn === false) {
      expect(response.status).toBe(404);
      expect(ErrorEnvelope.parse(body).error.code).toBe("flag_off");
      await expect(getSpaceContext(context)).rejects.toMatchObject({ status: 404 });
      expect(queries).not.toHaveBeenCalled();
      return;
    }
    const { spaces, ...capabilities } = fixture.expected;
    expect(response.status).toBe(200);
    const parsed = ROUTES.getMe.response.parse(body);
    expect(parsed).toEqual(body);
    expect(body).toMatchObject({ spaces, capabilities, unreadCounts: zeroCounts,
      flags: { spaces: true, channels: false, tembo_channels: false, mentor_requests: false },
      temboUsage: { used: 0, limit: 10 },
      user: { id: context.locals.user!.id, name: "Wanjiku Njeri", avatarUrl: "https://example.test/avatar.png" },
    });
    expect(Object.keys(parsed.user).toSorted()).toEqual(["avatarUrl", "id", "name", "roleBadges"]);
    expect(Object.keys(parsed.capabilities).toSorted()).toEqual(Object.keys(capabilities).toSorted());
    expect(parsed.spaces).toEqual(SPACE_ORDER.filter(space => spaces.includes(space)));
    expect(queries).toHaveBeenCalledTimes(4); // one flag read, three capability reads
    const fetch = vi.fn(() => { throw new Error("No self-fetch allowed"); });
    vi.stubGlobal("fetch", fetch);
    const page = await getSpaceContext(context);
    expect(Me.parse(page)).toEqual(body);
    expect(JSON.parse(JSON.stringify(page))).toEqual(body);
    expect(fetch).not.toHaveBeenCalled();
    expect(queries).toHaveBeenCalledTimes(7); // same locals retain the flag cache
  });

  it.each(["OFF", "STAFF"])("keeps %s dark for non-admins before any feature read", async audience => {
    const { database, context, queries } = setup({ globalRoles: ["MENTOR", "INSTITUTION"] });
    database.prepare("UPDATE feature_flag SET audience=? WHERE key='spaces'").run(audience);
    database.exec("DROP TABLE programRole; DROP TABLE programApplication");
    const { response, body } = await request(context);
    expect(response.status).toBe(404);
    expect(ErrorEnvelope.parse(body)).toEqual({ error: { code: "flag_off", message: "Not found." } });
    await expect(getSpaceContext(context)).rejects.toMatchObject({ status: 404 });
    expect(queries).toHaveBeenCalledTimes(audience === "STAFF" ? 2 : 1);
  });

  it("keeps production OFF for admins even with a preview override", async () => {
    const { database, context, queries } = setup({ globalRoles: ["ADMIN"] });
    database.exec("UPDATE feature_flag SET audience='OFF'");
    mocks.env.PLATFORM_FLAGS_OVERRIDE = "all";
    context.locals.isAdmin = true;
    expect((await request(context)).response.status).toBe(404);
    expect(queries).toHaveBeenCalledOnce();
  });

  it("keeps unauthenticated previews dark without querying the database", async () => {
    const { context, queries } = setup({ signedIn: false });
    Object.assign(mocks.env, { DEPLOYMENT_ENVIRONMENT: "agent-pr-test", PLATFORM_FLAGS_OVERRIDE: "all" });
    expect((await request(context)).response.status).toBe(404);
    expect(queries).not.toHaveBeenCalled();
  });

  it.each([undefined, true])("shares a STAFF flag cache with other helpers (trusted ADMIN=%s)", async isAdmin => {
    const { database, db, context, queries } = setup({ globalRoles: ["ADMIN"] });
    database.exec("UPDATE feature_flag SET audience='STAFF'");
    context.locals.isAdmin = isAdmin;
    const flagContext = { db, env: mocks.env, user: context.locals.user, isAdmin, locals: context.locals };
    const [flags, denial, me] = await Promise.all([
      getFlags(flagContext), requireFlag(flagContext, "spaces"), getSpaceContext(context),
    ]);
    expect(denial).toBeNull();
    expect(me.flags).toEqual(flags);
    expect(flags).toEqual(Object.fromEntries(FlagKey.options.map(key => [key, true])));
    expect(queries).toHaveBeenCalledTimes(isAdmin === undefined ? 5 : 4);
    expect(queries.mock.calls.filter(([sql]) => sql.includes("FROM feature_flag"))).toHaveLength(1);
  });

  it("uses fresh flags and capabilities on the next request after revocation", async () => {
    const { database, context } = setup({ globalRoles: ["ADMIN", "MENTOR"] });
    const first = await getSpaceContext(context);
    expect(first.capabilities.isAdmin).toBe(true);
    database.exec("DELETE FROM UserRoles");
    const second = await getSpaceContext({ locals: { ...context.locals } });
    expect(second.capabilities).toMatchObject({ isAdmin: false, isMentor: false });
    expect(second.spaces).toEqual(["community", "profile"]);
    database.exec("UPDATE feature_flag SET audience='OFF' WHERE key='spaces'");
    await expect(getSpaceContext({ locals: { ...context.locals } })).rejects.toMatchObject({ status: 404 });
  });

  it("does not trust role claims on the current user or serialize private auth fields", async () => {
    const { context, database } = setup();
    Object.assign(context.locals.user!, { roles: ["ADMIN", "MENTOR"], isAdmin: true, token: "not-a-real-token" });
    database.exec("INSERT INTO programRole (id,userId,programId,name) VALUES ('other','synthetic-otieno','cohort-b','MENTOR')");
    const me = await getSpaceContext(context);
    expect(me.capabilities).toEqual({ cohortIds: [], mentorCohortIds: [], isMentor: false, isInstitution: false, isAdmin: false });
    expect(me.user.roleBadges).toEqual([{ kind: "COMMUNITY", label: "Community", programId: null }]);
    expect(JSON.stringify(me)).not.toMatch(/email|token|roles|createdAt|updatedAt/);
  });

  it.each([{ globalRoles: [] }, { globalRoles: ["ADMIN"] }, { globalRoles: ["MENTOR", "INSTITUTION", "ADMIN"] }])("preserves demo program scope with $globalRoles", async ({ globalRoles }) => {
    const id = DEMO_PREFIX + "member-cohort";
    const { database, context } = setup({ globalRoles,
      applications: [{ programId: "cohort-a", status: "APPROVED" }],
      assignments: [{ programId: "cohort-b", name: "MENTOR" }],
    }, id);
    database.prepare("INSERT INTO program(id,name,description,curriculumId) VALUES (?,?,?,?)")
      .run(DEMO_PREFIX + "program", "Synthetic demo", "Test", "curriculum");
    database.prepare("INSERT INTO programRole(id,userId,programId,name) VALUES (?,?,?,?)")
      .run("demo-role", id, DEMO_PREFIX + "program", "MENTOR");
    const { response, body } = await request(context);
    expect(response.status).toBe(200);
    const me = Me.parse(body);
    expect(me.capabilities.cohortIds).toEqual([DEMO_PREFIX + "program"]);
    expect(me.capabilities.mentorCohortIds).toEqual([DEMO_PREFIX + "program"]);
    expect(me.capabilities.isAdmin).toBe(globalRoles.includes("ADMIN"));
    expect(await getSpaceContext(context)).toEqual(body);
  });

  it("preserves opaque identifiers and null avatars without normalization", async () => {
    const { context } = setup({}, "synthetic/id?part=%2F#name");
    context.locals.user!.image = undefined;
    const { body } = await request(context);
    const me = Me.parse(body);
    expect(me.user.id).toBe(context.locals.user!.id);
    expect(me.user.avatarUrl).toBeNull();
  });

  it.each(["feature_flag", "UserRoles", "programApplication", "programRole"])("fails closed on %s database failure", async table => {
    const { database, context } = setup({ globalRoles: ["ADMIN"] });
    database.exec(`DROP TABLE ${table}`);
    const { response, body } = await request(context);
    expect(response.status).toBe(500);
    expect(ErrorEnvelope.parse(body)).toEqual({ error: { code: "server", message: "Could not load platform context." } });
    expect(JSON.stringify(body)).not.toMatch(/SQL|SELECT|table|synthetic/);
    await expect(getSpaceContext(context)).rejects.toBeInstanceOf(Error);
  });

  it("does not emit a contract-invalid current user payload", async () => {
    const { context } = setup();
    context.locals.user!.name = " ";
    const { response, body } = await request(context);
    expect(response.status).toBe(500);
    expect(ErrorEnvelope.parse(body).error.code).toBe("server");
  });
});
