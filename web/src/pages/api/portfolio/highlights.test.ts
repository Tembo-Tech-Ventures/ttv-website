import { describe, it, expect, vi, beforeEach } from "vitest";

async function json(
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return res.json() as Promise<Record<string, any>>;
}

vi.mock("cloudflare:workers", () => ({ env: { DB: {} } }));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  createAuth: () => ({
    api: { getSession: mockGetSession },
  }),
}));

const mockFindProfile = vi.fn();
const mockFindAccount = vi.fn();
const mockFindHighlights = vi.fn();
const mockDelete = vi.fn();
const mockInsertValues = vi.fn();

vi.mock("drizzle-orm/d1", () => ({
  drizzle: () => ({
    query: {
      studentProfile: { findFirst: mockFindProfile },
      account: { findFirst: mockFindAccount },
      profileHighlight: { findMany: mockFindHighlights },
    },
    delete: () => ({ where: mockDelete }),
    insert: () => ({ values: mockInsertValues }),
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

import { POST, PUT } from "./highlights";
import { GitHubAuthError } from "@/lib/talent/github";

function makeRequest(
  method: string,
  body?: unknown,
): Parameters<typeof POST>[0] {
  const request = new Request("https://example.com/api/portfolio/highlights", {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { request } as Parameters<typeof POST>[0];
}

const SAMPLE_REPOS = [
  {
    full_name: "user/repo-a",
    html_url: "https://github.com/user/repo-a",
    description: "Repo A",
    language: "TypeScript",
    topics: ["web"],
    stargazers_count: 10,
    pushed_at: "2026-01-01T00:00:00Z",
    fork: false,
    archived: false,
  },
  {
    full_name: "user/repo-b",
    html_url: "https://github.com/user/repo-b",
    description: "Repo B",
    language: "Python",
    topics: [],
    stargazers_count: 0,
    pushed_at: null,
    fork: false,
    archived: false,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/portfolio/highlights", () => {
  it("returns 401 without session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(makeRequest("POST", []));
    expect(res.status).toBe(401);
  });

  it("returns 400 without profile", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      session: {},
    });
    mockFindProfile.mockResolvedValue(null);

    const res = await POST(makeRequest("POST", []));
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.error).toBe("Profile not found");
  });

  it("rejects invalid JSON body", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      session: {},
    });
    mockFindProfile.mockResolvedValue({ id: "profile-1" });

    const request = new Request(
      "https://example.com/api/portfolio/highlights",
      {
        method: "POST",
        body: "not json",
      },
    );
    const res = await POST({ request } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it("rejects more than 6 highlights", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      session: {},
    });
    mockFindProfile.mockResolvedValue({ id: "profile-1" });

    const tooMany = Array.from({ length: 7 }, (_, i) => ({
      repoFullName: `user/repo-${i}`,
      blurb: "",
      sortOrder: i,
    }));

    const res = await POST(makeRequest("POST", tooMany));
    expect(res.status).toBe(400);
  });

  it("clears highlights when empty array sent", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      session: {},
    });
    mockFindProfile.mockResolvedValue({ id: "profile-1" });

    const res = await POST(makeRequest("POST", []));
    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalled();
  });

  it("rejects unknown repos", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      session: {},
    });
    mockFindProfile.mockResolvedValue({ id: "profile-1" });
    mockFindAccount.mockResolvedValue({ accessToken: "ghp_test" });
    mockFetchPublicRepos.mockResolvedValue(SAMPLE_REPOS);

    const body = [
      { repoFullName: "user/nonexistent", blurb: "", sortOrder: 0 },
    ];
    const res = await POST(makeRequest("POST", body));
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.error).toContain("Unknown repositories");
  });

  it("saves valid highlights with server-derived snapshots", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      session: {},
    });
    mockFindProfile.mockResolvedValue({ id: "profile-1" });
    mockFindAccount.mockResolvedValue({ accessToken: "ghp_test" });
    mockFetchPublicRepos.mockResolvedValue(SAMPLE_REPOS);

    const body = [
      {
        repoFullName: "user/repo-a",
        blurb: "My main project",
        sortOrder: 0,
      },
    ];
    const res = await POST(makeRequest("POST", body));
    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalled();
    expect(mockInsertValues).toHaveBeenCalled();

    const insertedRows = mockInsertValues.mock.calls[0][0];
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].repoFullName).toBe("user/repo-a");
    expect(insertedRows[0].repoUrl).toBe("https://github.com/user/repo-a");
    expect(insertedRows[0].blurb).toBe("My main project");
    expect(insertedRows[0].language).toBe("TypeScript");
    expect(insertedRows[0].snapshotAt).toBeInstanceOf(Date);
  });

  it("returns 400 on GitHubAuthError", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      session: {},
    });
    mockFindProfile.mockResolvedValue({ id: "profile-1" });
    mockFindAccount.mockResolvedValue({ accessToken: "ghp_bad" });
    mockFetchPublicRepos.mockRejectedValue(
      new GitHubAuthError(401, "Invalid"),
    );

    const body = [{ repoFullName: "user/repo", blurb: "", sortOrder: 0 }];
    const res = await POST(makeRequest("POST", body));
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.error).toBe("auth_error");
  });

  it("returns 400 when GitHub not connected", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      session: {},
    });
    mockFindProfile.mockResolvedValue({ id: "profile-1" });
    mockFindAccount.mockResolvedValue(null);

    const body = [{ repoFullName: "user/repo", blurb: "", sortOrder: 0 }];
    const res = await POST(makeRequest("POST", body));
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.error).toBe("GitHub account not connected");
  });

  it("maps empty blurb to null", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      session: {},
    });
    mockFindProfile.mockResolvedValue({ id: "profile-1" });
    mockFindAccount.mockResolvedValue({ accessToken: "ghp_test" });
    mockFetchPublicRepos.mockResolvedValue(SAMPLE_REPOS);

    const body = [{ repoFullName: "user/repo-a", blurb: "", sortOrder: 0 }];
    await POST(makeRequest("POST", body));

    const insertedRows = mockInsertValues.mock.calls[0][0];
    expect(insertedRows[0].blurb).toBeNull();
  });
});

