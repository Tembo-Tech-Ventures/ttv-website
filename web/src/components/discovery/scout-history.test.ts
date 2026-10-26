import { describe, it, expect } from "vitest";
import { readScoutLocation, scoutLocationUrl } from "./scout-history";
describe("scout history", () => {
  it("round trips only criteria and profile identifiers, keeping context out of URLs", () => {
    const location = {criteria:{skills:"React",query:"Amina",context:"Fictional opportunity"},step:"results" as const,profileId:"fictional-amina",lookup:false};
    const url = scoutLocationUrl(new URL("https://example.test/dashboard/discover?context=old"), location);
    expect(url.searchParams.has("context")).toBe(false);
    expect(url.toString()).not.toContain("Fictional opportunity");
    expect(readScoutLocation(url, {ttvScout:{context:location.criteria.context}})).toEqual(location);
  });
  it("bounds malformed input and ignores unrelated history data", () => {
    const restored = readScoutLocation(new URL(`https://example.test/?skills=${"a".repeat(500)}&profile=${"b".repeat(400)}&scout=other`), {token:"never-read",profile:{private:"never-read"},ttvScout:{context:55}});
    expect(restored.criteria.skills).toHaveLength(300);
    expect(restored.profileId).toHaveLength(200);
    expect(restored.criteria.context).toBe("");
    expect(restored.step).toBe("criteria");
    expect(JSON.stringify(restored)).not.toContain("never-read");
  });
});
