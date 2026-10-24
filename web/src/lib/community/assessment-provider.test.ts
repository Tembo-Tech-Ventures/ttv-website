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
  it.each([undefined, { ...env, AI_GATEWAY_ACCOUNT_ID: "" }, { ...env, AI_GATEWAY_API_KEY: "" }])("requires explicit Gateway configuration, no binding fallback", async config => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(createAssessmentProvider(config).complete([], {})).rejects.toThrow("configuration"); expect(fetch).not.toHaveBeenCalled();
  });
  it("pins community Gemma independently of the unrelated global model without mutating env", async () => {
    const globalEnv = {...env,AI_GATEWAY_MODEL:"workers-ai/@cf/openai/gpt-oss-20b"} as Env;
    const fetch = vi.fn().mockResolvedValue(Response.json({choices:[{message:{content:"{}"},finish_reason:"stop"}]})); vi.stubGlobal("fetch",fetch);
    await createAssessmentProvider(globalEnv).complete([],{});
    expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe(COMMUNITY_ASSESSMENT_MODEL);
    expect(globalEnv.AI_GATEWAY_MODEL).toBe("workers-ai/@cf/openai/gpt-oss-20b");
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
    await expect(createAssessmentProvider(env).complete([], {})).rejects.toThrow("Assessment provider unavailable"); expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("server-owned synthetic assessment probe", () => {
  const messages = (content: string) => [{ role: "user" as const, content }];
  function setup() {
    const fetch = vi.fn().mockImplementation(async () => Response.json({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }));
    vi.stubGlobal("fetch", fetch);
    const claim = vi.fn().mockResolvedValue(undefined);
    return { fetch, claim, provider: createAssessmentProvider(env, { syntheticProbe: { claim } }) };
  }
  it.each(["x".repeat(7900), '"'.repeat(4000), "界".repeat(3000)])("rejects oversized complete JSON before claiming or fetching", async content => {
    const { provider, fetch, claim } = setup();
    expect(content.length).toBeLessThanOrEqual(8000);
    await expect(provider.complete(messages(content), {})).rejects.toThrow("unavailable");
    await expect(provider.complete(messages("small"), {})).rejects.toThrow("unavailable");
    expect(claim).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("accepts exactly 8000 serialized units/bytes and rejects the next unit", async () => {
    const { fetch, claim } = setup();
    await createAssessmentProvider(env).complete(messages(""), {});
    const overhead = fetch.mock.calls[0][1].body.length;
    fetch.mockClear();
    const provider = createAssessmentProvider(env, { syntheticProbe: { claim } });
    await provider.complete(messages("x".repeat(8000 - overhead)), {});
    expect(claim).toHaveBeenCalledWith({ payloadCharacters: 8000, payloadBytes: 8000 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(claim.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[0]);
    fetch.mockClear(); claim.mockClear();
    await expect(createAssessmentProvider(env, { syntheticProbe: { claim } }).complete(messages("x".repeat(8001 - overhead)), {})).rejects.toThrow("unavailable");
    expect(claim).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("leaves ordinary payload limits and repeated ordinary calls unchanged", async () => {
    const { fetch, claim } = setup();
    const provider = createAssessmentProvider(env);
    await provider.complete(messages("x".repeat(9000)), {});
    await provider.complete(messages("x".repeat(9000)), {});
    expect(fetch).toHaveBeenCalledTimes(2); expect(claim).not.toHaveBeenCalled();
  });
  it("rejects a second completed probe without claiming or fetching again", async () => {
    const { provider, fetch, claim } = setup();
    await provider.complete(messages("Synthetic evidence"), {});
    await expect(provider.complete(messages("Synthetic evidence"), {})).rejects.toThrow("unavailable");
    expect(claim).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
  });
  it("excludes concurrent calls while the durable claim is pending", async () => {
    const { fetch, claim } = setup();
    let release!: () => void;
    claim.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const provider = createAssessmentProvider(env, { syntheticProbe: { claim } });
    const first = provider.complete(messages("Synthetic evidence"), {});
    await expect(provider.complete(messages("Synthetic evidence"), {})).rejects.toThrow("unavailable");
    expect(claim).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
    release(); await first;
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("cannot fetch when a durable claim fails, and never retries the claim", async () => {
    const { fetch, claim } = setup();
    claim.mockRejectedValue(new Error("fictional-private-claim-error"));
    const provider = createAssessmentProvider(env, { syntheticProbe: { claim } });
    const error = await provider.complete(messages("Synthetic evidence"), {}).catch(value => value);
    expect(error.message).toBe("Assessment provider unavailable."); expect(error.cause).toBeUndefined();
    await expect(provider.complete(messages("Synthetic evidence"), {})).rejects.toThrow("unavailable");
    expect(claim).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it("validates configuration before consuming the durable claim", async () => {
    const { fetch, claim } = setup();
    const provider = createAssessmentProvider(undefined, { syntheticProbe: { claim } });
    await expect(provider.complete(messages("small"), {})).rejects.toThrow("configuration");
    expect(claim).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["fetch", "parse", "read"])("sanitizes %s failure without retry, response content or cause", async kind => {
    const { provider, fetch, claim } = setup();
    const secret = "fictional-sensitive-error-detail";
    if (kind === "fetch") fetch.mockRejectedValue(new Error(secret, { cause: new Error(secret) }));
    if (kind === "parse") fetch.mockResolvedValue(new Response(secret));
    if (kind === "read") fetch.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.error(new Error(secret)); } })));
    const error = await provider.complete(messages("Synthetic evidence"), {}).catch(value => value);
    expect(error.message).toBe("Assessment provider unavailable."); expect(error.cause).toBeUndefined();
    expect(`${error}\n${error.stack}\n${JSON.stringify(error)}`).not.toContain(secret);
    await expect(provider.complete(messages("Synthetic evidence"), {})).rejects.toThrow("unavailable");
    expect(claim).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
  });
});
