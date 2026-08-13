import { describe, it, expect, vi, beforeEach } from "vitest";

interface RepositoriesResponse extends Record<string, unknown> {
  repos: Array<Record<string, unknown>>;
}

async function json(res: Response): Promise<RepositoriesResponse> {
  return res.json() as Promise<RepositoriesResponse>;
}

vi.mock("cloudflare:workers", () => ({ env: { DB: {} } }));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  createAuth: () => ({
    api: { getSession: mockGetSession },
  }),
}));

const mockFindAccount = vi.fn();
vi.mock("drizzle-orm/d1", () => ({
  drizzle: () => ({
    query: {
      account: { findFirst: mockFindAccount },
    },
  }),
}));

const mockFetchPublicRepos = vi.fn();
vi.mock("@/lib/talent/github", async () => {
  const actual = await vi.importActual<typeof import("@/lib/talent/github")>(
    "@/lib/talent/github",
  );
  return {
    ...actual,
    fetchPublicRepos: (...args: unknown[]) => mockFetchPublicRepos(...args),
  };
});

import { GET } from "./repos";
import { GitHubAuthError } from "@/lib/talent/github";

function makeRequest() {
  return new Request("https://example.com/api/portfolio/repos");
}

function makeContext(request: Request) {
  return { request } as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/portfolio/repos", () => {
  it("returns 401 without session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(makeContext(makeRequest()));
    expect(res.status).toBe(401);
    const data = await json(res);
    expect(data.error).toBe("unauthorized");
  });

  it("returns no_token when no GitHub account", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      session: {},
    });
    mockFindAccount.mockResolvedValue(null);

    const res = await GET(makeContext(makeRequest()));
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.error).toBe("no_token");
  });

  it("returns no_token when account has no accessToken", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      session: {},
    });
    mockFindAccount.mockResolvedValue({ accessToken: null });

    const res = await GET(makeContext(makeRequest()));
    const data = await json(res);
    expect(data.error).toBe("no_token");
  });

  it("returns repos from GitHub", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      session: {},
    });
    mockFindAccount.mockResolvedValue({ accessToken: "ghp_test123" });
    mockFetchPublicRepos.mockResolvedValue([
      {
        full_name: "user/repo",
        html_url: "https://github.com/user/repo",
        description: "A repo",
        language: "TypeScript",
        stargazers_count: 5,
        topics: ["web"],
        pushed_at: "2026-01-01T00:00:00Z",
        fork: false,
        archived: false,
      },
    ]);

    const res = await GET(makeContext(makeRequest()));
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.repos).toHaveLength(1);
    expect(data.repos[0].full_name).toBe("user/repo");
    expect(data.repos[0].language).toBe("TypeScript");
  });

  it("returns auth_error on GitHubAuthError", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      session: {},
    });
    mockFindAccount.mockResolvedValue({ accessToken: "ghp_bad" });
    mockFetchPublicRepos.mockRejectedValue(
      new GitHubAuthError(401, "Invalid token"),
    );

    const res = await GET(makeContext(makeRequest()));
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.error).toBe("auth_error");
  });

  it("returns 500 on unexpected error", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      session: {},
    });
    mockFindAccount.mockResolvedValue({ accessToken: "ghp_ok" });
    mockFetchPublicRepos.mockRejectedValue(new Error("network failure"));

    const res = await GET(makeContext(makeRequest()));
    expect(res.status).toBe(500);
  });
});
