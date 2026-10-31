import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPABILITY_ROLE_MATRIX } from "@/lib/platform/server/capabilities.fixtures";
import { AttentionCount, AttentionList } from "@/lib/platform/contracts";
import { attentionDatabase } from "./test-support";
import { attentionRequest } from "./http";

const userId = "synthetic-wanjiku";
function context(method = "GET", path = "/api/attention", body?: unknown, headers: Record<string, string> = {}) {
  return { request: new Request("https://example.test" + path, { method, headers,
    body: body === undefined ? undefined : JSON.stringify(body) }),
  locals: { user: { id: userId } } as App.Locals } satisfies Pick<APIContext, "request" | "locals">;
}
afterEach(() => vi.restoreAllMocks());

describe("attention APIs", () => {
  it.each(CAPABILITY_ROLE_MATRIX)("scopes list/count/read to the caller: $name", async fixture => {
    const s = attentionDatabase(fixture);
    try {
      s.seed("own /%雪"); s.seed("other", { userId: "synthetic-otieno" });
      const env = { DB: s.db.$client, DEPLOYMENT_ENVIRONMENT: "agent-test", PLATFORM_FLAGS_OVERRIDE: "all" };
      for (const operation of ["list", "count", "read"] as const) {
        const ctx = operation === "read" ? context("POST", "/api/attention/read", { ids: ["own /%雪", "other"] }, { Origin: "https://example.test" }) : context();
        if (fixture.signedIn === false) ctx.locals.user = null;
        s.queries.length = 0;
        const response = await attentionRequest(operation, ctx, env);
        expect(response.status).toBe(fixture.signedIn === false ? 404 : 200);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        const body = await response.json();
        if (fixture.signedIn !== false) {
          if (operation === "list") expect(AttentionList.parse(body).items.map(item => item.id)).toEqual(["own /%雪"]);
          else expect(AttentionCount.parse(body).count).toBe(operation === "read" ? 0 : 1);
        }
      }
      expect(s.database.prepare("SELECT readAt FROM attention_item WHERE id='other'").get()).toEqual({ readAt: null });
    } finally { s.database.close(); }
  });

  it.each(["list", "count", "read"] as const)("OFF returns404 before attention queries or validation: %s", async operation => {
    const s = attentionDatabase({ globalRoles: ["ADMIN"] });
    try {
      const prepare = vi.spyOn(s.db.$client, "prepare");
      const ctx = context("POST", "/api/attention?unexpected=true", { invalid: true });
      const response = await attentionRequest(operation, ctx, {
        DB: s.db.$client, DEPLOYMENT_ENVIRONMENT: "production", PLATFORM_FLAGS_OVERRIDE: "all",
      });
      expect(response.status).toBe(404);
      expect(prepare.mock.calls.map(call => call[0])).toEqual(["SELECT key, audience FROM feature_flag WHERE key IN (?, ?, ?, ?)"]);
    } finally { s.database.close(); }
  });

  it("STAFF uses database admin authority and ignores caller role claims", async () => {
    const s = attentionDatabase();
    try {
      s.database.exec("UPDATE feature_flag SET audience='STAFF' WHERE key='spaces'");
      const ctx = context(); ctx.locals.isAdmin = true;
      expect((await attentionRequest("count", ctx, { DB: s.db.$client })).status).toBe(404);
      s.database.exec(`INSERT INTO Roles(id,name) VALUES ('admin','ADMIN'); INSERT INTO UserRoles(id,userId,roleId) VALUES ('role','synthetic-wanjiku','admin')`);
      expect((await attentionRequest("count", context(), { DB: s.db.$client })).status).toBe(200);
    } finally { s.database.close(); }
  });

  it.each([undefined, "https://evil.test", "null"])("rejects unsafe origin %s without marking items", async origin => {
    const s = attentionDatabase();
    try {
      s.seed("own");
      const response = await attentionRequest("read", context("POST", "/api/attention/read", { ids: ["own"] }, origin ? { Origin: origin } : {}),
        { DB: s.db.$client, PLATFORM_FLAGS_OVERRIDE: "all", DEPLOYMENT_ENVIRONMENT: "agent-test" });
      expect(response.status).toBe(403);
      expect(s.database.prepare("SELECT readAt FROM attention_item").get()).toEqual({ readAt: null });
    } finally { s.database.close(); }
  });

  it.each(["?filter=unknown", "?filter=all&filter=updates", "?unreadOnly=false", "?cursor=%25%25%25", "?userId=synthetic-otieno"])("rejects invalid query %s", async query => {
    const s = attentionDatabase();
    try {
      expect((await attentionRequest("list", context("GET", "/api/attention" + query), { DB: s.db.$client, PLATFORM_FLAGS_OVERRIDE: "all" })).status).toBe(400);
    } finally { s.database.close(); }
  });

  it.each([{ ids: [] }, { ids: ["x"], userId: "synthetic-otieno" }, { through: -1 }, { ids: ["x"], through: 1000 }])("rejects invalid read payload %j", async body => {
    const s = attentionDatabase();
    try {
      expect((await attentionRequest("read", context("POST", "/api/attention/read", body, { Origin: "https://example.test" }), { DB: s.db.$client, PLATFORM_FLAGS_OVERRIDE: "all" })).status).toBe(400);
    } finally { s.database.close(); }
  });

  it("rejects PATs without adding a new scope or exposing attention", async () => {
    const s = attentionDatabase();
    try {
      const ctx = context(); ctx.locals.personalAccessToken = { scopes: ["admin:read"] } as App.Locals["personalAccessToken"];
      expect((await attentionRequest("count", ctx, { DB: s.db.$client, PLATFORM_FLAGS_OVERRIDE: "all" })).status).toBe(403);
    } finally { s.database.close(); }
  });

  it("returns bounded validation errors and hides database failure details", async () => {
    const s = attentionDatabase();
    try {
      const env = { DB: s.db.$client, PLATFORM_FLAGS_OVERRIDE: "all" };
      const invalid = context("POST", "/api/attention/read", undefined, { Origin: "https://example.test" });
      invalid.request = new Request(invalid.request, { body: "invalid-json" });
      expect((await attentionRequest("read", invalid, env)).status).toBe(400);
      expect((await attentionRequest("read", context("POST", "/api/attention/read", { ids: ["x".repeat(33_000)] }, { Origin: "https://example.test" }), env)).status).toBe(413);
      s.database.exec("DROP TABLE attention_item");
      const response = await attentionRequest("count", context(), env);
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("attention_item");
    } finally { s.database.close(); }
  });
});
