import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPABILITY_ROLE_MATRIX } from "@/lib/platform/server/capabilities.fixtures";
import { AttentionCount, AttentionList, FlagKey } from "@/lib/platform/contracts";
import { attentionDatabase } from "./test-support";
import { attentionRequest } from "./http";

const userId = "synthetic-wanjiku";
function context(method = "GET", path = "/api/attention", body?: unknown, headers: Record<string, string> = {}) {
  const options: RequestInit = { method, headers };
  if (body !== undefined) options.body = JSON.stringify(body);
  return { request: new Request("https://example.test" + path, options),
  locals: { user: { id: userId } } as App.Locals } satisfies Pick<APIContext, "request" | "locals">;
}
afterEach(() => vi.restoreAllMocks());

describe("attention APIs", () => {
  it.each(CAPABILITY_ROLE_MATRIX)("applies current recording scope to list, count and read: $name", async fixture => {
    const s = attentionDatabase(fixture);
    try {
      s.seed("notice", { space: "cohort" });
      s.database.exec(`INSERT INTO recording(id,programId,title,processingStatus) VALUES ('recording','cohort-a','Private recording','complete');
        UPDATE attention_item SET kind='recording_ready',subjectKind='recording',subjectId='recording'`);
      const allowed = fixture.signedIn !== false && (fixture.expected.isAdmin || fixture.expected.cohortIds.includes("cohort-a"));
      const env = { DB: s.db.$client, PLATFORM_FLAGS_OVERRIDE: "all" };
      for (const operation of ["list", "count", "read"] as const) {
        const ctx = operation === "read" ? context("POST", "/api/attention/read", { ids: ["notice"] }, { Origin: "https://example.test" }) : context();
        if (fixture.signedIn === false) ctx.locals.user = null;
        const response = await attentionRequest(operation, ctx, env);
        if (fixture.signedIn === false) { expect(response.status).toBe(404); continue; }
        expect(response.status).toBe(200);
        if (operation === "list") expect(AttentionList.parse(await response.json()).items).toHaveLength(allowed ? 1 : 0);
        else expect(AttentionCount.parse(await response.json()).count).toBe(operation === "count" && allowed ? 1 : 0);
      }
      const row = s.database.prepare("SELECT readAt FROM attention_item").get();
      expect(row?.readAt === null).toBe(!allowed);
    } finally { s.database.close(); }
  });

  it("revoked cohort access immediately removes the item from list/count/read", async () => {
    const s = attentionDatabase({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    try {
      s.seed("notice", { space: "cohort" });
      s.database.exec(`INSERT INTO recording(id,programId,title) VALUES ('recording','cohort-a','Private');
        UPDATE attention_item SET kind='recording_ready',subjectKind='recording',subjectId='recording'`);
      const env = { DB: s.db.$client, PLATFORM_FLAGS_OVERRIDE: "all" };
      expect(AttentionCount.parse(await (await attentionRequest("count", context(), env)).json()).count).toBe(1);
      s.database.exec("UPDATE programApplication SET status='REJECTED'");
      expect(AttentionCount.parse(await (await attentionRequest("count", context(), env)).json()).count).toBe(0);
      expect(AttentionList.parse(await (await attentionRequest("list", context(), env)).json()).items).toEqual([]);
      await attentionRequest("read", context("POST", "/api/attention/read", { through: Date.now() }, { Origin: "https://example.test" }), env);
      expect(s.database.prepare("SELECT readAt FROM attention_item").get()).toEqual({ readAt: null });
    } finally { s.database.close(); }
  });

  it("does not reveal foreign, deleted, or unsupported subjects even with an owned notification row", async () => {
    const s = attentionDatabase();
    try {
      s.seed("own"); s.seed("foreign", { userId: "synthetic-otieno" });
      const env = { DB: s.db.$client, PLATFORM_FLAGS_OVERRIDE: "all" };
      s.database.exec("UPDATE attention_item SET subjectId='foreign' WHERE id='own'");
      expect(AttentionCount.parse(await (await attentionRequest("count", context(), env)).json()).count).toBe(0);
      s.database.exec("UPDATE attention_item SET subjectId='own',subjectKind='message' WHERE id='own'");
      expect(AttentionCount.parse(await (await attentionRequest("count", context(), env)).json()).count).toBe(0);
      s.database.exec("UPDATE attention_item SET subjectKind='visitorMessage' WHERE id='own'; DELETE FROM profileContact WHERE id='own'");
      expect(AttentionList.parse(await (await attentionRequest("list", context(), env)).json()).items).toEqual([]);
    } finally { s.database.close(); }
  });

  it("loads capabilities once and performs one indexed count query", async () => {
    const s = attentionDatabase();
    try {
      const prepare = vi.spyOn(s.db.$client, "prepare");
      expect((await attentionRequest("count", context(), { DB: s.db.$client, PLATFORM_FLAGS_OVERRIDE: "all" })).status).toBe(200);
      expect(prepare).toHaveBeenCalledTimes(4);
    } finally { s.database.close(); }
  });

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
      expect(prepare.mock.calls.map(call => call[0])).toEqual([
        `SELECT key, audience FROM feature_flag WHERE key IN (${FlagKey.options.map(() => "?").join(", ")})`,
      ]);
    } finally { s.database.close(); }
  });

  it("STAFF uses database admin authority and ignores caller role claims", async () => {
    const s = attentionDatabase();
    try {
      s.database.exec("UPDATE feature_flag SET audience='STAFF' WHERE key='spaces'");
      const ctx = context(); ctx.locals.isAdmin = true;
      expect((await attentionRequest("count", ctx, { DB: s.db.$client })).status).toBe(404);
      s.database.exec(`INSERT INTO UserRoles(id,userId,roleId) SELECT 'role','synthetic-wanjiku',id FROM Roles WHERE name='ADMIN'`);
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
      invalid.request = new Request(invalid.request, { method: "POST", body: "invalid-json" });
      expect((await attentionRequest("read", invalid, env)).status).toBe(400);
      expect((await attentionRequest("read", context("POST", "/api/attention/read", { ids: ["x".repeat(33_000)] }, { Origin: "https://example.test" }), env)).status).toBe(413);
      s.database.exec("DROP TABLE attention_item");
      const response = await attentionRequest("count", context(), env);
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("attention_item");
    } finally { s.database.close(); }
  });
});
