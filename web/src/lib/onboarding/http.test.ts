import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ recordErrorInBackground: vi.fn() }));
vi.mock("@/lib/observability/errors", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/observability/errors")>(),
  recordErrorInBackground: mocks.recordErrorInBackground,
}));

import { attentionRequest } from "@/lib/attention/http";
import { withRaw } from "@/lib/attention/test-support";
import {
  AdminAccessRequest, AdminAccessRequestList, AttentionList, ErrorEnvelope, OnboardingState, ROUTES,
  type CreateAccessRequest, type FlagAudience,
} from "@/lib/platform/contracts";
import { AGENT_SESSION_PREFIX } from "@/lib/agent-auth";
import { ACCESS_REQUEST_DAILY_LIMIT } from "./service";
import { adminAccessRequest, onboardingRequest, type AdminOperation, type RequesterOperation } from "./http";
import { onboardingDatabase } from "./test-support";

const ORIGIN = "https://ttv.example";
const mentor: CreateAccessRequest = { role: "MENTOR", note: "I review mobile apps and API designs for junior developers.", link: null };
const institution: CreateAccessRequest = {
  role: "INSTITUTION", note: "We want to find junior mobile developers for paid internships.",
  organisation: "Savanna Mobile Labs", organisationRole: null, link: null, scopeAcknowledged: true,
};

interface Caller {
  userId?: string | null;
  isAdmin?: boolean;
  pat?: string[];
  agent?: boolean;
}
interface Call extends Caller {
  id?: string;
  body?: unknown;
  query?: string;
  origin?: string | null;
}

const setups: { database: { close(): void } }[] = [];
function setup({ spaces = "ALL", onboarding = "ALL" }: { spaces?: FlagAudience; onboarding?: FlagAudience } = {}) {
  const fixture = onboardingDatabase();
  fixture.grant("amina", "ADMIN");
  fixture.database.prepare("UPDATE feature_flag SET audience = ? WHERE key = 'spaces'").run(spaces);
  fixture.database.prepare("UPDATE feature_flag SET audience = ? WHERE key = 'onboarding'").run(onboarding);
  const env = { DB: fixture.db, DEPLOYMENT_ENVIRONMENT: "production" };

  function context(operation: RequesterOperation | AdminOperation, call: Call) {
    const route = ROUTES[operation];
    const path = route.path.replace(":id", encodeURIComponent(call.id ?? ""));
    const headers = new Headers();
    const origin = call.origin === undefined ? ORIGIN : call.origin;
    if (origin) headers.set("Origin", origin);
    const init: RequestInit = { method: route.method, headers };
    if (route.method !== "GET") init.body = JSON.stringify(call.body ?? {});
    const userId = call.userId === undefined ? "wairimu" : call.userId;
    const locals = {
      user: userId ? { id: userId } : null,
      session: userId ? { id: "session", userAgent: call.agent ? `${AGENT_SESSION_PREFIX}synthetic` : "Mozilla/5.0" } : null,
      personalAccessToken: call.pat ? { id: "synthetic-pat", scopes: call.pat } : null,
      isAdmin: call.isAdmin ?? false,
      cfContext: undefined,
    } as unknown as App.Locals;
    return { request: new Request(`${ORIGIN}${path}${call.query ?? ""}`, init), locals, params: call.id === undefined ? {} : { id: call.id } };
  }
  const requester = (operation: RequesterOperation, call: Call = {}) => onboardingRequest(operation, context(operation, call), env);
  const admin = (operation: AdminOperation, call: Call = {}) =>
    adminAccessRequest(operation, context(operation, { userId: "amina", isAdmin: true, ...call }), env);
  const attention = async (userId: string) => {
    const ctx = context("getOnboarding", { userId });
    const response = await attentionRequest("list", { request: new Request(`${ORIGIN}/api/attention`), locals: ctx.locals },
      { ...env, DB: withRaw(fixture.database, fixture.db) });
    return AttentionList.parse(await response.json()).items;
  };
  const value = { ...fixture, env, requester, admin, attention };
  setups.push(value);
  return value;
}
afterEach(() => { setups.splice(0).forEach((fixture) => fixture.database.close()); vi.clearAllMocks(); });

