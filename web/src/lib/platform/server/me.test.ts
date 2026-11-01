import { afterEach, describe, expect, it, vi } from "vitest";
import { readMigration } from "@/test/sqlite-d1";
import { DEMO_PREFIX } from "@/lib/staging-demo-policy";
import { ErrorEnvelope, FlagKey, Me, ROUTES, SPACE_ORDER, type RoleBadge } from "../contracts";
import { CAPABILITY_ROLE_MATRIX, type CapabilityCase } from "./capabilities.fixtures";
import { createCapabilityDatabase } from "./capabilities.test-support";
import { getFlags, requireFlag } from "./flags";

const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, recordErrorInBackground: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/observability/errors", () => ({ recordErrorInBackground: mocks.recordErrorInBackground }));
import { GET } from "@/pages/api/platform/me";
import { getSpaceContext } from "./space-context";

const databases: ReturnType<typeof createCapabilityDatabase>["database"][] = [];
const zeroCounts = { cohort: 0, community: 0, mentoring: 0, discover: 0, admin: 0, profile: 0 };
const community: RoleBadge[] = [{ kind: "COMMUNITY", label: "Community", programId: null }];
const mentor: RoleBadge[] = [{ kind: "MENTOR", label: "Mentor", programId: null }];
const institution: RoleBadge[] = [{ kind: "INSTITUTION", label: "Institution partner", programId: null }];
const admin: RoleBadge[] = [{ kind: "STAFF", label: "Staff", programId: null }, { kind: "ADMIN", label: "Admin", programId: null }];
// Explicit DTO expectations in addition to the shared authorization matrix.
// Program badges remain absent until their status/name display metadata exists.
const expectedBadges: Record<string, RoleBadge[]> = {
  unauthenticated: [], "community member": community,
  "pending applicant": [], "rejected applicant": [], "applicant without cohort": [],
  approved: [], audit: [], completed: [], INSTRUCTOR: [], TA: [], "per-cohort mentor only": [],
  "global mentor without assignment": mentor, institution, admin,
  "institution and cohort mentor": institution, "global mentor and approved student": mentor,
  "multi-cohort roles deduplicated": [], "all global roles and cohort mentor": [...institution, ...mentor, ...admin],
  "global staff labels do not grant cohort scope": community,
};
function setup(fixture: Partial<CapabilityCase> = {}, userId?: string) {
  const result = createCapabilityDatabase(fixture, userId);
  databases.push(result.database);
  for (const migration of ["0002_married_microbe.sql", "0003_absurd_argent.sql", "0017_community_discovery.sql", "0021_feature_flags.sql", "0023_attention_items.sql", "0025_onboarding.sql", "0027_mentor_set_aside.sql"]) {
    result.database.exec(readMigration(migration));
  }
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

function seedAttention(database: ReturnType<typeof createCapabilityDatabase>["database"]) {
  database.exec(`INSERT INTO studentProfile(id,userId,handle) VALUES
    ('own-profile','synthetic-wanjiku','synthetic-wanjiku'),('other-profile','synthetic-otieno','synthetic-otieno');
    INSERT INTO profileContact(id,profileId,fromName,fromEmail,message) VALUES
    ('own-contact','own-profile','Visitor','visitor@example.test','Hello'),
    ('other-contact','other-profile','Visitor','visitor@example.test','Hello');
    INSERT INTO recording(id,programId,title) VALUES ('recording-a','cohort-a','Synthetic A'),('recording-b','cohort-b','Synthetic B');
    INSERT INTO attention_item(id,userId,eventKey,kind,space,category,subjectKind,subjectId,subjectHref,subjectLabel,summary,createdAt,readAt) VALUES
    ('own','synthetic-wanjiku','own','visitor_message','profile','updates','visitorMessage','own-contact','/dashboard/leads','Message','New message',1000,NULL),
    ('read','synthetic-wanjiku','read','visitor_message','profile','updates','visitorMessage','own-contact','/dashboard/leads','Message','New message',1000,2000),
    ('foreign','synthetic-otieno','foreign','visitor_message','profile','updates','visitorMessage','other-contact','/dashboard/leads','Message','New message',1000,NULL),
    ('wrong-source','synthetic-wanjiku','wrong-source','visitor_message','profile','updates','visitorMessage','other-contact','/dashboard/leads','Message','New message',1000,NULL),
    ('a','synthetic-wanjiku','a','recording_ready','cohort','updates','recording','recording-a','/dashboard/sessions/recording-a','Recording','Ready',1000,NULL),
    ('b','synthetic-wanjiku','b','recording_ready','cohort','updates','recording','recording-b','/dashboard/sessions/recording-b','Recording','Ready',1000,NULL)`);
}

async function request(context: Parameters<typeof GET>[0]) {
  const response = await GET(context);
  if (!(response instanceof Response)) throw new Error("Expected a response");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  return { response, body: await response.json() };
}

describe("real /me and Astro context adapters", () => {
  it.each(CAPABILITY_ROLE_MATRIX)("$name", async fixture => {
    const { context, queries, database } = setup(fixture);
    seedAttention(database);
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
    expect(body).toMatchObject({ spaces, capabilities, unreadCounts: { ...zeroCounts,
      profile: 1, cohort: capabilities.isAdmin ? 2 : capabilities.cohortIds.length,
    },
      flags: { spaces: true, channels: false, tembo_channels: false, mentor_requests: false, onboarding: false },
      temboUsage: { used: 0, limit: 10 },
      user: { id: context.locals.user!.id, name: "Wanjiku Njeri", avatarUrl: "https://example.test/avatar.png" },
    });
    expect(Object.keys(parsed.user).toSorted()).toEqual(["avatarUrl", "id", "name", "roleBadges"]);
    expect(parsed.user.roleBadges).toEqual(expectedBadges[fixture.name]);
    expect(Object.keys(parsed.capabilities).toSorted()).toEqual(Object.keys(capabilities).toSorted());
    expect(parsed.spaces).toEqual(SPACE_ORDER.filter(space => spaces.includes(space)));
    const mentoring = spaces.includes("mentoring");
    // Only the Mentoring space derives its waiting confirmations, and only from the Confirm page's rows.
    expect(parsed.mentoring).toEqual(mentoring ? { awaitingConfirmation: 0 } : undefined);
    // One flag, three capability and one attention count read; mentors add a role and a row read.
    const reads = mentoring ? 7 : 5;
    expect(queries).toHaveBeenCalledTimes(reads);
    const fetch = vi.fn(() => { throw new Error("No self-fetch allowed"); });
    vi.stubGlobal("fetch", fetch);
    const page = await getSpaceContext(context);
    expect(Me.parse(page)).toEqual(body);
    expect(JSON.parse(JSON.stringify(page))).toEqual(body);
    expect(fetch).not.toHaveBeenCalled();
    expect(queries).toHaveBeenCalledTimes(reads); // middleware/page/API share the same request context
  });

  it("counts the shared work waiting for a mentor's confirmation, behind the Confirm page's own checks", async () => {
    const { database, context } = setup({ globalRoles: ["MENTOR"] });
    const mentorId = context.locals.user!.id;
    database.exec(`INSERT INTO user (id,name,email) VALUES ('synthetic-member','Member','member@example.test')`);
    const journey = database.prepare("INSERT INTO communityJourney (id,userId,title,description,occurredAt,visibility) VALUES (?,?,'Work','Fictional work','2026-10-01',?)");
    journey.run("shared", "synthetic-member", "institution");
    journey.run("shared-confirmed", "synthetic-member", "institution");
    journey.run("private", "synthetic-member", "private");
    journey.run("own", mentorId, "institution");
    database.prepare("INSERT INTO communityConfirmation (id,journeyId,mentorId,statement,method,journeyVersion) VALUES ('c','shared-confirmed',?,'I checked it','Review',1)").run(mentorId);
    expect(Me.parse((await request(context)).body).mentoring).toEqual({ awaitingConfirmation: 1 });

    // A delegated agent session is refused by the Confirm page, so it gets no number at all.
    const agent = { ...context.locals, session: { userAgent: "ttv-agent:fixture" } as unknown as App.Locals["session"] };
    const refused = Me.parse((await request({ ...context, locals: agent } as typeof context)).body);
    expect(refused).not.toHaveProperty("mentoring");
    expect(refused.spaces).toContain("mentoring");
  });

  it("still serves a mentor's spaces when the waiting count cannot be read, with no number and the failure recorded", async () => {
    const { database, context } = setup({ globalRoles: ["MENTOR"] });
    database.exec("DROP TABLE communityConfirmation");
    const { response, body } = await request(context);
    expect(response.status).toBe(200);
    const me = Me.parse(body);
    expect(me.spaces).toContain("mentoring");
    expect(me).not.toHaveProperty("mentoring");
    expect(mocks.recordErrorInBackground).toHaveBeenCalledWith(undefined, expect.anything(), expect.objectContaining({ level: "warning" }));
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
    expect(queries).toHaveBeenCalledTimes(isAdmin === undefined ? 6 : 5);
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

  it.each(["feature_flag", "UserRoles", "programApplication", "programRole", "attention_item"])("fails closed on %s database failure", async table => {
    const { database, context } = setup({ globalRoles: ["ADMIN"] });
    database.exec(`DROP TABLE ${table}`);
    const { response, body } = await request(context);
    expect(response.status).toBe(500);
    expect(ErrorEnvelope.parse(body)).toEqual({ error: { code: "server", message: "Could not load platform context." } });
    expect(JSON.stringify(body)).not.toMatch(/SQL|SELECT|table|synthetic/);
    await expect(getSpaceContext(context)).rejects.toBeInstanceOf(Error);
  });

  it.each([
    { name: "", image: null, expectedName: "Member", expectedAvatar: null },
    { name: " \t ", image: "", expectedName: "Member", expectedAvatar: null },
    // oxlint-disable-next-line no-script-url -- regression fixture: this stored URL must be rejected
    { name: " Wanjiku Njeri ", image: "javascript:alert(1)", expectedName: "Wanjiku Njeri", expectedAvatar: null },
    { name: "Wanjiku Njeri", image: "data:image/svg+xml,unsafe", expectedName: "Wanjiku Njeri", expectedAvatar: null },
    { name: "Wanjiku Njeri", image: "//example.test/avatar", expectedName: "Wanjiku Njeri", expectedAvatar: null },
    { name: "Wanjiku Njeri", image: "/images/avatar.png", expectedName: "Wanjiku Njeri", expectedAvatar: "/images/avatar.png" },
  ])("normalizes legacy display fields safely: $name / $image", async ({ name, image, expectedName, expectedAvatar }) => {
    const { context } = setup();
    Object.assign(context.locals.user!, { name, image });
    const { response, body } = await request(context);
    expect(response.status).toBe(200);
    const me = Me.parse(body);
    expect(me.user.name).toBe(expectedName);
    expect(me.user.avatarUrl).toBe(expectedAvatar);
    expect(JSON.stringify(me)).not.toContain(context.locals.user!.email);
    expect(await getSpaceContext(context)).toEqual(me);
  });
});


it("refreshes /me counts after cohort revocation, source ownership changes and read state", async () => {
  const { database, context } = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
  seedAttention(database);
  expect(Me.parse((await request(context)).body).unreadCounts).toEqual({ ...zeroCounts, profile: 1, cohort: 1 });
  database.exec("DELETE FROM programApplication");
  expect((await getSpaceContext({ locals: { ...context.locals } })).unreadCounts).toEqual({ ...zeroCounts, profile: 1 });
  database.exec("UPDATE profileContact SET profileId='other-profile' WHERE id='own-contact'");
  // A new HTTP request has fresh locals; within one request the middleware and
  // layout deliberately share the same authorized snapshot.
  expect(Me.parse((await request({ ...context, locals: { ...context.locals } })).body).unreadCounts).toEqual(zeroCounts);
  database.exec("UPDATE profileContact SET profileId='own-profile' WHERE id='own-contact'; UPDATE attention_item SET readAt=2000 WHERE id='own'");
  expect((await getSpaceContext({ locals: { ...context.locals } })).unreadCounts).toEqual(zeroCounts);
});

it.each(["OFF", "ALL"])("does not expose counts to PAT page-context callers when %s", async audience => {
  const { database, context, queries } = setup();
  context.locals.personalAccessToken = {
    id: "synthetic-pat", label: "Synthetic", tokenPrefix: "ttv_pat_test", scopes: ["admin:read"],
    expiresAt: new Date(100000), createdAt: new Date(0), lastUsedAt: null, revokedAt: null,
  };
  database.prepare("UPDATE feature_flag SET audience=? WHERE key='spaces'").run(audience);
  database.exec("DROP TABLE attention_item");
  await expect(getSpaceContext(context)).rejects.toMatchObject({ status: audience === "OFF" ? 404 : 403 });
  expect(queries).toHaveBeenCalledOnce(); // flag only; no capabilities/count lookup
});
