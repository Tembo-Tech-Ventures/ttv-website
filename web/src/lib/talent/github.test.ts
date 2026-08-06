import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  fetchGitHubLogin,
  fetchPublicRepos,
  toHighlightSnapshot,
  GitHubAuthError,
} from "./github";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchResponse(data: unknown, status = 200) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    status,
    json: () => Promise.resolve(data),
    headers: new Headers(),
  } as Response);
}

describe("fetchGitHubLogin", () => {
  it("returns the login from the GitHub user endpoint", async () => {
    mockFetchResponse({ login: "octocat" });
    const login = await fetchGitHubLogin("test-token");
    expect(login).toBe("octocat");

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://api.github.com/user");
    expect(call[1].headers.Authorization).toBe("Bearer test-token");
    expect(call[1].headers["User-Agent"]).toBe("ttv-website");
    expect(call[1].headers.Accept).toBe("application/vnd.github+json");
  });

  it("throws GitHubAuthError on 401", async () => {
    mockFetchResponse({}, 401);
    await expect(fetchGitHubLogin("bad-token")).rejects.toThrow(
      /invalid/i
    );
  });

  it("throws GitHubAuthError on 403 (rate limit)", async () => {
    mockFetchResponse({}, 403);
    await expect(fetchGitHubLogin("token")).rejects.toThrow(GitHubAuthError);
  });
});

describe("fetchPublicRepos", () => {
  it("returns non-fork, non-archived repos", async () => {
    const repos = [
      { full_name: "user/repo1", fork: false, archived: false },
      { full_name: "user/forked", fork: true, archived: false },
      { full_name: "user/archived", fork: false, archived: true },
      { full_name: "user/repo2", fork: false, archived: false },
    ];
    mockFetchResponse(repos);

    const result = await fetchPublicRepos("token");
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.full_name)).toEqual([
      "user/repo1",
      "user/repo2",
    ]);
  });

  it("sends correct query parameters", async () => {
    mockFetchResponse([]);
    await fetchPublicRepos("token");

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("visibility=public");
    expect(call[0]).toContain("sort=pushed");
    expect(call[0]).toContain("per_page=100");
  });

  it("throws GitHubAuthError on 401", async () => {
    mockFetchResponse({}, 401);
    await expect(fetchPublicRepos("bad")).rejects.toThrow(GitHubAuthError);
  });
});

describe("toHighlightSnapshot", () => {
  it("maps a GitHub repo to a highlight snapshot", () => {
    const repo = {
      full_name: "user/my-project",
      html_url: "https://github.com/user/my-project",
      description: "A cool project",
      language: "TypeScript",
      topics: ["web", "react"],
      stargazers_count: 42,
      pushed_at: "2026-01-15T10:00:00Z",
      fork: false,
      archived: false,
    };

    const snapshot = toHighlightSnapshot(repo);
    expect(snapshot.repoFullName).toBe("user/my-project");
    expect(snapshot.repoUrl).toBe("https://github.com/user/my-project");
    expect(snapshot.description).toBe("A cool project");
    expect(snapshot.language).toBe("TypeScript");
    expect(snapshot.topics).toBe('["web","react"]');
    expect(snapshot.stars).toBe(42);
    expect(snapshot.pushedAt).toEqual(new Date("2026-01-15T10:00:00Z"));
    expect(snapshot.snapshotAt).toBeInstanceOf(Date);
  });

  it("handles null pushed_at", () => {
    const repo = {
      full_name: "user/empty",
      html_url: "https://github.com/user/empty",
      description: null,
      language: null,
      topics: [],
      stargazers_count: 0,
      pushed_at: null,
      fork: false,
      archived: false,
    };

    const snapshot = toHighlightSnapshot(repo);
    expect(snapshot.pushedAt).toBeNull();
    expect(snapshot.topics).toBe("[]");
  });
});