async function errorOf(response: Response) {
  return ErrorEnvelope.parse(await response.json()).error;
}
async function stateOf(response: Response) {
  return OnboardingState.parse(await response.json());
}
async function requestFor(s: ReturnType<typeof setup>, body: CreateAccessRequest = mentor, userId = "wairimu") {
  const state = await stateOf(await s.requester("createAccessRequest", { body, userId }));
  const request = state.requests.find((candidate) => candidate.role === body.role);
  if (!request) throw new Error("No request was created");
  return request.id;
}

const REQUESTER_CALLS: [RequesterOperation, Call][] = [
  ["getOnboarding", {}],
  ["updateOnboarding", { body: { intents: ["MEMBER"] } }],
  ["createAccessRequest", { body: mentor }],
  ["withdrawAccessRequest", { id: "request" }],
  ["dismissAccessRequest", { id: "request" }],
];
const ADMIN_CALLS: [AdminOperation, Call][] = [
  ["listAccessRequests", {}],
  ["decideAccessRequest", { id: "request", body: { decision: "approve" } }],
];

describe("requester routes: gates", () => {
  it.each(REQUESTER_CALLS)("%s returns 404 while onboarding is off, or while spaces is", async (operation, call) => {
    for (const flags of [{ onboarding: "OFF" }, { onboarding: "STAFF" }, { spaces: "OFF" }] as const) {
      const s = setup(flags);
      const response = await s.requester(operation, call);
      expect(response.status).toBe(404);
      expect(await errorOf(response)).toMatchObject({ code: "flag_off" });
      expect(s.rows("SELECT * FROM access_request")).toEqual([]);
    }
  });

  it.each(REQUESTER_CALLS)("%s returns 404 to a signed-out caller", async (operation, call) => {
    expect((await setup().requester(operation, { ...call, userId: null })).status).toBe(404);
  });

  it.each(REQUESTER_CALLS)("%s refuses personal access tokens and agent sessions, whatever their scopes", async (operation, call) => {
    const s = setup();
    for (const caller of [{ pat: ["community:write"] }, { pat: ["admin:read", "admin:write"] }, { agent: true }]) {
      const response = await s.requester(operation, { ...call, ...caller });
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toMatchObject({ code: "forbidden" });
    }
    expect(s.rows("SELECT * FROM access_request")).toEqual([]);
    expect(s.rows("SELECT * FROM member_intent")).toEqual([]);
  });

  it.each(REQUESTER_CALLS.filter(([operation]) => operation !== "getOnboarding"))(
    "%s requires a same-origin write", async (operation, call) => {
      const s = setup();
      for (const origin of [null, "https://evil.example", `${ORIGIN}/path`]) {
        const response = await s.requester(operation, { ...call, origin });
        expect(response.status).toBe(403);
      }
      expect(s.rows("SELECT * FROM member_onboarding")).toEqual([]);
    });

  it("opens with the non-production override even while the flag rows are OFF", async () => {
    const s = setup({ spaces: "OFF", onboarding: "OFF" });
    const response = await onboardingRequest("getOnboarding", {
      request: new Request(`${ORIGIN}/api/platform/onboarding`),
      locals: { user: { id: "wairimu" }, session: { userAgent: "Mozilla/5.0" }, personalAccessToken: null } as unknown as App.Locals,
      params: {},
    }, { ...s.env, DEPLOYMENT_ENVIRONMENT: "agent-pr-264", PLATFORM_FLAGS_OVERRIDE: "all" });
    expect(response.status).toBe(200);
  });
});

