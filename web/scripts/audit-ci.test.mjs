import { describe, expect, it } from "vitest";
import { TTV_IMAGE_SERVICE } from "../astro.config.mjs";
import { evaluateAudit } from "./audit-ci.mjs";

const advisory = (id, title = "Example advisory") => ({
  url: `https://github.com/advisories/${id}`,
  title,
});

describe("evaluateAudit", () => {
  it("keeps runtime image processing off the vulnerable Sharp path", () => {
    expect(TTV_IMAGE_SERVICE).toBe("cloudflare-binding");
  });

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

  it("allows the reviewed Astro 6 image-pipeline advisories", () => {
    const result = evaluateAudit({
      vulnerabilities: {
        astro: {
          severity: "critical",
          via: [
            advisory("GHSA-376h-93r7-7g6f"),
            advisory("GHSA-26w7-cxv4-gfx2"),
          ],
        },
        sharp: {
          severity: "high",
          via: [advisory("GHSA-rgj7-g3m4-5g8c")],
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.allowed.map(({ name }) => name)).toEqual(["astro", "sharp"]);
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
