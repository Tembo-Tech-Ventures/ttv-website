import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const workflow = name => readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), "utf8");
const parent = workflow("cloudflare-staging.yml");
const child = workflow("cloudflare-staging-fixtures.yml");
const deploy = parent.split("\n  staging:\n")[1].split("\n  verify:\n")[0];
const verify = parent.split("\n  verify:\n")[1];
describe("registered staging verification entrypoint", () => {
  it("keeps deployment and verification mutually exclusive behind preflight", () => {
    expect(deploy).toContain("if: ${{ inputs.action == 'deploy' }}");
    expect(verify).toContain("if: ${{ inputs.action == 'verify' }}");
    for (const job of [deploy, verify]) expect(job).toContain("needs: preflight");
    expect(parent).toContain("STAGING_ACTION: ${{ inputs.action }}");
    expect(parent).toContain("default: deploy");
    expect(verify).not.toMatch(/action: deploy|cf:deploy|environment_name:/);
  });
  it("calls same-revision runner under one non-cancelling parent lock", () => {
    expect(verify).toContain("uses: ./.github/workflows/cloudflare-staging-fixtures.yml");
    expect(verify).toContain("expected_sha: ${{ inputs.expected_sha }}");
    expect(parent).toContain("group: ttv-cloudflare-staging\n  cancel-in-progress: false");
    expect(child).toContain("  workflow_call:");
    expect(child).not.toMatch(/workflow_dispatch:|^concurrency:/m);
    expect(child).toContain("run: node scripts/cloudflare/staging-fixtures.mjs");
    expect(child).not.toMatch(/cf:deploy|cf:destroy|wrangler|--apply/);
  });
  it("keeps preflight before staging credentials and revision checks inside runner", () => {
    const before = child.split("\n  verify:\n")[0];
    expect(before).toContain("run: node web/scripts/cloudflare/staging-preflight.mjs");
    expect(before).not.toContain("secrets.");
    const job = child.split("\n  verify:\n")[1];
    expect(job).toContain("needs: preflight");
    expect(job).toContain("environment: staging");
    expect(job).toContain("STAGING_EXPECTED_SHA: ${{ inputs.expected_sha }}");
    expect(job).toContain("CLOUDFLARE_ENVIRONMENT_NAME: staging");
    expect(job).toContain("BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET }}");
  });
});
