const MODEL = "workers-ai/@cf/google/gemma-4-26b-a4b-it";

/** Runner-only transport guard. A rejected attempt consumes the one-shot budget too. */
export function createAssessmentFetchBudget({ endpoint, fetchImpl = fetch, timeout = globalThis.AbortSignal.timeout }) {
  const url = new URL(endpoint);
  if (url.origin !== "https://gateway.ai.cloudflare.com" ||
      !/^\/v1\/[a-f0-9]{32}\/ttv-website-ai-staging\/compat\/chat\/completions$/.test(url.pathname) ||
      url.search || url.hash || url.username || url.password) throw new Error("Invalid staging assessment endpoint.");
  let attempted = false;
  let calls = 0;
  let payloadCharacters = 0;
  return {
    snapshot: () => ({ calls, payloadCharacters, model: MODEL, timeoutMs: 20000, outputTokenLimit: 3000, usage: "unavailable", billing: "unavailable" }),
    async fetch(input, options) {
      if (attempted) throw new Error("Assessment attempt budget exhausted.");
      attempted = true;
      if (input !== endpoint || options?.method !== "POST" || options.redirect !== "error" ||
          typeof options.body !== "string" || options.body.length > 8000) throw new Error("Assessment request rejected.");
      let body;
      try { body = JSON.parse(options.body); } catch { throw new Error("Assessment request rejected."); }
      const keys = Object.keys(body ?? {}).toSorted().join(",");
      if (keys !== "chat_template_kwargs,max_completion_tokens,messages,model,temperature" ||
          body.model !== MODEL || body.max_completion_tokens !== 3000 || body.temperature !== 0 ||
          JSON.stringify(body.chat_template_kwargs) !== '{"enable_thinking":false}' ||
          !Array.isArray(body.messages) || body.messages.length !== 2 ||
          body.messages.some((message, i) => message?.role !== ["system", "user"][i] || typeof message.content !== "string" || Object.keys(message).toSorted().join(",") !== "content,role")) {
        throw new Error("Assessment request rejected.");
      }
      payloadCharacters = options.body.length;
      calls += 1;
      // Override the signal so even a caller regression cannot remove the deadline.
      return fetchImpl(endpoint, { ...options, signal: timeout(20000) });
    },
  };
}