describe("PUT /api/portfolio/highlights (refresh)", () => {
  it("returns 401 without session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await PUT(makeRequest("PUT"));
    expect(res.status).toBe(401);
  });

  it("returns 400 without profile", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      session: {},
    });
    mockFindProfile.mockResolvedValue(null);

    const res = await PUT(makeRequest("PUT"));
    expect(res.status).toBe(400);
  });

  it("returns ok with 0 refreshed when no existing highlights", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      session: {},
    });
    mockFindProfile.mockResolvedValue({ id: "profile-1" });
    mockFindHighlights.mockResolvedValue([]);

    const res = await PUT(makeRequest("PUT"));
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.refreshed).toBe(0);
  });

  it("re-snapshots existing highlights from GitHub", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      session: {},
    });
    mockFindProfile.mockResolvedValue({ id: "profile-1" });
    mockFindHighlights.mockResolvedValue([
      {
        repoFullName: "user/repo-a",
        blurb: "My project",
        sortOrder: 0,
      },
    ]);
    mockFindAccount.mockResolvedValue({ accessToken: "ghp_test" });
    mockFetchPublicRepos.mockResolvedValue(SAMPLE_REPOS);

    const res = await PUT(makeRequest("PUT"));
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.refreshed).toBe(1);
    expect(mockInsertValues).toHaveBeenCalled();

    const rows = mockInsertValues.mock.calls[0][0];
    expect(rows[0].blurb).toBe("My project");
    expect(rows[0].snapshotAt).toBeInstanceOf(Date);
  });

  it("drops highlights whose repos are no longer public", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      session: {},
    });
    mockFindProfile.mockResolvedValue({ id: "profile-1" });
    mockFindHighlights.mockResolvedValue([
      { repoFullName: "user/deleted-repo", blurb: "", sortOrder: 0 },
    ]);
    mockFindAccount.mockResolvedValue({ accessToken: "ghp_test" });
    mockFetchPublicRepos.mockResolvedValue(SAMPLE_REPOS);

    const res = await PUT(makeRequest("PUT"));
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.refreshed).toBe(0);
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});