describe("requester routes: behaviour", () => {
  it("reads and saves intents without granting anything", async () => {
    const s = setup();
    expect(await stateOf(await s.requester("getOnboarding"))).toEqual({ stage: "PROMPT", intents: [], inferred: [], requests: [], roles: [] });
    const saved = await stateOf(await s.requester("updateOnboarding", { body: { intents: ["MENTOR", "INSTITUTION"] } }));
    expect(saved).toMatchObject({ stage: "DONE", intents: ["MENTOR", "INSTITUTION"], roles: [] });
    expect(s.rows("SELECT * FROM UserRoles WHERE userId = 'wairimu'")).toEqual([]);

    const dismissed = await stateOf(await s.requester("updateOnboarding", { userId: "otieno", body: { dismissPrompt: true } }));
    expect(dismissed).toMatchObject({ stage: "DONE", intents: [] });
  });

  it.each([
    [{ intents: ["EXPLORING", "MEMBER"] }],
    [{ intents: ["ADMIN"] }],
    [{ dismissPrompt: false }],
    [{ intents: ["MEMBER"], dismissPrompt: true }],
    ["not an object"],
  ])("refuses an invalid onboarding update %j", async (body) => {
    const s = setup();
    const response = await s.requester("updateOnboarding", { body });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatchObject({ code: "validation" });
    expect(s.rows("SELECT * FROM member_intent")).toEqual([]);
  });

  it("creates a request (201), tells every other administrator, and copies no request text into attention", async () => {
    const s = setup();
    s.grant("otieno", "ADMIN");
    s.grant("wairimu", "ADMIN");
    const response = await s.requester("createAccessRequest", { body: institution, userId: "wairimu" });
    expect(response.status).toBe(201);
    const state = await stateOf(response);
    expect(state.requests).toMatchObject([{ role: "INSTITUTION", status: "PENDING", organisation: "Savanna Mobile Labs" }]);
    expect(s.rows("SELECT * FROM UserRoles ur JOIN Roles r ON r.id = ur.roleId WHERE ur.userId = 'wairimu' AND r.name <> 'ADMIN'")).toEqual([]);

    const items = s.rows("SELECT userId, kind, space, category, actorId, eventKey, subjectHref, summary FROM attention_item ORDER BY userId");
    expect(items).toEqual(["amina", "otieno"].map((userId) => ({
      userId, kind: "access_request", space: "admin", category: "requests", actorId: "wairimu",
      eventKey: JSON.stringify(["access_request", state.requests[0].id]), subjectHref: "/admin/access-requests",
      summary: "New institution access request.",
    })));
    expect(JSON.stringify(s.rows("SELECT * FROM attention_item"))).not.toMatch(/Savanna|junior mobile/);
  });

  it.each([
    [{ ...mentor, note: "Too short." }, "Write at least 20 characters"],
    [{ ...mentor, link: "ftp://example.com/work" }, undefined],
    [{ ...institution, scopeAcknowledged: false }, undefined],
    [{ role: "ADMIN", note: mentor.note, link: null }, undefined],
    [{ ...mentor, decidedBy: "amina" }, undefined],
  ])("refuses an invalid request %#", async (body, message) => {
    const s = setup();
    const response = await s.requester("createAccessRequest", { body });
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe("validation");
    if (message) expect(error.message).toBe(message);
    expect(s.rows("SELECT * FROM access_request")).toEqual([]);
  });

  it("answers a duplicate with 409 and the daily limit with 429 and a retry time", async () => {
    const s = setup();
    await requestFor(s);
    const duplicate = await s.requester("createAccessRequest", { body: mentor });
    expect(duplicate.status).toBe(409);
    expect(await errorOf(duplicate)).toMatchObject({ code: "conflict" });

    for (let i = 1; i < ACCESS_REQUEST_DAILY_LIMIT; i++) {
      const [{ id }] = s.rows("SELECT id FROM access_request WHERE status = 'PENDING'") as { id: string }[];
      expect((await s.requester("withdrawAccessRequest", { id })).status).toBe(200);
      await requestFor(s);
    }
    const [{ id }] = s.rows("SELECT id FROM access_request WHERE status = 'PENDING'") as { id: string }[];
    await s.requester("withdrawAccessRequest", { id });
    const limited = await s.requester("createAccessRequest", { body: mentor });
    expect(limited.status).toBe(429);
    const error = await errorOf(limited);
    expect(error).toMatchObject({ code: "rate_limited" });
    expect(error.retryAfterMs).toBeGreaterThan(0);
    expect(Number(limited.headers.get("Retry-After"))).toBe(Math.ceil((error.retryAfterMs ?? 0) / 1000));
  });

  it("withdraws only the caller's own pending request", async () => {
    const s = setup();
    const id = await requestFor(s);
    const foreign = await s.requester("withdrawAccessRequest", { id, userId: "otieno" });
    expect(foreign.status).toBe(404);
    expect(await errorOf(foreign)).toMatchObject({ code: "not_found" });

    const withdrawn = await stateOf(await s.requester("withdrawAccessRequest", { id }));
    expect(withdrawn.requests).toMatchObject([{ id, status: "WITHDRAWN" }]);
    expect((await s.requester("withdrawAccessRequest", { id })).status).toBe(409);
    expect((await s.requester("withdrawAccessRequest", { id: "missing" })).status).toBe(404);
    expect((await s.requester("withdrawAccessRequest", { id, body: { reason: "x" } })).status).toBe(400);
  });

  it("dismisses only a decided request", async () => {
    const s = setup();
    const id = await requestFor(s);
    expect((await s.requester("dismissAccessRequest", { id })).status).toBe(409);
    await s.admin("decideAccessRequest", { id, body: { decision: "decline" } });
    const dismissed = await stateOf(await s.requester("dismissAccessRequest", { id }));
    expect(dismissed.requests[0].seenAt).toEqual(expect.any(Number));
    expect((await s.requester("dismissAccessRequest", { id })).status).toBe(200);
    expect((await s.requester("dismissAccessRequest", { id, userId: "otieno" })).status).toBe(404);
  });

  it("reports unexpected failures as 500 without detail, and records them", async () => {
    const s = setup();
    s.database.exec("DROP TABLE member_intent");
    const response = await s.requester("getOnboarding");
    expect(response.status).toBe(500);
    expect(await errorOf(response)).toEqual({ code: "server", message: "Could not complete the access request." });
    expect(mocks.recordErrorInBackground).toHaveBeenCalledWith(undefined, s.db, expect.objectContaining({ route: "/api/platform/onboarding" }));
  });
});

