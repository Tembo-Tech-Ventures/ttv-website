import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("node:fs/promises", () => ({ lstat: vi.fn(), readFile: vi.fn(), rm: vi.fn(), writeFile: vi.fn() }));
import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import { discardCommunityEvidence, sealCommunityEvidence } from "./staging-community-evidence.mjs";
const sha = "a".repeat(40);
const valid = { status: "passed", synthetic: true, verification: "browser-actions-and-api-readback", completedViewports: ["desktop", "mobile"], modelCalls: "not-tested", privateData: "must never publish" };
beforeEach(() => { vi.resetAllMocks(); lstat.mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false }); readFile.mockResolvedValue(JSON.stringify(valid)); });
describe("community evidence publication boundary", () => {
  it("rebuilds a fixed manifest with exact revision and cleanup receipt", async () => {
    await sealCommunityEvidence(sha);
    const [path, content] = writeFile.mock.calls[0];
    expect(path).toBe("test-results/staging-community/manifest.json");
    expect(JSON.parse(content)).toMatchObject({ deployedVersion: sha, cleanup: "database-and-browser-passed", synthetic: true });
    expect(JSON.parse(content).screenshots).toHaveLength(8);
    expect(content).not.toContain("must never publish");
    expect(lstat).toHaveBeenCalledTimes(9);
  });
  it("seals optional desktop assessment with bounded metadata and separate mobile/chat limits", async () => {
    readFile.mockResolvedValue(JSON.stringify({ ...valid, modelCalls: "one-bounded-desktop-assessment", assessment: { rating: 3, citationCount: 1, secret: "private" } }));
    await sealCommunityEvidence(sha);
    const receipt = JSON.parse(writeFile.mock.calls[0][1]);
    expect(receipt).toMatchObject({ assessment: { rating: 3, citationCount: 1 }, assessmentViewport: "desktop", chat: "not-tested" });
    expect(receipt.screenshots).toContain("desktop-assessment.png");
    expect(JSON.stringify(receipt)).not.toContain("private");
  });
  it("rejects an assessment receipt with no citations", async () => {
    readFile.mockResolvedValue(JSON.stringify({ ...valid, modelCalls: "one-bounded-desktop-assessment", assessment: { rating: 3, citationCount: 0 } }));
    await expect(sealCommunityEvidence(sha)).rejects.toThrow("incomplete");
  });
  it("rejects malformed revisions before filesystem access", async () => {
    await expect(sealCommunityEvidence("wrong")).rejects.toThrow("revision"); expect(lstat).not.toHaveBeenCalled();
  });
  it("rejects symlink or missing evidence without sealing", async () => {
    lstat.mockResolvedValueOnce({ isFile: () => true, isSymbolicLink: () => true });
    await expect(sealCommunityEvidence(sha)).rejects.toThrow("file rejected");
    lstat.mockRejectedValueOnce(new Error("missing"));
    await expect(sealCommunityEvidence(sha)).rejects.toThrow("missing"); expect(writeFile).not.toHaveBeenCalled();
  });
  it.each([{ status: "failed" }, { synthetic: false }, { completedViewports: ["desktop"] }, { modelCalls: "tested" }, { verification: "mock" }])("rejects incomplete provenance: %j", async change => {
    readFile.mockResolvedValue(JSON.stringify({ ...valid, ...change }));
    await expect(sealCommunityEvidence(sha)).rejects.toThrow("incomplete"); expect(writeFile).not.toHaveBeenCalled();
  });
  it("discards only the fixed evidence files including optional assessment", async () => {
    await discardCommunityEvidence(); expect(rm).toHaveBeenCalledTimes(10);
    expect(rm.mock.calls.every(([path, options]) => path.startsWith("test-results/staging-community/") && options.force && !options.recursive)).toBe(true);
  });
});
