import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("isolated preview run-scope wiring", () => {
  it.each(["cloudflare-agent.yml", "cloudflare-environment.yml"])("uses the same run and attempt for every credentialed job in %s", name => {
    const source = readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), "utf8");
    const jobs = source.split(/\n {2}[a-z-]+:\n/).filter(job => job.includes("AGENT_PREVIEW_SECRET:"));
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) expect(job).toContain("AGENT_PREVIEW_RUN_ID: github-${{ github.run_id }}-${{ github.run_attempt }}");
  });
  it("rejects missing scope before either deployment entrypoint can provision", () => {
    const direct = readFileSync(new URL("deploy.mjs", import.meta.url), "utf8");
    expect(direct.indexOf('requirePreviewRunId(getOptionalEnv("AGENT_PREVIEW_RUN_ID"))')).toBeLessThan(direct.indexOf("await ensureD1Database"));
    const wrapper = readFileSync(new URL("agent-environment.mjs", import.meta.url), "utf8");
    expect(wrapper.indexOf('requirePreviewRunId(getOptionalEnv("AGENT_PREVIEW_RUN_ID"))')).toBeLessThan(wrapper.indexOf("await getWorkersSubdomain()"));
  });
});
