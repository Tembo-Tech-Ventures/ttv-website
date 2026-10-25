import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticatePersonalAccessToken: vi.fn(),
  createAuth: vi.fn(),
  authenticateQaCookie: vi.fn(),
  logoutQa: vi.fn(),
  enforcePersonalAccessTokenMutationScope: vi.fn(),
  getSession: vi.fn(),
  hasPersonalAccessTokenAuthorization: vi.fn(),
  recordError: vi.fn().mockResolvedValue(null),
  recordErrorInBackground: vi.fn(),
  roleFirst: vi.fn(),
}));

vi.mock("astro:middleware", () => ({
  defineMiddleware: (handler: unknown) => handler,
}));
vi.mock("cloudflare:workers", () => ({
  env: {
    DEPLOYMENT_VERSION: "test-version",
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ first: mocks.roleFirst })),
      })),
    },
  },
}));
vi.mock("@/lib/auth", () => ({ createAuth: mocks.createAuth }));
vi.mock("@/lib/staging-qa-access", async importOriginal => ({...(await importOriginal<typeof import("@/lib/staging-qa-access")>()),authenticateQaCookie:mocks.authenticateQaCookie,logoutQa:mocks.logoutQa}));
vi.mock("@/lib/observability/errors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/errors")>()),
  recordError: mocks.recordError,
  recordErrorInBackground: mocks.recordErrorInBackground,
}));
vi.mock("@/lib/personal-access-tokens", () => ({
  authenticatePersonalAccessToken: mocks.authenticatePersonalAccessToken,
  enforcePersonalAccessTokenMutationScope:
    mocks.enforcePersonalAccessTokenMutationScope,
  hasPersonalAccessTokenAuthorization:
    mocks.hasPersonalAccessTokenAuthorization,
}));

import { env } from "cloudflare:workers";
import { onRequest } from "./middleware";

function createContext(request: Request) {
  const waitUntil = vi.fn();
  const redirect = vi.fn((location: string, status = 302) =>
    new Response(null, { status, headers: { location } })
  );
  return {
    context: {
      locals: { cfContext: { waitUntil } },
      request,
      url: new URL(request.url),
      redirect,
    },
    redirect,
    waitUntil,
    next: vi.fn().mockResolvedValue(new Response("ok")),
  };
}

function requireResponse(value: Response | void): Response {
  expect(value).toBeInstanceOf(Response);
  if (!(value instanceof Response)) throw new Error("Expected middleware response");
  return value;
}

const tokenSummary = {
  id: "pat-id",
  tokenPrefix: "ttv_pat_12345678…",
  label: "SAM verifier",
  scopes: ["admin:read"] as const,
  expiresAt: new Date("2026-08-14T00:00:00.000Z"),
  lastUsedAt: null,
  revokedAt: null,
  createdAt: new Date("2026-08-13T00:00:00.000Z"),
};

const tokenAuth = {
  token: tokenSummary,
  session: {
    id: "pat:pat-id",
    expiresAt: tokenSummary.expiresAt,
    token: "[personal-access-token]",
    ipAddress: null,
    userAgent: "ttv-pat:pat-id",
    userId: "admin-id",
    createdAt: tokenSummary.createdAt,
    updatedAt: tokenSummary.createdAt,
  },
  user: {
    id: "admin-id",
    name: "Admin",
    email: "admin@example.com",
    emailVerified: true,
    image: null,
    createdAt: tokenSummary.createdAt,
    updatedAt: tokenSummary.createdAt,
  },
};

beforeEach(() => {
  (env as {DEPLOYMENT_ENVIRONMENT?:string}).DEPLOYMENT_ENVIRONMENT = undefined;
  vi.clearAllMocks();
  mocks.hasPersonalAccessTokenAuthorization.mockReturnValue(false);
  mocks.authenticatePersonalAccessToken.mockResolvedValue(null);
  mocks.enforcePersonalAccessTokenMutationScope.mockReturnValue(null);
  mocks.roleFirst.mockResolvedValue({ id: "admin-role" });
  mocks.getSession.mockResolvedValue(null);
  mocks.createAuth.mockReturnValue({
    api: {
      getSession: mocks.getSession,
    },
  });
});

