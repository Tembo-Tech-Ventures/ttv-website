import { afterEach, describe, expect, it, vi } from "vitest";
import { generateToolCompletion, runCommunityModel } from "./native-gateway";
const call = { id: "c1", type: "function", function: { name: "get_own_profile", arguments: "{}" } };
const response = (message: unknown, finish_reason = "stop") => Response.json({ choices: [{ message, finish_reason }] });
function setup() {
  const run = vi.fn(); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  return { run, fetch, env: { AI: { run }, AI_GATEWAY_NAME: "ttv-staging", AI_GATEWAY_API_KEY: "must-not-use", AI_GATEWAY_MODEL: "other" } as unknown as Env };
}
afterEach(() => vi.unstubAllGlobals());
describe("community native Gateway transport", () => {
  it("uses explicit binding routing with timeout/cache/log/retry controls and no HTTP key", async () => {
    const { run, fetch, env } = setup(); run.mockResolvedValue(response({ content: "{}" }));
    await generateToolCompletion(env, [{ role: "user", content: "my evidence" }], {});
    expect(run).toHaveBeenCalledExactlyOnceWith("@cf/google/gemma-4-26b-a4b-it", expect.objectContaining({ stream: false, max_completion_tokens: 1200, chat_template_kwargs: { enable_thinking: false } }), {
      returnRawResponse: true, signal: expect.any(AbortSignal), gateway: { id: "ttv-staging", skipCache: true, collectLog: false, requestTimeoutMs: 20000, retries: { maxAttempts: 1 } },
    });
    expect(JSON.stringify(run.mock.calls)).not.toContain("must-not-use"); expect(fetch).not.toHaveBeenCalled();
  });
  it("roundtrips model tool IDs, arguments and authorized tool-result messages", async () => {
    const { run, env } = setup(); run.mockResolvedValueOnce(response({ content: null, tool_calls: [call] }, "tool_calls")).mockResolvedValueOnce(response({ content: '{"answer":"documented","citations":[]}' }));
    const tools = [{type:"function" as const,function:{name:"get_own_profile",description:"Own evidence",parameters:{type:"object"}}}];
    const first = await generateToolCompletion(env, [], {tools});
    expect(first.toolCalls).toEqual([call]);
    const messages = [{role:"assistant" as const,content:first.content,tool_calls:first.toolCalls},{role:"tool" as const,tool_call_id:"c1",content:"authorized evidence"}];
    expect((await generateToolCompletion(env, messages, {tools})).toolCalls).toEqual([]);
    expect(run.mock.calls[1][1]).toMatchObject({ messages,tools,tool_choice:"auto" });
  });
  it.each([
    {message:{tool_calls:[{name:"get_own_profile",arguments:{}}]},reason:"tool_calls"},
    {message:{tool_calls:[call,call]},reason:"tool_calls"},
    {message:{tool_calls:[call]},reason:"stop"},
    {message:{content:"{}"},reason:"length"},
    {message:{content:"{}",refusal:"refused"},reason:"stop"},
    {message:{content:"{}"},reason:"tool_calls"},
  ])("fails closed on malformed, truncated or refused completions %#", async ({message,reason}) => {
    const {run,env}=setup();run.mockResolvedValue(response(message,reason));
    await expect(generateToolCompletion(env,[],{})).rejects.toThrow(/Community model/);expect(run).toHaveBeenCalledOnce();
  });
  it.each(["error","oversize","non-response","invalid-json"])("sanitizes %s without fallback",async kind=>{
    const {run,fetch,env}=setup();
    if(kind==="error")run.mockRejectedValue(new Error("private detail"));
    if(kind==="oversize")run.mockResolvedValue(new Response("x".repeat(64001)));
    if(kind==="non-response")run.mockResolvedValue({response:"private detail"});
    if(kind==="invalid-json")run.mockResolvedValue(new Response("private detail"));
    await expect(runCommunityModel(env,{})).rejects.toThrow("Community model unavailable.");
    expect(run).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();
  });
  it("forwards the deadline signal and sanitizes abort without retry",async()=>{
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal,"timeout").mockReturnValue(controller.signal);
    try {
      const {run,env}=setup();
      run.mockImplementation((_model,_input,options)=>new Promise((_resolve,reject)=>{
        options.signal.addEventListener("abort",()=>reject(new DOMException("private timeout","TimeoutError")),{once:true});
      }));
      const result=runCommunityModel(env,{}).catch(error=>error);
      controller.abort();expect(await result).toMatchObject({message:"Community model unavailable."});
      expect(timeout).toHaveBeenCalledWith(20000);expect(run).toHaveBeenCalledOnce();
    } finally {timeout.mockRestore();}
  });
});
