import { execFileSync } from "node:child_process";

/**
 * CI security audit with an explicit, expiring exception list.
 *
 * Fails on any high/critical advisory that is not allowlisted below. The
 * allowlist exists solely for advisories whose only fix is the Astro 6→7
 * major upgrade; their attack surfaces (View
 * Transition directives, spread attribute names, Sharp asset pipeline) are
 * not exercised by this codebase. The Cloudflare adapter is explicitly pinned
 * to its Cloudflare Images binding, and the app does not use `astro:assets`.
 * Remove the entries when Astro 7 lands — a stale entry costs nothing, a
 * missing one fails the build loudly.
 */
export const ALLOWLISTED_ADVISORIES = new Set([
  // Astro XSS advisories fixed only in astro@7 (major); View Transitions and
  // spread-attribute rendering are unused here.
  "GHSA-4g3v-8h47-v7g6",
  "GHSA-f48w-9m4c-m7f5",
  "GHSA-7pw4-f3q4-r2p2",
  // Requires a configured non-root base. TTV uses Astro's default root base.
  "GHSA-376h-93r7-7g6f",
  // Requires an untrusted AVIF to reach Sharp. TTV has no Astro asset calls,
  // and the adapter is pinned to Cloudflare Images.
  "GHSA-26w7-cxv4-gfx2",
  // Sharp (transitive via Astro's unused asset pipeline); fixes ship with the
  // same Astro major. Runtime images use Cloudflare Images instead.
  "GHSA-f88m-g3jw-g9cj",
  "GHSA-rgj7-g3m4-5g8c",
]);

const FAILING_SEVERITIES = new Set(["high", "critical"]);

function advisoryId(url) {
  const match = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(url ?? "");
  return match ? match[0] : null;
}

/**
 * Evaluate an `npm audit --json` report. A package fails when its severity is
 * high/critical and at least one of its own advisories (objects in `via`;
 * strings are transitive references counted at their source package) is not
 * allowlisted.
 */
export function evaluateAudit(report, allowlist = ALLOWLISTED_ADVISORIES) {
  const failures = [];
  const allowed = [];

  for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
    if (!FAILING_SEVERITIES.has(vuln.severity)) continue;

    const advisories = (vuln.via ?? [])
      .filter((via) => typeof via === "object" && via !== null)
      .map((via) => ({ id: advisoryId(via.url), title: via.title ?? "" }));

    if (advisories.length === 0) continue;

    const unlisted = advisories.filter((a) => !a.id || !allowlist.has(a.id));
    if (unlisted.length > 0) {
      failures.push({ name, severity: vuln.severity, advisories: unlisted });
    } else {
      allowed.push({ name, severity: vuln.severity, advisories });
    }
  }

  return { ok: failures.length === 0, failures, allowed };
}

function runNpmAudit() {
  try {
    return execFileSync("npm", ["audit", "--json"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    // npm audit exits non-zero when vulnerabilities exist; the JSON report is
    // still on stdout. Anything without parseable stdout is a real failure.
    if (error && typeof error.stdout === "string" && error.stdout.length > 0) {
      return error.stdout;
    }
    throw error;
  }
}

export function main() {
  const report = JSON.parse(runNpmAudit());
  const { ok, failures, allowed } = evaluateAudit(report);

  for (const entry of allowed) {
    console.log(
      `allowlisted: ${entry.name} (${entry.severity}) — ${entry.advisories
        .map((a) => a.id)
        .join(", ")}`
    );
  }

  if (!ok) {
    for (const entry of failures) {
      console.error(
        `FAIL: ${entry.name} (${entry.severity}) — ${entry.advisories
          .map((a) => `${a.id ?? "unknown-id"} ${a.title}`.trim())
          .join("; ")}`
      );
    }
    console.error(
      "High/critical advisories found outside the allowlist. Fix them or, if the only fix is a tracked major upgrade, extend ALLOWLISTED_ADVISORIES with justification."
    );
    process.exitCode = 1;
    return;
  }

  console.log("npm audit: no unallowlisted high/critical advisories.");
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  main();
}