describe("dashboard authentication", () => {
  it("preserves the requested dashboard path for sign-in", async () => {
    const { context, redirect, next } = createContext(
      new Request("https://example.com/dashboard/apply")
    );

    await onRequest(context as never, next);

    expect(redirect).toHaveBeenCalledWith(
      "/auth/login?next=%2Fdashboard%2Fapply"
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe("personal access token middleware", () => {
  it.each(["/dashboard", "/api/recordings/private", "/api/mcp/private", "/api/community-other", "/auth/get-session"])("restricts community PATs from unrelated route %s", async pathname => {
    mocks.hasPersonalAccessTokenAuthorization.mockReturnValue(true);
    mocks.authenticatePersonalAccessToken.mockResolvedValue({ ...tokenAuth, token: { ...tokenSummary, scopes: ["community:read"] } });
    const { context, next } = createContext(new Request(`https://example.com${pathname}`));
    const response = requireResponse(await onRequest(context as never, next));
    expect(response.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
  it.each(["/api/mcp", "/api/community/profile"])("allows scoped community API %s", async pathname => {
    mocks.hasPersonalAccessTokenAuthorization.mockReturnValue(true);
    mocks.authenticatePersonalAccessToken.mockResolvedValue({ ...tokenAuth, token: { ...tokenSummary, scopes: ["community:read"] } });
    const { context, next } = createContext(new Request(`https://example.com${pathname}`));
    const response = requireResponse(await onRequest(context as never, next));
    expect(response.status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
  });

  it("uses a valid PAT as the request identity and keeps its secret out of locals", async () => {
    mocks.hasPersonalAccessTokenAuthorization.mockReturnValue(true);
    mocks.authenticatePersonalAccessToken.mockResolvedValue(tokenAuth);
    const { context, next } = createContext(
      new Request("https://example.com/admin/recordings", {
        headers: { authorization: `Bearer ttv_pat_${"1".repeat(64)}` },
      })
    );

    const response = requireResponse(await onRequest(context as never, next));

    expect(response.status).toBe(200);
    expect(context.locals).toMatchObject({
      user: { id: "admin-id" },
      session: { token: "[personal-access-token]" },
      personalAccessToken: { id: "pat-id" },
      isAdmin: true,
    });
    expect(mocks.createAuth).not.toHaveBeenCalled();
    expect(JSON.stringify(context.locals)).not.toContain(`ttv_pat_${"1".repeat(64)}`);
  });

  it("fails an invalid explicit PAT without falling back to a browser cookie", async () => {
    mocks.hasPersonalAccessTokenAuthorization.mockReturnValue(true);
    const { context, redirect, next } = createContext(
      new Request("https://example.com/admin/recordings", {
        headers: {
          authorization: "Bearer ttv_pat_invalid",
          cookie: "better-auth.session_token=valid-browser-cookie",
        },
      })
    );

    await onRequest(context as never, next);

    expect(mocks.createAuth).not.toHaveBeenCalled();
    expect(context.locals).toMatchObject({
      user: null,
      session: null,
      personalAccessToken: null,
    });
    expect(redirect).toHaveBeenCalledWith("/auth/login");
  });

  it("prevents a PAT from minting or revoking credentials", async () => {
    mocks.hasPersonalAccessTokenAuthorization.mockReturnValue(true);
    mocks.authenticatePersonalAccessToken.mockResolvedValue(tokenAuth);
    const { context, next } = createContext(
      new Request("https://example.com/admin/personal-access-tokens", {
        headers: { authorization: `Bearer ttv_pat_${"1".repeat(64)}` },
      })
    );

    const response = requireResponse(await onRequest(context as never, next));

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toContain(
      "cannot manage personal access tokens"
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("prevents a delegated agent session from minting a longer-lived PAT", async () => {
    mocks.getSession.mockResolvedValue({
      session: {
        ...tokenAuth.session,
        id: "agent-session",
        token: "[agent-session]",
        userAgent: "ttv-agent:SAM staging verifier",
      },
      user: tokenAuth.user,
    });
    const { context, next } = createContext(
      new Request("https://example.com/admin/personal-access-tokens")
    );

    const response = requireResponse(await onRequest(context as never, next));

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toContain("delegated credentials");
    expect(next).not.toHaveBeenCalled();
  });

  it("allows a normal browser session to manage its own PATs", async () => {
    mocks.getSession.mockResolvedValue({
      session: {
        ...tokenAuth.session,
        id: "browser-session",
        token: "[browser-session]",
        userAgent: "Mozilla/5.0",
      },
      user: tokenAuth.user,
    });
    const { context, next } = createContext(
      new Request("https://example.com/admin/personal-access-tokens")
    );

    const response = requireResponse(await onRequest(context as never, next));

    expect(response.status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects community-only PATs from admin reads even for a current admin", async () => {
    mocks.hasPersonalAccessTokenAuthorization.mockReturnValue(true);
    mocks.authenticatePersonalAccessToken.mockResolvedValue({ ...tokenAuth, token: { ...tokenAuth.token, scopes: ["community:read"] } });
    const { context, next } = createContext(new Request("https://example.com/api/admin/recordings"));
    const response = requireResponse(await onRequest(context as never, next));
    expect(response.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns the scope failure before the origin guard for a PAT mutation", async () => {
    mocks.hasPersonalAccessTokenAuthorization.mockReturnValue(true);
    mocks.authenticatePersonalAccessToken.mockResolvedValue(tokenAuth);
    mocks.enforcePersonalAccessTokenMutationScope.mockReturnValue(
      new Response("scope denied", { status: 403 })
    );
    const { context, next } = createContext(
      new Request("https://example.com/api/admin/recordings/process", {
        method: "POST",
        headers: { authorization: `Bearer ttv_pat_${"1".repeat(64)}` },
      })
    );

    const response = requireResponse(await onRequest(context as never, next));

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("scope denied");
    expect(next).not.toHaveBeenCalled();
  });
});

describe("request error capture", () => {
  it("returns the unchanged response when the downstream request succeeds", async () => {
    const { context, next } = createContext(
      new Request("https://example.com/api/projects/123")
    );
    const expected = new Response("downstream", { status: 201 });
    next.mockResolvedValue(expected);

    await expect(onRequest(context as never, next)).resolves.toBe(expected);
    expect(mocks.recordErrorInBackground).not.toHaveBeenCalled();
  });

  it("records a collapsed route in the execution context and rethrows", async () => {
    const { context, next, waitUntil } = createContext(
      new Request("https://example.com/api/projects/123?token=private")
    );
    const failure = new Error("downstream failed");
    next.mockRejectedValue(failure);

    await expect(onRequest(context as never, next)).rejects.toBe(failure);
    expect(mocks.recordErrorInBackground).toHaveBeenCalledWith(
      context.locals.cfContext,
      expect.anything(),
      {
        source: "request",
        route: "/api/projects/:id",
        error: failure,
        version: "test-version",
      }
    );
    expect(context.locals.cfContext.waitUntil).toBe(waitUntil);
  });

  it("captures authentication failures that happen before page rendering", async () => {
    const { context, next } = createContext(
      new Request("https://example.com/talent/some-builder")
    );
    const failure = new Error("authentication lookup failed");
    mocks.getSession.mockRejectedValue(failure);

    await expect(onRequest(context as never, next)).rejects.toBe(failure);
    expect(mocks.recordErrorInBackground).toHaveBeenCalledWith(
      context.locals.cfContext,
      expect.anything(),
      {
        source: "request",
        route: "/talent/some-builder",
        error: failure,
        version: "test-version",
      }
    );
  });

  it("captures a server failure returned as a response", async () => {
    const { context, next } = createContext(
      new Request("https://example.com/talent/some-builder")
    );
    next.mockResolvedValue(new Response("failed", { status: 500 }));

    const response = requireResponse(await onRequest(context as never, next));

    expect(response.status).toBe(500);
    expect(mocks.recordErrorInBackground).toHaveBeenCalledWith(
      context.locals.cfContext,
      expect.anything(),
      {
        source: "request",
        route: "/talent/some-builder",
        error: expect.objectContaining({
          message: "Request completed with HTTP 500",
        }),
        version: "test-version",
      }
    );
  });
});

describe("synthetic staging middleware boundary", () => {
  const runId = "a".repeat(24);
  const userId = `ttv-staging-fixture-${runId}-mentor`;
  function setup() {
    const now = Math.floor(Date.now()/1000);
    (env as {DEPLOYMENT_ENVIRONMENT?:string}).DEPLOYMENT_ENVIRONMENT="staging";
    const marker = `ttv-agent:synthetic-staging:${runId}`;
    mocks.getSession.mockResolvedValue({user:{...tokenAuth.user,id:userId,email:`${userId}@invalid.ttv`},session:{...tokenAuth.session,id:"fixture-session",userAgent:marker}});
    mocks.roleFirst.mockResolvedValue({userId,sessionId:"fixture-session",runId,persona:"mentor",expiresAt:now+1800,email:`${userId}@invalid.ttv`,sessionUserId:userId,sessionUserAgent:marker,sessionCreatedAt:now-10,sessionExpiresAt:now+7*86400});
  }
  it("passes a registered fixture only to the bounded community surface", async () => {
    setup();const {context,next}=createContext(new Request("https://ttv.test/api/community/mentorship"));
    const res=requireResponse(await onRequest(context as never,next));
    expect(res.status).toBe(200);expect(context.locals).toMatchObject({stagingFixture:{runId,persona:"mentor"}});
  });
  it.each(["/admin/agent-access","/api/admin/users","/api/recordings/private","/dashboard/portfolio"])("blocks unrelated synthetic surface %s",async path=>{
    setup();const {context,next}=createContext(new Request(`https://ttv.test${path}`));
    expect(requireResponse(await onRequest(context as never,next)).status).toBe(403);expect(next).not.toHaveBeenCalled();
  });
  it("rejects fixture authentication in production before role checks",async()=>{
    setup();(env as {DEPLOYMENT_ENVIRONMENT?:string}).DEPLOYMENT_ENVIRONMENT="production";
    const {context,next}=createContext(new Request("https://ttv.test/api/community/profile"));
    expect(requireResponse(await onRequest(context as never,next)).status).toBe(403);expect(next).not.toHaveBeenCalled();expect(mocks.roleFirst).not.toHaveBeenCalled();
  });
  it("rejects cached authentication after registry expiration",async()=>{
    setup();const row=await mocks.roleFirst();mocks.roleFirst.mockResolvedValue({...row,expiresAt:Math.floor(Date.now()/1000)-1});
    const {context,next}=createContext(new Request("https://ttv.test/api/community/profile"));
    expect(requireResponse(await onRequest(context as never,next)).status).toBe(403);expect(next).not.toHaveBeenCalled();
  });
});

it("allows only the retained probe GET discovery shell, never unrelated pages or mutations",async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-25T09:30:00Z'));
 const stagingEnv=env as unknown as {DEPLOYMENT_ENVIRONMENT?:string;STAGING_RETAINED_READ_PROBE_ENABLED?:string};
 try{
  stagingEnv.DEPLOYMENT_ENVIRONMENT='staging';stagingEnv.STAGING_RETAINED_READ_PROBE_ENABLED='true';
  const runId='a'.repeat(24),userId=`ttv-staging-fixture-${runId}-institution`,now=Math.floor(Date.now()/1000),marker=`ttv-agent:synthetic-staging:${runId}:retained-read:READY`;
  mocks.hasPersonalAccessTokenAuthorization.mockReturnValue(true);
  mocks.authenticatePersonalAccessToken.mockResolvedValue({...tokenAuth,user:{...tokenAuth.user,id:userId,email:`${userId}@invalid.ttv`},token:{...tokenSummary,scopes:['community:read','institution:read']}});
  mocks.roleFirst.mockResolvedValue({userId,sessionId:`${userId}-retained-read-probe-session`,runId,persona:'institution',expiresAt:now+800,email:`${userId}@invalid.ttv`,sessionUserId:userId,sessionUserAgent:marker,sessionCreatedAt:now-10,sessionExpiresAt:now+800});
  for(const [method,path,status] of [['GET','/dashboard/discover',200],['POST','/dashboard/discover',403],['GET','/dashboard/community',403],['GET','/api/mcp',403],['GET','/admin/agent-access',403]] as const){
   const {context,next}=createContext(new Request(`https://staging.tembotechventures.com${path}`,{method,headers:{Authorization:'Bearer fictional-test-only'}}));
   expect(requireResponse(await onRequest(context as never,next)).status).toBe(status);
  }
 }finally{stagingEnv.STAGING_RETAINED_READ_PROBE_ENABLED=undefined;vi.useRealTimers();}
});

describe('dedicated QA middleware does not inherit normal authentication',()=>{
 const qa={runId:'unit',persona:'member-cohort',userId:'ttv-staging-demo-v1-member-cohort',sessionId:'unit-qa',issuedAt:1,expiresAt:2};
 function request(path:string,method='GET'){return new Request('https://staging.tembotechventures.com'+path,{method,headers:{cookie:'__Host-ttv-retained-qa=fictional-unit-only',origin:'https://staging.tembotechventures.com'}});}
 it('sets constrained QA context and no-store without ordinary auth or demo parent',async()=>{
  mocks.authenticateQaCookie.mockResolvedValue({qa,user:{...tokenAuth.user,id:qa.userId},session:tokenAuth.session});
  const {context,next}=createContext(request('/dashboard/community'));const response=requireResponse(await onRequest(context as never,next));
  expect(next).toHaveBeenCalledOnce();expect(mocks.createAuth).not.toHaveBeenCalled();expect(mocks.authenticatePersonalAccessToken).not.toHaveBeenCalled();
  expect(context.locals).toMatchObject({stagingQa:qa,stagingDemo:null,personalAccessToken:null});expect(response.headers.get('cache-control')).toBe('no-store');
 });
 it.each(['/api/auth/get-session','/api/auth/sign-out','/api/demo/logout','/api/community/chat','/api/mcp','/admin'])('denies %s before any normal handler',async path=>{
  mocks.authenticateQaCookie.mockResolvedValue({qa,user:tokenAuth.user,session:tokenAuth.session});const {context,next}=createContext(request(path,'POST'));
  expect(requireResponse(await onRequest(context as never,next)).status).toBe(403);expect(next).not.toHaveBeenCalled();expect(mocks.createAuth).not.toHaveBeenCalled();
 });
 it('fails closed for invalid QA cookie rather than falling back to a human cookie',async()=>{
  mocks.authenticateQaCookie.mockRejectedValue(new Error('unit denied'));const {context,next}=createContext(request('/dashboard'));
  expect(requireResponse(await onRequest(context as never,next)).status).toBe(403);expect(next).not.toHaveBeenCalled();expect(mocks.getSession).not.toHaveBeenCalled();
 });
});
