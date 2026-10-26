import { pathToFileURL } from "node:url";

/** Fail closed before the staging job receives Cloudflare credentials. */
export async function validateStagingRevision(env, { fetchImpl = fetch } = {}) {
  if (env.STAGING_ACTION !== undefined && !["deploy", "verify", "assess", "credential-audit", "cleanup-chat-incident", "seed-demo", "diagnose-demo", "retained-read-probe", "persona-qa-issue", "persona-qa-cleanup", "preview-container-state"].includes(env.STAGING_ACTION)) {
    throw new Error("Staging action is unsupported.");
  }
  if (env.STAGING_EXPECTED_DEPLOYED_SHA && env.STAGING_ACTION !== "diagnose-demo") {
    throw new Error("A deployed revision override is only allowed for read-only diagnosis.");
  }
  const branch = env.STAGING_INTEGRATION_BRANCH;
  const sha = env.STAGING_EXPECTED_SHA;
  const repository = env.GITHUB_REPOSITORY;
  const prNumber = env.STAGING_INTEGRATION_PR;
  if (!branch || ["main", "production", "prod"].includes(branch)) {
    throw new Error("A non-production integration branch must be configured.");
  }
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
      env.GITHUB_REF !== `refs/heads/${branch}`) {
    throw new Error("Dispatch must target the configured integration branch.");
  }
  if (!/^[a-f0-9]{40}$/.test(sha ?? "") || sha !== env.GITHUB_SHA) {
    throw new Error("Expected SHA must equal the exact dispatched revision.");
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") ||
      !/^[1-9]\d*$/.test(prNumber ?? "") || !env.GH_TOKEN) {
    throw new Error("Repository, integration PR and GitHub token are required.");
  }
  const response = await fetchImpl(
    `https://api.github.com/repos/${repository}/pulls/${prNumber}`,
    { headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json" } }
  );
  if (!response.ok) {
    throw new Error(`Integration PR lookup failed (HTTP ${response.status}).`);
  }
  const pr = await response.json();
  if (pr.state !== "open" || pr.merged || pr.head?.repo?.full_name !== repository ||
      pr.head?.ref !== branch || pr.head?.sha !== sha || pr.base?.ref !== "main") {
    throw new Error("Revision must be the current head of the open integration PR to main.");
  }
  return { branch, sha, prNumber };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { branch, sha, prNumber } = await validateStagingRevision(process.env);
    console.log(`Staging preflight passed: PR #${prNumber}, ${branch}, ${sha}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
