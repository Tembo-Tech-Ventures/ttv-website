import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { COMMUNITY_EVIDENCE_DIRECTORY as directory, COMMUNITY_EVIDENCE_FILES as files, ASSESSMENT_EVIDENCE_FILE } from "./staging-community-journey.mjs";

// Fixed paths only. Never publish arbitrary page contents, traces or caller metadata.
export async function discardCommunityEvidence() {
  await Promise.all([...files, ASSESSMENT_EVIDENCE_FILE].map(file => rm(join(directory, file), { force: true })));
}

// Call only after the complete persona lifecycle AND browser.close have succeeded.
export async function sealCommunityEvidence(expectedVersion) {
  if (!/^[a-f0-9]{40}$/.test(expectedVersion ?? "")) throw new Error("Evidence revision rejected.");
  for (const file of files) {
    const stat = await lstat(join(directory, file));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Evidence file rejected.");
  }
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  const assessed = manifest.modelCalls === "one-bounded-desktop-assessment";
  if (assessed) {
    if (!Number.isInteger(manifest.assessment?.rating) || manifest.assessment.rating < 1 || manifest.assessment.rating > 5 || !Number.isInteger(manifest.assessment?.citationCount) || manifest.assessment.citationCount < 1) throw new Error("Assessment evidence incomplete.");
    const image = await lstat(join(directory, ASSESSMENT_EVIDENCE_FILE));
    if (!image.isFile() || image.isSymbolicLink()) throw new Error("Evidence file rejected.");
  }
  if (manifest.status !== "passed" || manifest.synthetic !== true || manifest.verification !== "browser-actions-and-api-readback" ||
      JSON.stringify(manifest.completedViewports) !== '["desktop","mobile"]' || (!assessed && manifest.modelCalls !== "not-tested")) {
    throw new Error("Community journey evidence incomplete.");
  }
  // Rebuild rather than spread untrusted manifest fields into the published receipt.
  await writeFile(join(directory, "manifest.json"), JSON.stringify({
    schemaVersion: 1, synthetic: true, environment: "staging", deployedVersion: expectedVersion,
    status: "passed", verification: "browser-actions-and-api-readback", completedViewports: ["desktop", "mobile"],
    cleanup: "database-and-browser-passed", modelCalls: assessed ? "one-bounded-desktop-assessment" : "not-tested",
    ...(assessed ? { assessment: { rating: manifest.assessment.rating, citationCount: manifest.assessment.citationCount }, assessmentViewport: "desktop", chat: "not-tested" } : {}),
    caption: assessed ? "Synthetic desktop/mobile journeys; one desktop AI assessment. Mobile AI submission and chat not tested." : "Synthetic staging member, mentor and institution journeys; desktop and mobile. No model calls tested.",
    screenshots: [...files.filter(file => file.endsWith(".png")), ...(assessed ? [ASSESSMENT_EVIDENCE_FILE] : [])],
  }, null, 2) + "\n");
}
