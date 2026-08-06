export class GitHubAuthError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "GitHubAuthError";
  }
}

const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "ttv-website",
};

async function githubFetch(
  url: string,
  accessToken: string
): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      ...GITHUB_HEADERS,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new GitHubAuthError(
      response.status,
      response.status === 401
        ? "GitHub token is invalid. Sign out and back in to reconnect GitHub."
        : "GitHub API rate limit exceeded or token lacks required permissions."
    );
  }

  return response;
}

interface GitHubUser {
  login: string;
  [key: string]: unknown;
}

export async function fetchGitHubLogin(
  accessToken: string
): Promise<string> {
  const response = await githubFetch(
    "https://api.github.com/user",
    accessToken
  );
  const data = (await response.json()) as GitHubUser;
  return data.login;
}

interface GitHubRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  topics: string[];
  stargazers_count: number;
  pushed_at: string | null;
  fork: boolean;
  archived: boolean;
  [key: string]: unknown;
}

export async function fetchPublicRepos(
  accessToken: string
): Promise<GitHubRepo[]> {
  const response = await githubFetch(
    "https://api.github.com/user/repos?visibility=public&sort=pushed&per_page=100",
    accessToken
  );
  const repos = (await response.json()) as GitHubRepo[];
  return repos.filter((repo) => !repo.fork && !repo.archived);
}

export interface HighlightSnapshot {
  repoFullName: string;
  repoUrl: string;
  description: string | null;
  language: string | null;
  topics: string;
  stars: number;
  pushedAt: Date | null;
  snapshotAt: Date;
}

export function toHighlightSnapshot(repo: GitHubRepo): HighlightSnapshot {
  return {
    repoFullName: repo.full_name,
    repoUrl: repo.html_url,
    description: repo.description,
    language: repo.language,
    topics: JSON.stringify(repo.topics ?? []),
    stars: repo.stargazers_count,
    pushedAt: repo.pushed_at ? new Date(repo.pushed_at) : null,
    snapshotAt: new Date(),
  };
}
