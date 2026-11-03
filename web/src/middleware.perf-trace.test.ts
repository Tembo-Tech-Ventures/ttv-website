import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readMigration } from "@/test/sqlite-d1";
import { createCapabilityDatabase } from "@/lib/platform/server/capabilities.test-support";
import { Me, ROUTES } from "@/lib/platform/contracts";

const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("@/lib/auth", () => ({ createAuth: () => ({ api: { getSession: mocks.getSession } }) }));
import { onRequest } from "@/middleware";
import { GET } from "@/pages/api/platform/me";

let fixture: ReturnType<typeof createCapabilityDatabase>;
const user = { id: "synthetic-wanjiku", name: "Wanjiku Njeri", email: "synthetic@example.test", image: null };

beforeEach(() => {
  fixture = createCapabilityDatabase();
  for (const migration of ["0002_married_microbe.sql", "0003_absurd_argent.sql", "0017_community_discovery.sql", "0021_feature_flags.sql", "0023_attention_items.sql", "0025_onboarding.sql", "0028_channels.sql", "0032_moderation_pipeline.sql", "0036_mentor_requests.sql", "0037_mentor_request_checks.sql"]) {
    fixture.database.exec(readMigration(migration));
  }
  fixture.database.exec("UPDATE feature_flag SET audience='ALL' WHERE key='spaces'");
  mocks.getSession.mockResolvedValue({ user, session: { id: "synthetic-session", userId: user.id, userAgent: "browser" } });
  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
});
afterEach(() => { fixture.database.close(); vi.unstubAllGlobals(); });

async function request(environment: string, cookie: string) {
  Object.assign(mocks.env, { DB: fixture.db.$client, DEPLOYMENT_ENVIRONMENT: environment });
  const url = new URL(ROUTES.getMe.path, "https://example.test");
  const ctx = { url, request: new Request(url, { headers: { cookie } }), locals: {},
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  } as unknown as Parameters<typeof GET>[0];
  const response = await onRequest(ctx, async () => GET(ctx));
  if (!(response instanceof Response)) throw new Error("Expected a response");
  return response;
}

describe("the server trace in the middleware", () => {
  it.each(["production", "prod"])("never decorates a %s response, even when asked", async (environment) => {
    const response = await request(environment, "ttv-perf=detail");
    expect(response.status).toBe(200);
    expect(response.headers.get("Server-Timing")).toBeNull();
    Me.parse(await response.json());
  });

  it("leaves untraced preview requests alone", async () => {
    const response = await request("agent-pr-9", "");
    expect(response.headers.get("Server-Timing")).toBeNull();
  });

  it("times a preview request that asks, by phase, without changing its body", async () => {
    const response = await request("agent-pr-9", "ttv-perf=1");
    expect(response.status).toBe(200);
    const timing = response.headers.get("Server-Timing") ?? "";
    expect(timing).toMatch(/d1;desc="\d+ queries, \d+ waves, depth \d+"/);
    expect(timing).toContain("space;desc=");
    expect(Me.parse(await response.json()).user.id).toBe(user.id);
  });
});
