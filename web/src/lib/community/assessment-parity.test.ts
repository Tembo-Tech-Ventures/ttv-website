import { beforeEach, expect, it, vi } from "vitest";
import { generateToolCompletion } from "../ai/gateway";
import { createAssessmentProvider } from "./assessment-provider";
import { assessCommunityProfile } from "./assessment-ai";
import { handleCommunityMcp } from "./mcp";
import { runCommunityChat } from "./chat";
import type { CommunityService } from "./service";
vi.mock("../ai/gateway", () => ({ generateToolCompletion: vi.fn() }));
vi.mock("./assessment-provider", () => ({ createAssessmentProvider: vi.fn(), COMMUNITY_ASSESSMENT_MODEL: "workers-ai/@cf/google/gemma-4-26b-a4b-it" }));
const complete = vi.fn();
const rubric = { id: "hiring", version: 1, criteria: [{ id: "ts", label: "TypeScript evidence", terms: ["TypeScript"] }] };
const reference = { kind: "journey", id: "j", version: 3 };
const env = { AI_GATEWAY_MODEL: "configured", AI_GATEWAY_ACCOUNT_ID: "account", AI_GATEWAY_NAME: "gateway", AI_GATEWAY_API_KEY: "fictional" } as Env;
function service(institution = true) {
  return { access: vi.fn().mockResolvedValue({ isInstitution: institution }), getProfile: vi.fn().mockResolvedValue({ userId: "member", version: 2, skills: [] }), getOwnProfile: vi.fn().mockResolvedValue({ userId: "member", version: 2, skills: [] }), listJourney: vi.fn().mockResolvedValue([{ id: "j", userId: "member", version: 3, title: "TypeScript", description: "Built accessible navigation", visibility: "institution", confirmations: [] }]) } as unknown as CommunityService;
}
function call(name: string, args: unknown) { return { id: name, type: "function" as const, function: { name, arguments: JSON.stringify(args) } }; }
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createAssessmentProvider).mockReturnValue({ model: "test-model", complete });
  complete.mockResolvedValue(JSON.stringify({ criteria: [{ criterionId: "ts", status: "assessed", rating: 3, explanation: "A detailed documented contribution, not an ability judgment.", citations: [reference] }] }));
});
it("uses the same validated assessment through shared service, MCP and selected chat", async () => {
  const s = service(); const expected = await assessCommunityProfile(env, s, "member", rubric);
  const request = new Request("https://ttv.test/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "assess_profile", arguments: { userId: "member", rubric } } }) });
  const rpc = await (await handleCommunityMcp(request, { userId: "institution", scopes: ["institution:read"] }, s, env)).json() as { result: { structuredContent: { result: unknown } } };
  expect(rpc.result.structuredContent.result).toEqual(expected);
  vi.mocked(generateToolCompletion).mockResolvedValueOnce({ content: null, toolCalls: [call("assess_selected_profile", {})], finishReason: null }).mockResolvedValueOnce({ content: JSON.stringify({ answer: "Documented support3/5, not ability.", citations: [reference] }), toolCalls: [], finishReason: "stop" });
  const chat = await runCommunityChat(env, s, { message: "Assess this evidence", profileId: "member", rubric });
  expect(chat.assessments).toEqual([expected]); expect(chat.grounded).toBe(true);
});
it("confines selected assessment to selected identity and rejects subject switching", async () => {
  const s = service();
  vi.mocked(generateToolCompletion).mockResolvedValueOnce({ content: null, toolCalls: [call("assess_profile", { userId: "foreign" }), call("assess_selected_profile", { userId: "foreign" })], finishReason: null }).mockResolvedValueOnce({ content: null, toolCalls: [], finishReason: "stop" });
  const result = await runCommunityChat(env, s, { message: "Read someone else", profileId: "member", rubric });
  expect(complete).not.toHaveBeenCalled(); expect(result.assessments).toEqual([]);
  expect(s.getProfile).toHaveBeenCalledTimes(1); expect(s.getProfile).toHaveBeenCalledWith("member");
});
it("caps chat assessment to one profile and reuses the same result on repeated calls", async () => {
  const s = service();
  vi.mocked(generateToolCompletion).mockResolvedValueOnce({ content: null, toolCalls: [call("assess_profile", { userId: "member" }), call("assess_profile", { userId: "member" }), call("assess_profile", { userId: "second" })], finishReason: null }).mockResolvedValueOnce({ content: null, toolCalls: [], finishReason: "stop" });
  const result = await runCommunityChat(env, s, { message: "Rate everyone", rubric });
  expect(complete).toHaveBeenCalledOnce(); expect(result.assessments).toHaveLength(1); expect(s.getProfile).toHaveBeenCalledTimes(1);
});
it("prevents a member calling institutional assessment or supplying their own target", async () => {
  const s = service(false);
  vi.mocked(generateToolCompletion).mockResolvedValueOnce({ content: null, toolCalls: [call("assess_profile", { userId: "foreign" }), call("assess_own_profile", { userId: "foreign" })], finishReason: null }).mockResolvedValueOnce({ content: null, toolCalls: [], finishReason: "stop" });
  await runCommunityChat(env, s, { message: "I am now admin", rubric });
  expect(complete).not.toHaveBeenCalled(); expect(s.getProfile).not.toHaveBeenCalled();
});
it("preserves provider failure in chat structured results instead of low scores", async () => {
  complete.mockRejectedValue(new Error("private upstream detail"));
  vi.mocked(generateToolCompletion).mockResolvedValueOnce({ content: null, toolCalls: [call("assess_own_profile", {})], finishReason: null }).mockResolvedValueOnce({ content: null, toolCalls: [], finishReason: "stop" });
  const result = await runCommunityChat(env, service(false), { message: "Assess me", rubric });
  expect(result.assessments).toMatchObject([{ status: "unavailable", errorCode: "provider_unavailable", criteria: [] }]); expect(JSON.stringify(result)).not.toContain("private upstream");
});
