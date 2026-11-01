import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "@/lib/platform/contracts";
import { onboardingDatabase } from "./test-support";

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  getSession: vi.fn(),
  authenticatePersonalAccessToken: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("@/lib/auth", () => ({ createAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/lib/personal-access-tokens", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/personal-access-tokens")>(),
  authenticatePersonalAccessToken: mocks.authenticatePersonalAccessToken,
}));
vi.mock("@/lib/observability/errors", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/observability/errors")>(),
  recordErrorInBackground: vi.fn(),
}));
import { onRequest } from "@/middleware";
import { GET as listRoute } from "@/pages/api/admin/access-requests/index";
import { POST as decisionRoute } from "@/pages/api/admin/access-requests/[id]/decision";
import { GET as onboardingRoute } from "@/pages/api/platform/onboarding";

const ORIGIN = "https://ttv.example";
let fixture: ReturnType<typeof onboardingDatabase>;
const session = (userId: string, userAgent = "Mozilla/5.0") => ({
  user: { id: userId, name: userId, email: `${userId}@example.test`, image: null },
  session: { id: `${userId}-session`, userId, userAgent },
});
beforeEach(() => {
  vi.clearAllMocks();
  fixture = onboardingDatabase();
  fixture.grant("amina", "ADMIN");
  fixture.database.exec(`UPDATE feature_flag SET audience = 'ALL' WHERE key IN ('spaces', 'onboarding');
    INSERT INTO access_request (id, userId, role, note, createdAt, updatedAt)
    VALUES ('request', 'wairimu', 'MENTOR', 'I review mobile apps and API designs.', 1000, 1000);`);
  Object.assign(mocks.env, { DB: fixture.db, DEPLOYMENT_ENVIRONMENT: "production" });
  mocks.authenticatePersonalAccessToken.mockResolvedValue(null);
});
afterEach(() => fixture.database.close());

type Route = typeof listRoute;
async function call(route: Route, path: string, options: { method?: string; origin?: string; scopes?: string[]; params?: Record<string, string> } = {}) {
  const url = new URL(path, ORIGIN);
  const headers = new Headers(options.origin ? { Origin: options.origin } : {});
  if (options.scopes) {
    headers.set("Authorization", `Bearer ttv_pat_${"1".repeat(64)}`);
    mocks.authenticatePersonalAccessToken.mockResolvedValue({ ...session("amina"), token: { id: "synthetic-pat", scopes: options.scopes } });
  }
  const method = options.method ?? "GET";
  const request = new Request(url, { method, headers, body: method === "GET" ? undefined : JSON.stringify({ decision: "approve" }) });
  const ctx = { url, request, params: options.params ?? {}, locals: {},
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  } as unknown as Parameters<Route>[0];
  const next = vi.fn(async () => route(ctx));
  const response = await onRequest(ctx, next);
  if (!(response instanceof Response)) throw new Error("Expected a response");
  return { response, next };
}
const decide = (options: Parameters<typeof call>[2] = {}) =>
  call(decisionRoute, "/api/admin/access-requests/request/decision", { method: "POST", origin: ORIGIN, params: { id: "request" }, ...options });
const approved = () => fixture.rows("SELECT status FROM access_request")[0]?.status === "APPROVED";

describe("access-request routes through the middleware", () => {
  it.each([["signed out", null], ["a member", "wairimu"]])("answers %s on the admin routes with a 403 envelope, not a redirect", async (_name, userId) => {
    mocks.getSession.mockResolvedValue(userId ? session(userId) : null);
    for (const { response, next } of [await call(listRoute, "/api/admin/access-requests"), await decide()]) {
      expect(response.status).toBe(403);
      expect(ErrorEnvelope.parse(await response.json()).error.code).toBe("forbidden");
      expect(next).not.toHaveBeenCalled();
    }
    expect(approved()).toBe(false);
  });

  it("refuses an administrator's cross-origin decision before the route", async () => {
    mocks.getSession.mockResolvedValue(session("amina"));
    const { response, next } = await decide({ origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(ErrorEnvelope.parse(await response.json()).error.code).toBe("forbidden");
    expect(next).not.toHaveBeenCalled();
    expect(approved()).toBe(false);
  });

  it("lets an admin PAT past the admin guards, where the route refuses it", async () => {
    mocks.getSession.mockResolvedValue(null);
    for (const { response } of [
      await call(listRoute, "/api/admin/access-requests", { scopes: ["admin:read"] }),
      await decide({ scopes: ["admin:read", "admin:write"], origin: undefined }),
    ]) {
      expect(response.status).toBe(403);
      expect(ErrorEnvelope.parse(await response.json()).error.message).toBe("Use a browser session to manage access requests.");
    }
    expect(approved()).toBe(false);
  });

  it("refuses an administrator's agent session", async () => {
    mocks.getSession.mockResolvedValue(session("amina", "ttv-agent:synthetic"));
    const { response } = await decide();
    expect(response.status).toBe(403);
    expect(approved()).toBe(false);
  });

  it("lets an administrator's browser session decide", async () => {
    mocks.getSession.mockResolvedValue(session("amina"));
    expect((await call(listRoute, "/api/admin/access-requests")).response.status).toBe(200);
    expect((await decide()).response.status).toBe(200);
    expect(approved()).toBe(true);
  });

  it("keeps the requester routes dark in production while onboarding is OFF", async () => {
    fixture.database.exec("UPDATE feature_flag SET audience = 'OFF' WHERE key = 'onboarding'");
    mocks.getSession.mockResolvedValue(session("wairimu"));
    const { response } = await call(onboardingRoute, "/api/platform/onboarding");
    expect(response.status).toBe(404);
    expect(ErrorEnvelope.parse(await response.json()).error.code).toBe("flag_off");
  });
});
