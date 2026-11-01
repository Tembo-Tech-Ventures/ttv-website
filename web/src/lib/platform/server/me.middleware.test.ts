import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readMigration } from "@/test/sqlite-d1";
import { createCapabilityDatabase } from "./capabilities.test-support";
import { ErrorEnvelope, Me, ROUTES } from "../contracts";

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  getSession: vi.fn(),
  authenticatePersonalAccessToken: vi.fn(),
  recordErrorInBackground: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("@/lib/auth", () => ({ createAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/lib/personal-access-tokens", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/personal-access-tokens")>(),
  authenticatePersonalAccessToken: mocks.authenticatePersonalAccessToken,
}));
vi.mock("@/lib/observability/errors", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/observability/errors")>(),
  recordErrorInBackground: mocks.recordErrorInBackground,
}));
import { onRequest } from "@/middleware";
import { GET } from "@/pages/api/platform/me";

let fixture: ReturnType<typeof createCapabilityDatabase>;
const user = { id: "synthetic-wanjiku", name: "Wanjiku Njeri", email: "synthetic@example.test", image: null };
const auth = { user, session: { id: "synthetic-session", userId: user.id, userAgent: "browser" } };
beforeEach(() => {
  vi.clearAllMocks();
  fixture = createCapabilityDatabase({ assignments: [{ programId: "cohort-a", name: "MENTOR" }] });
  for (const migration of ["0002_married_microbe.sql", "0003_absurd_argent.sql", "0017_community_discovery.sql", "0021_feature_flags.sql", "0023_attention_items.sql", "0025_onboarding.sql"]) {
    fixture.database.exec(readMigration(migration));
  }
  Object.assign(mocks.env, { DB: fixture.db.$client, DEPLOYMENT_ENVIRONMENT: "production" });
  mocks.getSession.mockResolvedValue(auth);
  mocks.authenticatePersonalAccessToken.mockResolvedValue(null);
});
afterEach(() => { fixture.database.close(); vi.restoreAllMocks(); });

async function request(scopes?: string[]) {
  const url = new URL(ROUTES.getMe.path, "https://example.test");
  const headers = new Headers();
  if (scopes) {
    headers.set("Authorization", `Bearer ttv_pat_${"1".repeat(64)}`);
    mocks.authenticatePersonalAccessToken.mockResolvedValue({ ...auth, token: { id: "synthetic-pat", scopes } });
  }
  const ctx = { url, request: new Request(url, { headers }), locals: {},
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  } as unknown as Parameters<typeof GET>[0];
  const next = vi.fn(async () => GET(ctx));
  const response = await onRequest(ctx, next);
  if (!(response instanceof Response)) throw new Error("Expected a response");
  return { response, next };
}

describe("/me through existing authentication middleware", () => {
  it("leaves the new production surface dark with the seeded OFF flag", async () => {
    const { response, next } = await request();
    expect(next).toHaveBeenCalledOnce();
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(ErrorEnvelope.parse(await response.json()).error.code).toBe("flag_off");
    expect(mocks.recordErrorInBackground).not.toHaveBeenCalled();
  });

  it("rejects anonymous requests even when the spaces audience is ALL", async () => {
    mocks.getSession.mockResolvedValue(null);
    fixture.database.exec("UPDATE feature_flag SET audience='ALL' WHERE key='spaces'");
    const { response } = await request();
    expect(response.status).toBe(404);
    expect(ErrorEnvelope.parse(await response.json()).error.code).toBe("flag_off");
  });

  it("loads the authenticated caller's real program scope", async () => {
    fixture.database.exec("UPDATE feature_flag SET audience='ALL' WHERE key='spaces'");
    const { response } = await request();
    expect(response.status).toBe(200);
    const me = Me.parse(await response.json());
    expect(me.user.id).toBe(user.id);
    expect(me.capabilities).toEqual({ cohortIds: ["cohort-a"], mentorCohortIds: ["cohort-a"],
      isMentor: false, isInstitution: false, isAdmin: false });
    expect(me.spaces).toEqual(["cohort", "community", "profile"]);
  });

  it("preserves the existing community delegation boundary", async () => {
    fixture.database.exec("UPDATE feature_flag SET audience='ALL' WHERE key='spaces'");
    const { response, next } = await request(["community:read"]);
    expect(response.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns a sanitized database failure and retains middleware error observation", async () => {
    fixture.database.exec("UPDATE feature_flag SET audience='ALL' WHERE key='spaces'; DROP TABLE programRole");
    const { response } = await request();
    expect(response.status).toBe(500);
    expect(ErrorEnvelope.parse(await response.json())).toEqual({ error: { code: "server", message: "Could not load platform context." } });
    expect(mocks.recordErrorInBackground).toHaveBeenCalledTimes(2);
    const input = mocks.recordErrorInBackground.mock.calls[0][2];
    expect(input).toMatchObject({ source: "request", route: ROUTES.getMe.path, error: expect.any(Error) });
    expect(input.error.message).toContain("programRole");
  });
});


it.each(["OFF", "ALL"])("keeps admin PATs outside attention counts when %s", async audience => {
  fixture.database.prepare("UPDATE feature_flag SET audience=? WHERE key='spaces'").run(audience);
  fixture.database.exec("DROP TABLE attention_item");
  const { response, next } = await request(["admin:read"]);
  expect(next).toHaveBeenCalledOnce();
  expect(response.status).toBe(audience === "OFF" ? 404 : 403);
  expect(ErrorEnvelope.parse(await response.json()).error.code).toBe(audience === "OFF" ? "flag_off" : "forbidden");
});