describe("admin routes: gates", () => {
  it.each(ADMIN_CALLS)("%s refuses non-admins and signed-out callers", async (operation, call) => {
    const s = setup();
    for (const caller of [{ userId: "wairimu", isAdmin: false }, { userId: null, isAdmin: true }]) {
      const response = await s.admin(operation, { ...call, ...caller });
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toMatchObject({ code: "forbidden" });
    }
  });

  it.each(ADMIN_CALLS)("%s refuses an administrator's personal access token and agent session", async (operation, call) => {
    const s = setup();
    const id = await requestFor(s);
    for (const caller of [{ pat: ["admin:read"] }, { pat: ["admin:read", "admin:write"] }, { agent: true }]) {
      const response = await s.admin(operation, { ...call, id: call.id && id, ...caller });
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toMatchObject({ code: "forbidden" });
    }
    expect(s.rows("SELECT status FROM access_request")).toEqual([{ status: "PENDING" }]);
  });

  it("stays reachable while onboarding and spaces are off, so pending requests are never stranded", async () => {
    const s = setup();
    const id = await requestFor(s);
    s.database.exec("UPDATE feature_flag SET audience = 'OFF'");
    expect((await s.requester("getOnboarding")).status).toBe(404);
    const list = AdminAccessRequestList.parse(await (await s.admin("listAccessRequests")).json());
    expect(list.items.map((item) => item.id)).toEqual([id]);
    expect((await s.admin("decideAccessRequest", { id, body: { decision: "approve" } })).status).toBe(200);
  });

  it("requires a same-origin decision", async () => {
    const s = setup();
    const id = await requestFor(s);
    for (const origin of [null, "https://evil.example"]) {
      expect((await s.admin("decideAccessRequest", { id, body: { decision: "approve" }, origin })).status).toBe(403);
    }
    expect(s.rows("SELECT status FROM access_request")).toEqual([{ status: "PENDING" }]);
  });
});

