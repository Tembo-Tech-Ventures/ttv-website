import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchResults, SearchScope } from "@/lib/platform/contracts";
import { CAPABILITY_ROLE_MATRIX } from "@/lib/platform/server/capabilities.fixtures";
import { searchRequest } from "./http";
import { searchDatabase } from "./test-support";

const databases: ReturnType<typeof searchDatabase>[] = [];
function setup(...args: Parameters<typeof searchDatabase>) { const s = searchDatabase(...args); databases.push(s); return s; }
afterEach(() => { vi.restoreAllMocks(); databases.splice(0).forEach(s => s.database.close()); });
function context(query = "q=Webhook&scope=all", locals: Partial<App.Locals> = {}) {
  return { request: new Request(`https://example.test/api/search?${query}`),
    locals: { user: { id: "synthetic-wanjiku" }, ...locals } as App.Locals } satisfies Pick<APIContext, "request" | "locals">;
}
function environment(s: ReturnType<typeof setup>) {
  // Sentinel bindings prove search does not call the global Vectorize retrieval
  // or send any source/query text to an inference model, on success or failure.
  return { DB: s.db, DEPLOYMENT_ENVIRONMENT: "agent-search", PLATFORM_FLAGS_OVERRIDE: "all",
    VECTORIZE: { query: vi.fn().mockRejectedValue(new Error("forbidden vector retrieval")) },
    AI: { run: vi.fn().mockRejectedValue(new Error("forbidden model input")) } };
}

