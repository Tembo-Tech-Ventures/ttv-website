import { readdirSync } from "node:fs";
import type { SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { searchPlatform } from "@/lib/search/service";
import { discoverableMember } from "./eligibility";
import { createCommunityService } from "./service";
import { handleCommunityRequest } from "./http";
import { handleCommunityMcp } from "./mcp";
import { runCommunityChat } from "./chat";
import { discoverProfiles, type DiscoveryDependencies } from "./discovery";
import { COMMUNITY_NATIVE_MODEL } from "./native-gateway";

/**
 * Owner decision 2026-11-01 (QA1-09): institutional discovery lists only people
 * who saved a community profile, never mentors, admins or the caller, and the
 * INSTITUTION role never excludes an otherwise eligible member. One test
 * across every institutional surface, so they cannot drift apart again.
 */
const PEOPLE = {
  joseph: { name: "Joseph Mutua", roles: ["INSTITUTION"], saved: true },
  achieng: { name: "Achieng Otieno", roles: [], saved: true },
  lucy: { name: "Lucy Chebet", roles: [], saved: false },
  david: { name: "David Kamau", roles: ["MENTOR"], saved: true },
  amina: { name: "Amina Hassan", roles: ["ADMIN"], saved: true },
  kevin: { name: "Kevin Wafula", roles: ["INSTITUTION"], saved: true },
} as const;
type Person = keyof typeof PEOPLE;
const EVERYONE = Object.keys(PEOPLE) as Person[];
const GHOST = "synthetic-never-existed";
const id = (person: Person) => `synthetic-${person}`;

const open: ReturnType<typeof createSqliteD1>[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const f of open.splice(0)) f.database.close(); });

/** Everyone would match "Webhook" on every surface if eligibility allowed it. */
function world() {
  const f = createSqliteD1(); open.push(f);
  for (const file of readdirSync(new URL("../db/migrations/", import.meta.url)).filter(n => n.endsWith(".sql")).toSorted()) {
    f.database.exec(readMigration(file));
  }
  f.database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId) VALUES ('cohort','Cohort','Test','curriculum');`);
  for (const person of EVERYONE) {
    const { name, roles, saved } = PEOPLE[person];
    const userId = id(person);
    f.database.prepare("INSERT INTO user(id,name,email) VALUES (?,?,?)").run(userId, `${name} Webhook`, `${userId}@invalid.ttv`);
    for (const role of roles) f.database.prepare("INSERT INTO UserRoles(id,userId,roleId) SELECT ?,?,id FROM Roles WHERE name=?").run(`${userId}-${role}`, userId, role);
    if (saved) f.database.prepare("INSERT INTO communityProfile(userId,headline,bio,skills) VALUES (?,?,?,?)").run(userId, "Webhook builder", "I build webhook relays.", '["Webhooks"]');
    // A public talent profile too, so platform search would list them if allowed.
    f.database.prepare("INSERT INTO studentProfile(id,userId,handle,status,publicName,bio) VALUES (?,?,?,'PUBLISHED',?,'Webhook builder')").run(userId, userId, userId, name);
    f.database.prepare("INSERT INTO programApplication(id,userId,programId,status,completedAt,application) VALUES (?,?,'cohort','COMPLETED',1,'{}')").run(`${userId}-completion`, userId);
    f.database.prepare("INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility) VALUES (?,?,'Webhook project','Webhook evidence','2026-10-31','institution')").run(`${userId}-journey`, userId);
  }
  // Drizzle (platform search's capability lookup) reads rows as arrays.
  return Object.assign(Object.create(f.db) as D1Database, { prepare(sql: string) {
    const statement = f.db.prepare(sql);
    const bind = statement.bind.bind(statement);
    statement.bind = (...values: unknown[]) => Object.assign(bind(...values), {
      async raw() { const native = f.database.prepare(sql); native.setReturnArrays(true); return native.all(...values as SQLInputValue[]); },
    });
    return statement;
  } });
}

function chatEnvironment(firstTurn?: { name: string; args: unknown }) {
  let turn = 0;
  const run = vi.fn(async () => {
    const call = turn++ === 0 && firstTurn
      ? { content: null, tool_calls: [{ id: "c", type: "function", function: { name: firstTurn.name, arguments: JSON.stringify(firstTurn.args) } }] }
      : { content: JSON.stringify({ answer: "Done", citations: [{ kind: "profile", id: "none", version: 0 }] }) };
    return Response.json({ choices: [{ message: { role: "assistant", ...call }, finish_reason: call.content ? "stop" : "tool_calls" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
  return { AI_GATEWAY_MODEL: "configured", AI_GATEWAY_NAME: "gateway", AI: { run } } as unknown as Env;
}
const profileIds = (sources: { kind: string; userId: string }[]) => [...new Set(sources.filter(s => s.kind === "profile").map(s => s.userId))];

function mcp(db: D1Database, caller: string, name: string, args: Record<string, unknown>) {
  const request = new Request("https://ttv.test/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  return handleCommunityMcp(request, { userId: caller, scopes: ["community:read", "institution:read"] }, createCommunityService(db, caller));
}
function rest(db: D1Database, caller: string, path: string, init?: RequestInit) {
  return handleCommunityRequest(new Request(`https://ttv.test/api/community/${path}`, init), path.split("?")[0], { id: caller, scopes: null }, db);
}

