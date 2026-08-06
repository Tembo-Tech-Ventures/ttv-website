import { describe, expect, it } from "vitest";
import { evaluateAudit } from "./audit-ci.mjs";

const advisory = (id, title = "Example advisory") => ({
  url: `https://github.com/advisories/${id}`,
  title,
});

describe("evaluateAudit", () => {
  it("passes a clean report", () => {
    expect(evaluateAudit({ vulnerabilities: {} }).ok).toBe(true);
  });

  it("fails on a high advisory outside the allowlist", () => {
    const result = evaluateAudit(
      {
        vulnerabilities: {
          leftpad: {
            severity: "high",
            via: [advisory("GHSA-aaaa-bbbb-cccc")],
          },
        },
      },
      new Set()
    );
    expect(result.ok).toBe(false);
    expect(result.failures[0].name).toBe("leftpad");
    expect(result.failures[0].advisories[0].id).toBe("GHSA-aaaa-bbbb-cccc");
  });

  it("passes allowlisted high advisories and reports them", () => {
    const result = evaluateAudit(
      {
        vulnerabilities: {
          astro: {
            severity: "high",
            via: [advisory("GHSA-4g3v-8h47-v7g6")],
          },
        },
      },
      new Set(["GHSA-4g3v-8h47-v7g6"])
    );
    expect(result.ok).toBe(true);
    expect(result.allowed).toHaveLength(1);
  });

  it("fails when a package mixes allowlisted and unlisted advisories", () => {
    const result = evaluateAudit(
      {
        vulnerabilities: {
          astro: {
            severity: "high",
            via: [advisory("GHSA-4g3v-8h47-v7g6"), advisory("GHSA-zzzz-yyyy-xxxx")],
          },
        },
      },
      new Set(["GHSA-4g3v-8h47-v7g6"])
    );
    expect(result.ok).toBe(false);
    expect(result.failures[0].advisories).toHaveLength(1);
    expect(result.failures[0].advisories[0].id).toBe("GHSA-zzzz-yyyy-xxxx");
  });

  it("ignores moderate/low severities and transitive string references", () => {
    const result = evaluateAudit(
      {
        vulnerabilities: {
          esbuild: { severity: "moderate", via: [advisory("GHSA-mmmm-nnnn-oooo")] },
          wrangler: { severity: "high", via: ["miniflare"] },
        },
      },
      new Set()
    );
    expect(result.ok).toBe(true);
  });

  it("fails critical advisories with missing ids rather than skipping them", () => {
    const result = evaluateAudit(
      {
        vulnerabilities: {
          mystery: { severity: "critical", via: [{ url: "https://example.com", title: "?" }] },
        },
      },
      new Set()
    );
    expect(result.ok).toBe(false);
  });
});
