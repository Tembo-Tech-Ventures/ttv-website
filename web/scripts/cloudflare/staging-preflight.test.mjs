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
  it.each(["deploy", "verify", "assess", "credential-audit", "seed-demo", "preview-container-state"])("validates the same exact revision for %s", async action => {
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

it.each(["deploy", "verify", "assess", "credential-audit", "cleanup-chat-incident", "seed-demo"])("rejects deployed revision override before API access for %s", async action => {
  const fetchImpl = respond();
  await expect(validateStagingRevision({...env, STAGING_ACTION:action, STAGING_EXPECTED_DEPLOYED_SHA:sha}, {fetchImpl})).rejects.toThrow("only allowed for read-only diagnosis");
  expect(fetchImpl).not.toHaveBeenCalled();
});
it("retains current executor revision checks with diagnostic deployed override",async()=>{
  await expect(validateStagingRevision({...env,STAGING_ACTION:"diagnose-demo",STAGING_EXPECTED_DEPLOYED_SHA:"b".repeat(40)}, {fetchImpl:respond()})).resolves.toMatchObject({sha});
  await expect(validateStagingRevision({...env,STAGING_ACTION:"diagnose-demo",STAGING_EXPECTED_DEPLOYED_SHA:sha,GITHUB_SHA:"b".repeat(40)}, {fetchImpl:respond()})).rejects.toThrow("exact dispatched revision");
});

it('wires the fixed PR220 state read through exact-head preflight and the existing staging credential boundary',async()=>{
 const {readFile}=await import('node:fs/promises');const workflow=await readFile(new URL('../../../.github/workflows/cloudflare-staging.yml',import.meta.url),'utf8');const job=workflow.slice(workflow.indexOf('  preview-container-state:'));
 expect(job).toContain('needs: preflight');expect(job).toContain('environment: staging');expect(job).toContain('STAGING_ACTION: preview-container-state');expect(job).toContain('node scripts/cloudflare/preview-container-state.mjs');expect(job).not.toMatch(/cf:deploy|cf:destroy|wrangler|health|schedule:|CLOUDFLARE_ENVIRONMENT_NAME: production/);
});
