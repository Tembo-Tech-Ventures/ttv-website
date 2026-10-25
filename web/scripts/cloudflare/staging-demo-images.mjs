import { assertVerifiedStagingFixtureTarget } from "./staging-fixture-target.mjs";
import { buildDemoDataset } from "./staging-demo-data.mjs";

const rows = result => (Array.isArray(result) ? result : [result]).flatMap(item => item?.results ?? []);
export function buildDemoImageMapping(manifest) {
  if (manifest?.version !== 1 || manifest.synthetic !== true || !Array.isArray(manifest.portraits) || manifest.portraits.length !== 7 ||
      manifest.portraits.some((portrait, i) => portrait.src !== `/images/demo/portrait-${String(i + 1).padStart(2, "0")}.webp` || portrait.provenance !== "AI-generated" || typeof portrait.alt !== "string" || !portrait.alt.startsWith("AI-generated fictional"))) {
    throw new Error("Reviewed fictional portrait manifest required.");
  }
  return buildDemoDataset().user.map((user, i) => ({ id: user.id, email: user.email, image: manifest.portraits[i % 7].src }));
}

/** Explicit optional backfill; never overwrites a nonempty image or creates users. */
export async function seedDemoImages(target, manifest) {
  assertVerifiedStagingFixtureTarget(target);
  const mapping = buildDemoImageMapping(manifest);
  try {
    // Validate all existing identities before any mutation. Missing users stay absent.
    for (const user of mapping) {
      const existing = rows(await target.executeQuery('SELECT email FROM user WHERE id=?', [user.id]));
      if (existing.some(row => row.email !== user.email)) throw new Error();
    }
    for (const user of mapping) {
      await target.executeQuery('UPDATE user SET image=? WHERE id=? AND email=? AND (image IS NULL OR image=\'\')', [user.image, user.id, user.email]);
    }
    return { event: "retained-demo-images", considered: mapping.length, preservesNonempty: true, synthetic: true };
  } catch {
    throw new Error("Retained demo image mapping failed; no record values emitted.");
  }
}
