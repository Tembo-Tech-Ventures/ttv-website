import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_SESSION_PREFIX } from "@/lib/agent-auth";

const mocks = vi.hoisted(() => {
  const all = vi.fn(async () => ({ results: [] }));
  const batch = vi.fn(async () => [{ meta: { changes: 0 } }]);
  const prepare = vi.fn((sql: string) => {
    const statement = {
      sql,
      bind: vi.fn(() => statement),
      all,
    };
    return statement;
  });

  return {
    env: {
      DB: { prepare, batch },
      DEPLOYMENT_ENVIRONMENT: "agent-pr-123",
    },
    all,
    batch,
    prepare,
  };
});

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));

import { POST } from "./import";

const DATE = "2026-08-01T12:00:00.000Z";

function context(
  body: string,
  {
    isAdmin = true,
    sessionUserAgent = "Mozilla/5.0",
    user = true,
  }: {
    isAdmin?: boolean;
    sessionUserAgent?: string | null;
    user?: boolean;
  } = {}
): Parameters<typeof POST>[0] {
  return {
    request: new Request("https://preview.example/api/admin/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://preview.example",
      },
      body,
    }),
    locals: {
      isAdmin,
      session: user
        ? {
            userAgent: sessionUserAgent,
          }
        : null,
      user: user ? { id: "admin-user" } : null,
    },
  } as Parameters<typeof POST>[0];
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.DEPLOYMENT_ENVIRONMENT = "agent-pr-123";
  mocks.all.mockResolvedValue({ results: [] });
  mocks.batch.mockResolvedValue([{ meta: { changes: 0 } }]);
});

describe("POST /api/admin/import", () => {
  it("requires an authenticated admin even when called outside middleware tests", async () => {
    expect((await POST(context("{}", { user: false }))).status).toBe(401);
    expect((await POST(context("{}", { isAdmin: false }))).status).toBe(403);
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it("is disabled at the API layer in production with reviewed-tools guidance", async () => {
    mocks.env.DEPLOYMENT_ENVIRONMENT = "production";

    const response = await POST(context("{}"));
    const body = await responseJson(response);

    expect(response.status).toBe(403);
    expect(body.error).toContain("disabled in production");
    expect(body.error).toContain("reviewed admin tools");
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it("is disabled outside staging and isolated agent environments", async () => {
    mocks.env.DEPLOYMENT_ENVIRONMENT = "development";

    const response = await POST(context("{}"));

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("migration testing");
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it("rejects agent-marked bearer sessions before parsing or mutation", async () => {
    const response = await POST(
      context("not-json", {
        sessionUserAgent: `${AGENT_SESSION_PREFIX}preview verifier`,
      })
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toContain(
      "Temporary agent sessions cannot perform legacy imports"
    );
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON without disclosing internals", async () => {
    const response = await POST(context("not-json"));

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("expected valid JSON");
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it("returns validation failures with zero mutations", async () => {
    const response = await POST(
      context(
        JSON.stringify({
          version: 1,
          exportedAt: DATE,
          programs: [{ id: 42 }],
        })
      )
    );
    const body = await responseJson(response);

    expect(response.status).toBe(400);
    expect(body.code).toBe("invalid_payload");
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "program role natural keys",
      section: "programRoles",
      rows: [
        {
          id: "role-1",
          programId: "program-1",
          userId: "user-1",
          name: "TA",
          createdAt: DATE,
          updatedAt: DATE,
        },
        {
          id: "role-2",
          programId: "program-1",
          userId: "user-1",
          name: "TA",
          createdAt: DATE,
          updatedAt: DATE,
        },
      ],
    },
    {
      name: "non-null application cohort pairs",
      section: "programApplications",
      rows: [
        {
          id: "application-1",
          programId: "program-1",
          userId: "user-1",
          partnerId: null,
          status: "PENDING",
          application: {},
          completedAt: null,
          createdAt: DATE,
          updatedAt: DATE,
        },
        {
          id: "application-2",
          programId: "program-1",
          userId: "user-1",
          partnerId: null,
          status: "PENDING",
          application: {},
          completedAt: null,
          createdAt: DATE,
          updatedAt: DATE,
        },
      ],
    },
  ])("rejects duplicate $name before D1 preparation", async ({ section, rows }) => {
    const response = await POST(
      context(
        JSON.stringify({
          version: 1,
          exportedAt: DATE,
          [section]: rows,
        })
      )
    );
    const body = await responseJson(response);

    expect(response.status).toBe(400);
    expect(body.code).toBe("invalid_payload");
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it("returns ignored privilege counts without creating grants", async () => {
    const response = await POST(
      context(
        JSON.stringify({
          version: 1,
          exportedAt: DATE,
          roles: [{ id: "role-admin", name: "ADMIN" }],
          userRoles: [
            {
              id: "grant-admin",
              roleId: "role-admin",
              userId: "legacy-user",
            },
          ],
        })
      )
    );
    const body = await responseJson(response);

    expect(response.status).toBe(200);
    expect(body.totalChanges).toBe(0);
    expect(body.ignored).toEqual({ roles: 1, userRoles: 1 });
    expect(body.imported).not.toHaveProperty("roles");
    expect(body.imported).not.toHaveProperty("userRoles");
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it("surfaces actual zero-change D1 metadata as skipped", async () => {
    const response = await POST(
      context(
        JSON.stringify({
          version: 1,
          exportedAt: DATE,
          users: [
            {
              id: "legacy-user",
              name: "Legacy User",
              email: "legacy@example.test",
              emailVerified: false,
            },
          ],
        })
      )
    );
    const body = await responseJson(response);

    expect(response.status).toBe(200);
    expect(body.totalChanges).toBe(0);
    expect(body.totalSkipped).toBe(1);
    expect(body.imported).toMatchObject({ users: 0 });
    expect(body.skipped).toMatchObject({ users: 1 });
    expect(mocks.batch).toHaveBeenCalledTimes(1);
  });

  it("returns a generic transactional failure without leaking D1 or row data", async () => {
    mocks.batch.mockRejectedValueOnce(
      new Error("D1 failure for legacy@example.test in user table")
    );

    const response = await POST(
      context(
        JSON.stringify({
          version: 1,
          exportedAt: DATE,
          users: [
            {
              id: "legacy-user",
              name: "Legacy User",
              email: "legacy@example.test",
              emailVerified: false,
            },
          ],
        })
      )
    );
    const body = await responseJson(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("Legacy import failed without applying changes.");
    expect(JSON.stringify(body)).not.toContain("legacy@example.test");
    expect(JSON.stringify(body)).not.toContain("D1");
  });
});
