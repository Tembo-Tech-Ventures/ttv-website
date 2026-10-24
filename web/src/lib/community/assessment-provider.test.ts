import { afterEach, describe, expect, it, vi } from "vitest";
import { COMMUNITY_ASSESSMENT_MODEL, createAssessmentProvider } from "./assessment-provider";
const env = { AI_GATEWAY_MODEL: COMMUNITY_ASSESSMENT_MODEL, AI_GATEWAY_ACCOUNT_ID: "account", AI_GATEWAY_NAME: "gateway", AI_GATEWAY_API_KEY: "fictional" } as Env;
afterEach(() => vi.unstubAllGlobals());
describe("unified assessment provider", () => {
  it("uses only unified Gateway, exact reviewed model and bounded nonstreaming JSON prompt", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"criteria":[]}' } }] })); vi.stubGlobal("fetch", fetch);
    expect(await createAssessmentProvider(env).complete([{ role: "system", content: "JSON only" }], {})).toBe('{"criteria":[]}');
    const [url, options] = fetch.mock.calls[0]; expect(url).toBe("https://gateway.ai.cloudflare.com/v1/account/gateway/compat/chat/completions");
    expect(options.redirect).toBe("error"); expect(options.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(options.body); expect(body).toMatchObject({ model: COMMUNITY_ASSESSMENT_MODEL, max_completion_tokens: 3000, temperature: 0 });
    expect(body).not.toHaveProperty("response_format"); expect(body).not.toHaveProperty("tools");
  });
  it.each([undefined, { ...env, AI_GATEWAY_MODEL: "unreviewed" }, { ...env, AI_GATEWAY_API_KEY: "" }])("requires explicit reviewed configuration, no binding fallback", async config => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(createAssessmentProvider(config).complete([], {})).rejects.toThrow("configuration"); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{ refusal: "No" }, { content: "{}", refusal: "No" }])("does not treat refusal as assessment", async message => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ choices: [{ message, finish_reason: "stop" }] })));
    expect(await createAssessmentProvider(env).complete([], {})).toBe("");
  });
  it("rejects truncation and oversized output", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "{}" }, finish_reason: "length" }] })).mockResolvedValueOnce(new Response("x".repeat(64001))); vi.stubGlobal("fetch", fetch);
    expect(await createAssessmentProvider(env).complete([], {})).toBe(""); expect(await createAssessmentProvider(env).complete([], {})).toBe("");
  });
  it("does not retry failures or leak upstream error bodies", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("private upstream error", { status: 503 })); vi.stubGlobal("fetch", fetch);
    await expect(createAssessmentProvider(env).complete([], {})).rejects.toThrow("Assessment provider unavailable"); expect(fetch).toHaveBeenCalledOnce();
    fetch.mockRejectedValue(new DOMException("Timeout", "TimeoutError"));
    await expect(createAssessmentProvider(env).complete([], {})).rejects.toThrow("Timeout"); expect(fetch).toHaveBeenCalledTimes(2);
  });
});
