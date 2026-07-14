import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");

async function readRepositoryFile(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

describe("GitHub delivery contracts", () => {
  it("keeps agent bearer auth enabled only for shared staging", async () => {
    const [pullRequestStaging, manualStaging, production] = await Promise.all([
      readRepositoryFile(".github/workflows/cloudflare-staging-pr.yml"),
      readRepositoryFile(".github/workflows/cloudflare-staging.yml"),
      readRepositoryFile(".github/workflows/cloudflare-production.yml"),
    ]);

    expect(pullRequestStaging).toContain("agent_auth_enabled: true");
    expect(manualStaging).toContain("agent_auth_enabled: true");
    expect(production).not.toContain("agent_auth_enabled: true");
  });

  it("verifies deployment identity and live browser journeys after every deploy", async () => {
    const workflow = await readRepositoryFile(
      ".github/workflows/cloudflare-environment.yml"
    );

    expect(workflow).toContain("npm run cf:smoke");
    expect(workflow).toContain('--expected-version="$GITHUB_SHA"');
    expect(workflow).toContain("npm run test:e2e");
    expect(workflow).toContain(
      "PLAYWRIGHT_BASE_URL: ${{ steps.deploy.outputs.better_auth_url }}"
    );
  });

  it("provides an isolated GitHub-hosted agent deploy path with staging-scoped credentials", async () => {
    const workflow = await readRepositoryFile(
      ".github/workflows/cloudflare-agent.yml"
    );

    expect(workflow).toContain("environment: staging");
    expect(workflow).toContain("npm run cf:agent -- context");
    expect(workflow).toContain("npm run cf:agent -- deploy");
    expect(workflow).toContain("npm run cf:agent -- destroy");
    expect(workflow).toContain("CLOUDFLARE_PROTECTED_ENVIRONMENTS: production,prod,staging");
  });

  it("keeps credentialed stale cleanup dry-run-first and protected", async () => {
    const workflow = await readRepositoryFile(
      ".github/workflows/cloudflare-sweep.yml"
    );

    expect(workflow).toContain("default: false");
    expect(workflow).toContain('default: "72"');
    expect(workflow).toContain('if [[ "${SWEEP_EXECUTE}" == "true" ]]');
    expect(workflow).toContain("CLOUDFLARE_PROTECTED_ENVIRONMENTS: production,prod,staging");
    expect(workflow).toContain("npm run cf:sweep");
  });

  it("requires unit, static, browser-discovery, and security gates in CI", async () => {
    const workflow = await readRepositoryFile(".github/workflows/ci.yml");

    expect(workflow).toContain("npm run lint");
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm test");
    expect(workflow).toContain("npm run test:e2e:list");
    expect(workflow).toContain("npm run audit:ci");
  });

  it("records review and required-check protection for the default branch", async () => {
    const ruleset = JSON.parse(
      await readRepositoryFile(".github/rulesets/main.json")
    );
    const pullRequest = ruleset.rules.find(({ type }) => type === "pull_request");
    const statusChecks = ruleset.rules.find(
      ({ type }) => type === "required_status_checks"
    );

    expect(ruleset.conditions.ref_name.include).toContain("~DEFAULT_BRANCH");
    expect(pullRequest.parameters).toMatchObject({
      required_approving_review_count: 1,
      require_last_push_approval: true,
      required_review_thread_resolution: true,
    });
    expect(
      statusChecks.parameters.required_status_checks.map(({ context }) => context)
    ).toEqual(["Lint", "Test", "Security"]);
  });
});
