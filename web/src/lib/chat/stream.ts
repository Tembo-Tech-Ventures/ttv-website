import {
  chatStreamEventSchema,
  openAiStreamChunkSchema,
} from "@/lib/chat/client-contracts";
import type { ChatStreamEvent } from "@/lib/chat/types";

const encoder = new TextEncoder();

export class ChatStreamProtocolError extends Error {
  override readonly name = "ChatStreamProtocolError";
}

export function encodeChatStreamEvent(event: ChatStreamEvent): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

export async function consumeOpenAiStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onDelta: (content: string) => void
): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) return;
    if (!trimmed.startsWith("data:")) return;

    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;

    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch (error) {
      throw new ChatStreamProtocolError(
        `AI Gateway returned malformed stream data: ${error instanceof Error ? error.message : "invalid JSON"}`
      );
    }

    const parsed = openAiStreamChunkSchema.safeParse(value);
    if (!parsed.success) {
      throw new ChatStreamProtocolError(
        "AI Gateway returned a stream chunk with an invalid shape."
      );
    }

    const content = parsed.data.choices?.[0]?.delta?.content;
    if (content) {
      answer += content;
      onDelta(content);
    }
  };

  for (let result = await reader.read(); !result.done; result = await reader.read()) {
    buffer += decoder.decode(result.value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) consumeLine(line);
  }

  buffer += decoder.decode();
  consumeLine(buffer);
  return answer;
}

export async function consumeChatStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void
): Promise<boolean> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedDone = false;

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new ChatStreamProtocolError(
        `Chat API returned malformed stream data: ${error instanceof Error ? error.message : "invalid JSON"}`
      );
    }
    const parsed = chatStreamEventSchema.safeParse(value);
    if (!parsed.success) {
      throw new ChatStreamProtocolError(
        "Chat API returned a stream event with an invalid shape."
      );
    }
    const event: ChatStreamEvent = parsed.data;
    if (event.type === "done") receivedDone = true;
    onEvent(event);
  };

  for (let result = await reader.read(); !result.done; result = await reader.read()) {
    buffer += decoder.decode(result.value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) consumeLine(line);
  }

  buffer += decoder.decode();
  consumeLine(buffer);
  return receivedDone;
}