describe("GET /api/search", () => {
  it.each(CAPABILITY_ROLE_MATRIX)("REST role matrix and retrieval inputs/outputs: $name", async fixture => {
    const s = setup(fixture); const env = environment(s);
    const response = await searchRequest(context(undefined, fixture.signedIn === false ? { user: null } : {}), env);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.status).toBe(fixture.signedIn === false ? 404 : 200);
    if (fixture.signedIn !== false) {
      const result = SearchResults.parse(await response.json());
      expect(result.sessionMoments.map(m => m.programId)).toEqual(fixture.expected.cohortIds);
      expect(result.projects).toHaveLength(fixture.expected.isInstitution || fixture.expected.isAdmin ? 1 : 0);
      expect(result.people.map(p => p.person.id)).toEqual(["synthetic-otieno"]);
      // Everyone signed in reads the community; cohort B's channel, its people and admins.
      const readsCohortB = fixture.expected.isAdmin || fixture.expected.cohortIds.includes("cohort-b");
      expect(result.messages.map(m => m.id)).toEqual(readsCohortB ? ["message-cohort-b", "message-help"] : ["message-help"]);
      const retrieval = s.queries.filter(q => q.sql.includes("CROSS JOIN transcript_segment"));
      expect(retrieval).toHaveLength(fixture.expected.cohortIds.length > 0 ? 1 : 0);
      if (retrieval.length > 0) expect(retrieval[0]?.values[0]).toBe(JSON.stringify(fixture.expected.cohortIds));
    } else expect(s.queries).toEqual([]);
    expect(env.VECTORIZE.query).not.toHaveBeenCalled(); expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("returns flag OFF 404 before validation, capabilities or retrieval, even for a PAT", async () => {
    const s = setup();
    const response = await searchRequest(context("q=&scope=invalid", { personalAccessToken: {} as never }), { DB: s.db });
    expect(response.status).toBe(404); expect(await response.json()).toMatchObject({ error: { code: "flag_off" } });
    expect(s.queries).toHaveLength(1); expect(s.queries[0]?.sql).toContain("feature_flag");
    expect(s.retrieved).not.toContainEqual(expect.objectContaining({ text: expect.anything() }));
  });

  it.each(["personalAccessToken", "stagingFixture", "stagingQa"] as const)("preserves restricted %s denial", async key => {
    const s = setup();
    const response = await searchRequest(context(undefined, { [key]: {} }), environment(s));
    expect(response.status).toBe(403); expect(s.queries).toEqual([]);
  });

  it.each(["", "q=Webhook", "scope=all", "q=&scope=all", "q=%20%20&scope=all", "q=x&scope=invalid",
    "q=x&scope=all&scope=people", "q=x&q=y&scope=all", "q=x&scope=all&cursor=abc", "q=x&scope=all&limit=100",
    "q=x&scope=all&programId=", "q=x&scope=all&programId=a&programId=b", `q=${"x".repeat(501)}&scope=all`])("rejects invalid wire query: %s", async query => {
    const s = setup(); const response = await searchRequest(context(query), environment(s));
    expect(response.status).toBe(400); expect(s.queries).toEqual([]);
    expect(await response.json()).toMatchObject({ error: { code: "validation" } });
  });

  it.each(SearchScope.options)("keeps all empty groups for scope %s", async scope => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const response = await searchRequest(context(`q=no-match&scope=${scope}`), environment(s));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ query: { q: "no-match", scope }, messages: [], people: [], projects: [], sessionMoments: [] });
  });

  it.each(SearchScope.options)("selects only the requested groups: %s", async scope => {
    const s = setup({ globalRoles: ["INSTITUTION"], applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const result = SearchResults.parse(await (await searchRequest(context(`q=Webhook&scope=${scope}`), environment(s))).json());
    expect(result.people).toHaveLength(["all", "people", "community"].includes(scope) ? 1 : 0);
    expect(result.projects).toHaveLength(["all", "projects", "community"].includes(scope) ? 1 : 0);
    expect(result.sessionMoments).toHaveLength(["all", "sessionMoments", "cohort"].includes(scope) ? 1 : 0);
    expect(result.messages).toHaveLength(["all", "messages", "community"].includes(scope) ? 1 : 0);
  });

  it.each(["all", "cohort", "sessionMoments"])("narrows %s to an authorized program", async scope => {
    const s = setup({ assignments: [{ programId: "cohort-a", name: "MENTOR" }, { programId: "cohort-b", name: "MENTOR" }] });
    const result = SearchResults.parse(await (await searchRequest(context(`q=Webhook&scope=${scope}&programId=cohort-a`), environment(s))).json());
    expect(result.people).toEqual([]); expect(result.projects).toEqual([]); expect(result.messages).toEqual([]);
    expect(result.sessionMoments.map(m => m.programId)).toEqual(["cohort-a"]);
    expect(s.queries.find(q => q.sql.includes("CROSS JOIN transcript_segment"))?.values[0]).toBe('["cohort-a"]');
    expect(JSON.stringify(s.retrieved)).not.toContain("Webhook cohort B secret");
  });

  it.each(["cohort-b", "does-not-exist"])("does not reveal unauthorized program existence: %s", async programId => {
    const s = setup({ globalRoles: ["ADMIN"], applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const response = await searchRequest(context(`q=Webhook&scope=all&programId=${programId}`), environment(s));
    expect(response.status).toBe(403); expect(s.queries).toHaveLength(3); expect(s.retrieved).toEqual([]);
  });

  it.each(["community", "people", "projects", "messages"])("rejects incompatible program with %s", async scope => {
    const s = setup({ assignments: [{ programId: "cohort-a", name: "MENTOR" }] });
    expect((await searchRequest(context(`q=Webhook&scope=${scope}&programId=cohort-a`), environment(s))).status).toBe(403);
    expect(s.retrieved).toEqual([]);
  });

  it.each(["flags", "capabilities", "people", "projects", "transcripts", "channels", "messages"])("fails closed without raw errors or partial results on %s failure", async stage => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const realPrepare = s.db.prepare.bind(s.db);
    const needle = { flags: "feature_flag", capabilities: "UserRoles", people: "FROM studentProfile", projects: "FROM communityJourney", transcripts: "CROSS JOIN transcript_segment",
      channels: "from \"channel\"", messages: "channel_message_fts" }[stage]!;
    vi.spyOn(s.db, "prepare").mockImplementation(sql => { if (sql.includes(needle)) throw new Error("SQL secret operational data"); return realPrepare(sql); });
    const env = environment(s); if (stage === "flags") env.PLATFORM_FLAGS_OVERRIDE = "";
    const response = await searchRequest(context(), env);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "server", message: "Could not search right now." } });
    expect(env.VECTORIZE.query).not.toHaveBeenCalled(); expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("accepts exactly 500 query characters and echoes the contract query unchanged", async () => {
    const s = setup(); const q = " " + "x".repeat(498) + " ";
    const response = await searchRequest(context(new URLSearchParams({ q, scope: "messages" }).toString()), environment(s));
    expect(response.status).toBe(200); expect(SearchResults.parse(await response.json()).query.q).toBe(q);
  });
});
