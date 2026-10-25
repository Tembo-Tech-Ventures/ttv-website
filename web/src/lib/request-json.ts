export class RequestJsonError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

/** Bound actual streamed bytes, regardless of an absent or misleading Content-Length. */
export async function readBoundedJson(request: Request, maxBytes = 32_000): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new RequestJsonError("Send a JSON object.");
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new RequestJsonError("Request too large.", 413);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  try { return JSON.parse(text) as unknown; }
  catch { throw new RequestJsonError("Send a JSON object."); }
}