/** Deterministic stand-ins for the criteria model, embeddings and Clef. */
const discoveryDeps: DiscoveryDependencies = {
  get: async () => undefined,
  put: async () => {},
  run: async (model, input) => {
    if (model === COMMUNITY_NATIVE_MODEL) return { choices: [{ message: { content: JSON.stringify({ criteria: [{ text: "Webhooks", importance: "required" }] }) } }] };
    if (model.includes("bge")) return { data: (input.text as string[]).map(() => Array.from({ length: 768 }, () => 1)) };
    return { answers: { c0: { choice: "supported" } } };
  },
};

/** Each surface's list of the people it surfaced to the caller for "Webhook". */
const LIST_SURFACES: Record<string, (db: D1Database, caller: string) => Promise<string[]>> = {
  "REST search": async (db, caller) => {
    const body = await (await rest(db, caller, "profiles?query=webhook")).json() as { profiles: { userId: string }[] };
    return body.profiles.map(p => p.userId);
  },
  "REST Discover": async (db, caller) => {
    const result = await discoverProfiles(createCommunityService(db, caller), { context: "Webhooks", skills: "", query: "" }, discoveryDeps);
    return result.profiles.map(p => p.profile.userId);
  },
  "chat search tool": async (db, caller) => {
    const result = await runCommunityChat(chatEnvironment({ name: "search_profiles", args: { query: "webhook" } }), createCommunityService(db, caller), { message: "Who builds webhooks?" });
    expect(result.execution.toolNames).toEqual(["search_profiles"]);
    return profileIds(result.retrievedSources);
  },
  "MCP search_profiles": async (db, caller) => {
    const body = await (await mcp(db, caller, "search_profiles", { query: "webhook" })).json() as { result: { structuredContent: { result: { userId: string }[] } } };
    return body.result.structuredContent.result.map(p => p.userId);
  },
  "platform search": async (db, caller) => {
    const people = await searchPlatform(db, caller, { q: "Webhook", scope: "people" });
    const projects = await searchPlatform(db, caller, { q: "Webhook", scope: "projects" });
    // The caller's own shared work stays findable as their own, never as discovery.
    for (const own of projects.projects.filter(p => p.owner.id === caller)) expect(own.href).toBe("/dashboard/community");
    const discovered = projects.projects.filter(p => p.owner.id !== caller);
    for (const project of discovered) expect(project.href).toBe(`/dashboard/discover?profile=${project.owner.id}`);
    return [...new Set([...people.people.map(p => p.person.id), ...discovered.map(p => p.owner.id)])];
  },
};

/**
 * Each surface's by-id read, reduced to what the caller can observe. An
 * ineligible person must be indistinguishable from someone who never existed.
 */
const READ_SURFACES: Record<string, (db: D1Database, caller: string, target: string) => Promise<unknown>> = {
  "REST profile": async (db, caller, target) => {
    const response = await rest(db, caller, `profiles/${target}`);
    return response.ok ? "allowed" : { status: response.status, body: await response.text() };
  },
  "REST assessment": async (db, caller, target) => {
    const response = await rest(db, caller, `profiles/${target}/assessment`, { method: "POST", headers: { Origin: "https://ttv.test" },
      body: JSON.stringify({ id: "hiring", version: 1, criteria: [{ id: "hooks", label: "Webhook evidence", terms: ["webhook"] }] }) });
    return response.ok ? "allowed" : { status: response.status, body: await response.text() };
  },
  "chat selected profile": async (db, caller, target) => {
    try {
      const result = await runCommunityChat(chatEnvironment(), createCommunityService(db, caller), { message: "Summarise", profileId: target });
      expect(profileIds(result.retrievedSources)).toEqual([target]);
      return "allowed";
    } catch (error) { return { status: (error as { status?: number }).status, message: (error as Error).message }; }
  },
  "chat get_profile tool": async (db, caller, target) => {
    const result = await runCommunityChat(chatEnvironment({ name: "get_profile", args: { userId: target } }), createCommunityService(db, caller), { message: "Read them" });
    return profileIds(result.retrievedSources).includes(target) ? "allowed" : { retrievedSources: result.retrievedSources };
  },
  ...Object.fromEntries(["get_profile", "list_journey", "assess_profile"].map(tool => [`MCP ${tool}`, async (db: D1Database, caller: string, target: string) => {
    const args = tool === "assess_profile"
      ? { userId: target, rubric: { id: "hiring", version: 1, criteria: [{ id: "hooks", label: "Webhook evidence", terms: ["webhook"] }] } }
      : { userId: target };
    const body = await (await mcp(db, caller, tool, args)).json() as { result: { isError?: boolean } };
    return body.result.isError ? body : "allowed";
  }])),
};

