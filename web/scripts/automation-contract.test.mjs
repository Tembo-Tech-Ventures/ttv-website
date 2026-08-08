import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");

async function readRepositoryFile(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

describe("GitHub delivery contracts", () => {
  it("uses Node 24-compatible checkout and setup actions", async () => {
    const workflows = await Promise.all(
      [
        "ci.yml",
        "cloudflare-agent.yml",
        "cloudflare-environment.yml",
        "cloudflare-sweep.yml",
      ].map((name) => readRepositoryFile(`.github/workflows/${name}`))
    );

    for (const workflow of workflows) {
      expect(workflow).not.toMatch(/actions\/(checkout|setup-node)@v4/);
      expect(workflow).toMatch(/actions\/(checkout|setup-node)@v5/);
    }
  });

  it("keeps agent bearer auth enabled only for staging and isolated previews", async () => {
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
    expect(workflow).toContain("npx wrangler tail");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("retention-days: 14");
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
    expect(workflow).toContain(
      "AGENT_PREVIEW_SECRET: ${{ secrets.AGENT_PREVIEW_SECRET }}"
    );
    expect(workflow).not.toContain("STAGING_AGENT_TOKEN");
    expect(workflow).toContain("npx wrangler tail");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("CLOUDFLARE_PROTECTED_ENVIRONMENTS: production,prod,staging");
  });

  it("deploys every pull request to its own environment and tears it down on close", async () => {
    const workflow = await readRepositoryFile(
      ".github/workflows/cloudflare-staging-pr.yml"
    );

    expect(workflow).toContain("- closed");
    expect(workflow).toContain(
      "environment_name: agent-pr-${{ github.event.pull_request.number }}"
    );
    expect(workflow).toContain(
      "action: ${{ github.event.action == 'closed' && 'destroy' || 'deploy' }}"
    );
    expect(workflow).toContain("name: Cloudflare PR Preview");
    expect(workflow).not.toContain("environment_name: staging");
  });

  it("keeps preview identity secrets out of shared staging and production", async () => {
    const workflow = await readRepositoryFile(
      ".github/workflows/cloudflare-environment.yml"
    );

    expect(workflow).toContain(
      "AGENT_PREVIEW_SECRET: ${{ startsWith(inputs.environment_name, 'agent-')"
    );
    expect(workflow).toContain(
      "PLAYWRIGHT_AGENT_TOKEN: ${{ inputs.environment_name == 'staging'"
    );
    expect(workflow).not.toContain(
      "STAGING_AGENT_TOKEN: ${{ secrets.STAGING_AGENT_TOKEN }}"
    );
  });

  it("passes CREDENTIALS_ENCRYPTION_KEY for non-agent environments in both workflow jobs", async () => {
    const workflow = await readRepositoryFile(
      ".github/workflows/cloudflare-environment.yml"
    );

    const occurrences = workflow
      .split("\n")
      .filter((line) => line.includes("CREDENTIALS_ENCRYPTION_KEY:"));
    expect(occurrences.length).toBe(2);
    for (const line of occurrences) {
      expect(line).toContain("!startsWith(inputs.environment_name, 'agent-')");
      expect(line).toContain("secrets.CREDENTIALS_ENCRYPTION_KEY");
    }
  });

  it("keeps credentialed stale cleanup dry-run-first and protected", async () => {
    const workflow = await readRepositoryFile(
      ".github/workflows/cloudflare-sweep.yml"
    );

    expect(workflow).toContain("default: false");
    expect(workflow).toContain('default: "72"');
    expect(workflow).toContain('cron: "17 4 * * *"');
    expect(workflow).toContain(
      "SWEEP_EXECUTE: ${{ github.event_name == 'schedule' && 'true' || inputs.execute }}"
    );
    expect(workflow).toContain(
      "SWEEP_MAX_AGE_HOURS: ${{ github.event_name == 'schedule' && '72' || inputs.max_age_hours }}"
    );
    expect(workflow).toContain('if [[ "${SWEEP_EXECUTE}" == "true" ]]');
    expect(workflow).toContain("CLOUDFLARE_PROTECTED_ENVIRONMENTS: production,prod,staging");
    expect(workflow).toContain("pull-requests: read");
    expect(workflow).toContain("gh pr list --state open");
    expect(workflow).toContain(
      "OPEN_PR_EXCLUSIONS: ${{ steps.active.outputs.open_prs }}"
    );
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
    ).toEqual([
      "Lint",
      "Test",
      "Security",
      "preview / cloudflare-with-environment",
    ]);
  });

  it("runs live journeys through the token-safe wrapper on desktop and mobile", async () => {
    const [packageJson, playwright] = await Promise.all([
      readRepositoryFile("web/package.json"),
      readRepositoryFile("web/playwright.config.ts"),
    ]);

    expect(JSON.parse(packageJson).scripts["test:e2e"]).toContain(
      "run-live-e2e.mjs"
    );
    expect(playwright).toContain('name: "chromium"');
    expect(playwright).toContain('name: "mobile-chromium"');
  });
});
