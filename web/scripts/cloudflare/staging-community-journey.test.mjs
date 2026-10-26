import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { assertJourneyScope, assertSavedEntry, assertSavedConfirmation, verifyStagingCommunityJourney, COMMUNITY_EVIDENCE_DIRECTORY } from "./staging-community-journey.mjs";
const member = "ttv-staging-fixture-aaaaaaaaaaaaaaaaaaaaaaaa-member";
const mentor = "ttv-staging-fixture-aaaaaaaaaaaaaaaaaaaaaaaa-mentor";
const entry = () => ({ id: "synthetic-entry", userId: member, title: "Fictional keyboard navigation · desktop", description: "Synthetic contribution: I built and tested keyboard navigation for a fictional community library.", evidenceUrl: "https://example.com/fictional-library", visibility: "institution", occurredAt: "2026-10-24", version: 1, confirmations: [{ journeyId: "synthetic-entry", mentorId: mentor, mentorRole: "MENTOR", journeyVersion: 1, statement: "Synthetic review: I checked the fictional keyboard navigation contribution; this is not a real endorsement.", method: "Synthetic walkthrough of the fictional library example" }] });
function scope() {
  return { baseUrl: "https://staging.tembotechventures.com", contextsByRole: Object.fromEntries(["member", "mentor", "institution"].map(role => [role, {}])), users: Object.fromEntries(["member", "mentor", "institution"].map(role => [role, { userId: `ttv-staging-fixture-aaaaaaaaaaaaaaaaaaaaaaaa-${role}` }])) };
}
describe("synthetic journey provenance gates", () => {
  it("accepts only the fixed origin and same-run synthetic role IDs", () => {
    expect(() => assertJourneyScope(scope())).not.toThrow(/.*/);
    for (const baseUrl of ["https://tembotechventures.com", "https://staging.tembotechventures.com.evil.test", "http://staging.tembotechventures.com"]) expect(() => assertJourneyScope({ ...scope(), baseUrl })).toThrow(/.*/);
    for (const id of ["real-member", "ttv-staging-fixture-bbbbbbbbbbbbbbbbbbbbbbbb-member", mentor]) {
      const candidate = scope(); candidate.users.member.userId = id;
      expect(() => assertJourneyScope(candidate)).toThrow(/.*/);
    }
  });
  it("requires persisted exact contribution content, visibility, owner and version", () => {
    expect(() => assertSavedEntry(entry(), member, entry().title)).not.toThrow(/.*/);
    for (const change of [{ userId: "another-user" }, { visibility: "private" }, { version: 2 }, { evidenceUrl: "https://example.com/wrong" }, { title: "wrong" }, { description: "unsaved" }, { id: "" }]) expect(() => assertSavedEntry({ ...entry(), ...change }, member, entry().title)).toThrow(/.*/);
  });
  it("rejects stale, misattributed, duplicate or weakened confirmations", () => {
    expect(() => assertSavedConfirmation(entry(), mentor)).not.toThrow(/.*/);
    for (const change of [{ mentorId: "other" }, { journeyId: "wrong" }, { mentorRole: "UNKNOWN" }, { journeyVersion: 0 }, { statement: "wrong" }, { method: "wrong" }]) expect(() => assertSavedConfirmation({ ...entry(), confirmations: [{ ...entry().confirmations[0], ...change }] }, mentor)).toThrow(/.*/);
    for (const confirmations of [[], [...entry().confirmations, ...entry().confirmations]]) expect(() => assertSavedConfirmation({ ...entry(), confirmations }, mentor)).toThrow(/.*/);
  });
  it("rejects arbitrary output directories before requests", async () => {
    await expect(verifyStagingCommunityJourney({ ...scope(), evidenceDirectory: "/tmp/arbitrary" })).rejects.toThrow("directory rejected");
  });
  it("closes every created page even when navigation and one close fail", async () => {
    const options = scope();
    const pages = [];
    for (const role of ["member", "mentor", "institution"]) {
      options.contextsByRole[role] = {
        request: { get: async () => ({ status: () => 200, json: async () => ({ profile: { userId: options.users[role].userId, name: "Fictional person" } }) }) },
        newPage: async () => {
          const page = { setDefaultTimeout: vi.fn(), setViewportSize: vi.fn(), goto: vi.fn(async () => { throw new Error("private page failure"); }), close: vi.fn(async () => { if (role === "member") throw new Error("private close failure"); }) };
          pages.push(page); return page;
        },
      };
    }
    await expect(verifyStagingCommunityJourney(options)).rejects.toThrow("inspect sanitized manifest");
    expect(pages).toHaveLength(3);
    expect(pages.every(page => page.close.mock.calls.length === 1)).toBe(true);
    const manifest = await readFile(`${COMMUNITY_EVIDENCE_DIRECTORY}/manifest.json`, "utf8");
    expect(JSON.parse(manifest)).toMatchObject({ status: "failed", failureStage: "page-cleanup" });
    expect(manifest).not.toContain("private");
    await rm(COMMUNITY_EVIDENCE_DIRECTORY, { recursive: true, force: true });
  });
  it("writes only a fixed failure code for sensitive API errors, never screenshots", async () => {
    await mkdir(COMMUNITY_EVIDENCE_DIRECTORY, { recursive: true });
    await writeFile(`${COMMUNITY_EVIDENCE_DIRECTORY}/desktop-member.png`, "stale capture");
    const options = scope();
    const get = vi.fn(async () => { throw new Error("private response and bearer credential"); });
    options.contextsByRole.member.request = { get };
    await expect(verifyStagingCommunityJourney(options)).rejects.toThrow("inspect sanitized manifest");
    const manifest = await readFile(`${COMMUNITY_EVIDENCE_DIRECTORY}/manifest.json`, "utf8");
    expect(JSON.parse(manifest)).toMatchObject({ status: "failed", failureStage: "identity", completedViewports: [] });
    expect(manifest).not.toMatch(/private response|bearer credential/);
    await expect(readFile(`${COMMUNITY_EVIDENCE_DIRECTORY}/desktop-member.png`)).rejects.toThrow(/ENOENT/);
    expect(get).toHaveBeenCalledWith("/api/community/profile", { maxRedirects: 0 });
    await rm(COMMUNITY_EVIDENCE_DIRECTORY, { recursive: true, force: true });
  });
});
