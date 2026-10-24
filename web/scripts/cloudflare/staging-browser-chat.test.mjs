import { describe, expect, it } from "vitest";
import { validateBrowserChat } from "./staging-browser-chat.mjs";
const entries = [{ id: "entry", version: 1, confirmations: [{ id: "confirmation", journeyVersion: 1 }] }];
const result = () => ({ grounded: true, aiGenerated: true, limited: false, error: null, answer: "Documented contribution.", assessments: [], execution: { model: "@cf/zai-org/glm-5.3-flash", modelSteps: 2, executedToolCalls: 1 }, citations: [{ kind: "journey", id: "entry", version: 1, userId: "member" }] });
describe("browser chat verification", () => {
  it("accepts current same-person evidence and actual tool execution", () => {
    expect(validateBrowserChat(result(), "member", entries, 2)).toMatchObject({ citationCount: 1, modelSteps: 2, executedToolCalls: 1 });
  });
  it.each([{ version: 0 }, { id: "unknown" }, { userId: "other" }, { kind: "profile" }])("rejects stale or foreign citations %j", change => {
    const value = result(); Object.assign(value.citations[0], change);
    expect(() => validateBrowserChat(value, "member", entries, 2)).toThrow(/.*/);
  });
  it.each([{ executedToolCalls: 0 }, { executedToolCalls: 7 }, { modelSteps: 4 }, { model: "other" }])("rejects absent tool proof or exceeded bounds %j", change => {
    const value = result(); Object.assign(value.execution, change);
    expect(() => validateBrowserChat(value, "member", entries, 2)).toThrow(/.*/);
  });
  it("rejects ungrounded or assessment responses", () => {
    for (const change of [{ grounded: false }, { limited: true }, { assessments: [{}] }, { citations: [] }]) {
      expect(() => validateBrowserChat({ ...result(), ...change }, "member", entries, 2)).toThrow(/.*/);
    }
  });
});