const CALLERS: { caller: Person; listed: Person[] }[] = [
  // Lucy has no saved profile, David is a mentor, Amina an admin, Joseph the caller.
  // Kevin also holds the institution role, and stays discoverable.
  { caller: "joseph", listed: ["achieng", "kevin"] },
  // The mixed-role rule from the other side: Joseph is discoverable to Kevin.
  { caller: "kevin", listed: ["achieng", "joseph"] },
];

describe.each(Object.entries(LIST_SURFACES))("%s lists only discoverable members", (_surface, list) => {
  it.each(CALLERS)("as $caller", async ({ caller, listed }) => {
    const db = world();
    expect((await list(db, id(caller))).toSorted()).toEqual(listed.map(id).toSorted());
  });
});

describe.each(Object.entries(READ_SURFACES))("%s fails closed for ineligible people", (_surface, read) => {
  it.each(EVERYONE.filter(person => person !== "joseph"))("reading %s as joseph", async target => {
    const db = world();
    const observed = await read(db, id("joseph"), id(target));
    if (CALLERS[0].listed.includes(target)) expect(observed).toBe("allowed");
    // No existence oracle: the same answer as for an id that never existed.
    else expect(observed).toEqual(await read(db, id("joseph"), GHOST));
  });
});

describe("discoverableMember", () => {
  it("binds the caller and refuses anything but a qualified column", () => {
    expect(discoverableMember("u.id", "caller")).toMatchObject({ values: ["caller"] });
    for (const column of ["id", "u.id;--", "u.id OR 1", "(select 1).id", ""]) expect(() => discoverableMember(column, "caller")).toThrow("qualified column name");
  });
  it("treats a saved profile with empty fields as saved", async () => {
    const db = world();
    // Lucy saves an empty profile: she becomes discoverable on every surface.
    await createCommunityService(db, id("lucy")).updateOwnProfile({ headline: "", bio: "", skills: [], opportunityGoals: "" });
    const service = createCommunityService(db, id("joseph"));
    expect(await service.getProfile(id("lucy"))).toMatchObject({ userId: id("lucy"), version: 1 });
    expect((await service.searchProfiles({ query: "lucy" })).map(p => p.userId)).toEqual([id("lucy")]);
  });
  it("still lets everyone read their own profile without saving one", async () => {
    const db = world();
    expect(await createCommunityService(db, id("lucy")).getProfile(id("lucy"))).toMatchObject({ userId: id("lucy"), version: 0 });
    expect(await createCommunityService(db, id("lucy")).listJourney(id("lucy"))).toHaveLength(1);
  });
  it("keeps non-institution callers out before any eligibility lookup", async () => {
    const db = world();
    await expect(createCommunityService(db, id("achieng")).getProfile(id("kevin"))).rejects.toMatchObject({ status: 403 });
    await expect(createCommunityService(db, id("achieng")).getProfile(GHOST)).rejects.toMatchObject({ status: 403 });
  });
  it.each(["achieng", "amina"] as const)("leaves the public talent directory unchanged for %s", async caller => {
    const db = world();
    const people = await searchPlatform(db, id(caller), { q: "Webhook", scope: "people" });
    expect(people.people.map(p => p.person.id).toSorted()).toEqual(EVERYONE.map(id).toSorted());
  });
  it("shows admins only discoverable owners' shared projects", async () => {
    const db = world();
    const { projects } = await searchPlatform(db, id("amina"), { q: "Webhook", scope: "projects" });
    expect(projects.map(p => p.owner.id).toSorted()).toEqual(["achieng", "joseph", "kevin"].map(person => id(person as Person)).toSorted());
  });
});
