import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { COMMUNITY_EVIDENCE_DIRECTORY as directory, COMMUNITY_EVIDENCE_FILES as files } from "./staging-community-journey.mjs";

// Fixed paths only. Never publish arbitrary page contents, traces or caller metadata.
export async function discardCommunityEvidence() {
  await Promise.all(files.map(file => rm(join(directory, file), { force: true })));
}

// Call only after the complete persona lifecycle AND browser.close have succeeded.
export async function sealCommunityEvidence(expectedVersion) {
  if (!/^[a-f0-9]{40}$/.test(expectedVersion ?? "")) throw new Error("Evidence revision rejected.");
  for (const file of files) {
    const stat = await lstat(join(directory, file));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Evidence file rejected.");
  }
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  if (manifest.status !== "passed" || manifest.synthetic !== true || manifest.verification !== "browser-actions-and-api-readback" ||
      JSON.stringify(manifest.completedViewports) !== '["desktop","mobile"]' || manifest.modelCalls !== "not-tested") {
    throw new Error("Community journey evidence incomplete.");
  }
  // Rebuild rather than spread untrusted manifest fields into the published receipt.
  await writeFile(join(directory, "manifest.json"), JSON.stringify({
    schemaVersion: 1, synthetic: true, environment: "staging", deployedVersion: expectedVersion,
    status: "passed", verification: "browser-actions-and-api-readback", completedViewports: ["desktop", "mobile"],
    cleanup: "database-and-browser-passed", modelCalls: "not-tested",
    caption: "Synthetic staging member, mentor and institution journeys; desktop and mobile. No model calls tested.",
    screenshots: files.filter(file => file.endsWith(".png")),
  }, null, 2) + "\n");
}
