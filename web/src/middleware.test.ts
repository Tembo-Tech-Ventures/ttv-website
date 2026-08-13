import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticatePersonalAccessToken: vi.fn(),
  createAuth: vi.fn(),
  enforcePersonalAccessTokenMutationScope: vi.fn(),
  getSession: vi.fn(),
  hasPersonalAccessTokenAuthorization: vi.fn(),
  roleFirst: vi.fn(),
}));

vi.mock("astro:middleware", () => ({
  defineMiddleware: (handler: unknown) => handler,
}));
vi.mock("cloudflare:workers", () => ({
  env: {
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ first: mocks.roleFirst })),
      })),
    },
  },
}));
vi.mock("@/lib/auth", () => ({ createAuth: mocks.createAuth }));
vi.mock("@/lib/personal-access-tokens", () => ({
  authenticatePersonalAccessToken: mocks.authenticatePersonalAccessToken,
  enforcePersonalAccessTokenMutationScope:
    mocks.enforcePersonalAccessTokenMutationScope,
  hasPersonalAccessTokenAuthorization:
    mocks.hasPersonalAccessTokenAuthorization,
}));

import { onRequest } from "./middleware";

function createContext(request: Request) {
  const redirect = vi.fn((location: string, status = 302) =>
    new Response(null, { status, headers: { location } })
  );
  return {
    context: {
      locals: {},
      request,
      url: new URL(request.url),
      redirect,
    },
    redirect,
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

describe("personal access token middleware", () => {
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
