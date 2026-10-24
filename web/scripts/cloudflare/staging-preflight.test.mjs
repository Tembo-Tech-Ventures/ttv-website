import { describe, expect, it, vi } from "vitest";
import { validateStagingRevision } from "./staging-preflight.mjs";

const sha = "a".repeat(40);
const env = {
  STAGING_INTEGRATION_BRANCH: "hackathon/integration",
  STAGING_EXPECTED_SHA: sha,
  STAGING_INTEGRATION_PR: "171",
  GITHUB_REPOSITORY: "owner/repo",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/hackathon/integration",
  GITHUB_SHA: sha,
  GH_TOKEN: "test-token",
};
const pr = {
  state: "open", merged: false, base: { ref: "main" },
  head: { ref: "hackathon/integration", sha, repo: { full_name: "owner/repo" } },
};
const respond = (body = pr) => vi.fn().mockResolvedValue({ ok: true, json: async () => body });

describe("shared staging preflight", () => {
  it.each(["deploy", "verify", "assess", "credential-audit", "gateway-setup"])("validates the same exact revision for %s", async action => {
    await expect(validateStagingRevision({ ...env, STAGING_ACTION: action }, { fetchImpl: respond() })).resolves.toMatchObject({ sha });
  });
  it("accepts only the exact current integration PR head", async () => {
    const fetchImpl = respond();
    await expect(validateStagingRevision(env, { fetchImpl })).resolves.toEqual({
      branch: "hackathon/integration", sha, prNumber: "171",
    });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.github.com/repos/owner/repo/pulls/171", expect.any(Object));
  });

  it.each([
    { STAGING_ACTION: "production" },
    { STAGING_ACTION: "" },
    { STAGING_INTEGRATION_BRANCH: "" },
    { STAGING_INTEGRATION_BRANCH: "main" },
    { STAGING_INTEGRATION_BRANCH: "production" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/supporting-work" },
    { GITHUB_REF: "refs/tags/hackathon/integration" },
    { STAGING_EXPECTED_SHA: "abcdef" },
    { STAGING_EXPECTED_SHA: "b".repeat(40) },
    { STAGING_INTEGRATION_PR: "../secrets" },
    { GITHUB_REPOSITORY: "owner/repo/../../secrets" },
    { GH_TOKEN: "" },
  ])("rejects invalid dispatch before network access: %j", async (change) => {
    const fetchImpl = respond();
    await expect(validateStagingRevision({ ...env, ...change }, { fetchImpl })).rejects.toThrow(/required|configured|Dispatch|Expected SHA|Staging action/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    { ...pr, state: "closed" },
    { ...pr, merged: true },
    { ...pr, head: { ...pr.head, sha: "b".repeat(40) } },
    { ...pr, head: { ...pr.head, ref: "supporting-work" } },
    { ...pr, head: { ...pr.head, repo: { full_name: "fork/repo" } } },
    { ...pr, base: { ref: "staging" } },
    {},
  ])("rejects closed, stale, supporting or foreign PRs", async (body) => {
    await expect(validateStagingRevision(env, { fetchImpl: respond(body) })).rejects.toThrow(/current head/);
  });

  it("fails closed on GitHub error without exposing the response body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    await expect(validateStagingRevision(env, { fetchImpl })).rejects.toThrow("HTTP 403");
  });
});
