import { describe, expect, it, vi } from "vitest";
import { createAssessmentFetchBudget } from "./staging-assessment-budget.mjs";

const endpoint = `https://gateway.ai.cloudflare.com/v1/${"a".repeat(32)}/ttv-website-ai-staging/compat/chat/completions`;
const body = () => ({ model: "workers-ai/@cf/google/gemma-4-26b-a4b-it", messages: [{ role: "system", content: "Rules" }, { role: "user", content: "Synthetic evidence" }], temperature: 0, max_completion_tokens: 3000, chat_template_kwargs: { enable_thinking: false } });
const request = value => ({ method: "POST", redirect: "error", body: JSON.stringify(value) });
function setup() {
  const fetchImpl = vi.fn().mockResolvedValue(new Response("{}"));
  const signal = new globalThis.AbortController().signal;
  const timeout = vi.fn(() => signal);
  return { fetchImpl, timeout, signal, guard: createAssessmentFetchBudget({ endpoint, fetchImpl, timeout }) };
}
describe("one-shot staging assessment transport", () => {
  it("permits one bounded request and imposes the deadline", async () => {
    const { guard, fetchImpl, timeout, signal } = setup();
    await guard.fetch(endpoint, request(body()));
    expect(timeout).toHaveBeenCalledWith(20000);
    expect(fetchImpl).toHaveBeenCalledWith(endpoint, expect.objectContaining({ signal }));
    await expect(guard.fetch(endpoint, request(body()))).rejects.toThrow("budget exhausted");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(guard.snapshot()).toMatchObject({ calls: 1, usage: "unavailable", billing: "unavailable" });
  });
  it("does not retry a failed underlying fetch", async () => {
    const { guard, fetchImpl } = setup();
    fetchImpl.mockRejectedValue(new Error("network"));
    await expect(guard.fetch(endpoint, request(body()))).rejects.toThrow("network");
    await expect(guard.fetch(endpoint, request(body()))).rejects.toThrow("budget exhausted");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("checks the complete serialized envelope, including escaped content", async () => {
    const { guard, fetchImpl } = setup();
    const value = body();
    value.messages[1].content = '"'.repeat(4000);
    await expect(guard.fetch(endpoint, request(value))).rejects.toThrow("Assessment request rejected.");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(guard.snapshot().calls).toBe(0);
  });
  it.each([
    value => { value.max_completion_tokens = 3001; },
    value => { value.model = "another-model"; },
    value => { value.stream = true; },
    value => { value.chat_template_kwargs.enable_thinking = true; },
    value => { value.messages.push({ role: "tool", content: "extra" }); },
  ])("rejects changed provider limits or shape without inference", async change => {
    const { guard, fetchImpl } = setup();
    const value = body(); change(value);
    await expect(guard.fetch(endpoint, request(value))).rejects.toThrow("Assessment request rejected.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([endpoint.replace("staging", "production"), endpoint.replace("gateway.ai.cloudflare.com", "example.org"), endpoint + "?redirect=1"])("rejects other targets", url => {
    expect(() => createAssessmentFetchBudget({ endpoint: url })).toThrow("Invalid staging assessment endpoint.");
  });
  it("rejects redirects and alternate fetch URLs", async () => {
    for (const [url, options] of [[endpoint, { ...request(body()), redirect: "follow" }], [endpoint + "/", request(body())]]) {
      const { guard, fetchImpl } = setup();
      await expect(guard.fetch(url, options)).rejects.toThrow("Assessment request rejected.");
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });
});
