import { expect, it } from "vitest";
import { assessEvidence } from "./assessment";
import type { CommunityJourney, CommunityProfile } from "./model";
const p = { userId: "u", version: 2 } as CommunityProfile;
const j = { id: "j", userId: "u", title: "TypeScript app", description: "Built app", visibility: "institution", version: 3, confirmations: [] } as unknown as CommunityJourney;
const rubric = { id: "r", version: 4, criteria: [{ id: "ts", label: "TypeScript evidence", terms: ["TypeScript"], contraryTerms: ["no TypeScript"] }] };
it("preserves rubric/source versions without a personal score", () => {
 const r = assessEvidence(p, [j], rubric);
 expect(r.rubric.version).toBe(4); expect(r.criteria[0]).toMatchObject({ status: "supported", citations: [{ id: "j", version: 3 }] }); expect(r).not.toHaveProperty("score");
});
it("excludes private and other-member contributions", () => {
 expect(assessEvidence(p, [{ ...j, visibility: "private" }, { ...j, userId: "other" }], rubric).criteria[0]).toMatchObject({ status: "insufficient", citations: [] });
});
it("separates contradiction, uncertainty and absence", () => {
 expect(assessEvidence(p, [{ ...j, description: "no TypeScript" }], rubric).criteria[0].status).toBe("contradictory");
 expect(assessEvidence(p, [{ ...j, confirmations: [{ journeyVersion: 1 } as CommunityJourney["confirmations"][number]] }], rubric).criteria[0].status).toBe("uncertain");
 expect(assessEvidence(p, [], rubric).criteria[0].status).toBe("insufficient");
});
it("rejects invalid versions and duplicate criterion IDs", () => {
 expect(() => assessEvidence(p, [], { ...rubric, version: 0 })).toThrow(/greater|positive|small/i);
 expect(() => assessEvidence(p, [], { ...rubric, criteria: [rubric.criteria[0], rubric.criteria[0]] })).toThrow("Criterion IDs must be unique.");
});
