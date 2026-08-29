/** Shared shapes for the Ask AI chat UI and the endpoints that feed it. */

export interface Citation {
  sourceNumber?: number;
  recordingId: string;
  title: string;
  startTime: number;
  endTime: number;
  url?: string;
  text: string;
}

export interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  createdAt?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  /** Unix seconds. */
  updatedAt: number;
  messageCount: number;
  latestMessage: string | null;
}