describe("admin routes: behaviour", () => {
  it("lists the queue and validates the query", async () => {
    const s = setup();
    const id = await requestFor(s);
    const list = AdminAccessRequestList.parse(await (await s.admin("listAccessRequests", { query: "?status=PENDING" })).json());
    expect(list).toMatchObject({ pendingCount: 1, nextCursor: null, items: [{ id, requester: { id: "wairimu" } }] });
    for (const query of ["?status=pending", "?status=PENDING&status=DECIDED", "?cursor=nonsense", "?other=1"]) {
      const response = await s.admin("listAccessRequests", { query });
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toMatchObject({ code: "validation" });
    }
  });

  it("approves once: the role appears, the second approval is a conflict, a missing request is 404", async () => {
    const s = setup();
    const id = await requestFor(s);
    const response = await s.admin("decideAccessRequest", { id, body: { decision: "approve", message: "Welcome." } });
    expect(response.status).toBe(200);
    expect(AdminAccessRequest.parse(await response.json())).toMatchObject({ id, status: "APPROVED", decidedBy: { id: "amina" } });
    expect((await stateOf(await s.requester("getOnboarding"))).roles).toEqual(["MENTOR"]);

    const again = await s.admin("decideAccessRequest", { id, body: { decision: "decline" } });
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toMatchObject({ code: "conflict" });
    expect((await s.admin("decideAccessRequest", { id: "missing", body: { decision: "approve" } })).status).toBe(404);
  });

  it.each([
    [{ decision: "maybe" }],
    [{ decision: "approve", message: "" }],
    [{ decision: "approve", message: "x".repeat(601) }],
    [{ decision: "approve", grantedBy: "amina" }],
  ])("refuses an invalid decision %j", async (body) => {
    const s = setup();
    const id = await requestFor(s);
    expect((await s.admin("decideAccessRequest", { id, body })).status).toBe(400);
    expect(s.rows("SELECT status FROM access_request")).toEqual([{ status: "PENDING" }]);
  });

  it("moves the request through attention: admins see it while pending, the requester sees an actor-less decision", async () => {
    const s = setup();
    const id = await requestFor(s);
    expect(await s.attention("amina")).toMatchObject([{ kind: "access_request", actor: { id: "wairimu" }, subject: { id } }]);
    expect(await s.attention("wairimu")).toEqual([]);

    await s.admin("decideAccessRequest", { id, body: { decision: "decline", message: "Not this time." } });
    expect(await s.attention("amina")).toEqual([]);
    const [decided] = await s.attention("wairimu");
    expect(decided).toMatchObject({ kind: "access_decided", space: "community", actor: null, subject: { kind: "accessRequest", id } });
    expect(JSON.stringify(decided)).not.toMatch(/amina|Amina/);
    // Another person never sees it, even holding the row.
    s.database.exec("UPDATE attention_item SET userId = 'otieno' WHERE kind = 'access_decided'");
    expect(await s.attention("otieno")).toEqual([]);
  });

  it("drops a withdrawn request from every administrator's attention", async () => {
    const s = setup();
    const id = await requestFor(s);
    await s.requester("withdrawAccessRequest", { id });
    expect(await s.attention("amina")).toEqual([]);
  });
});
