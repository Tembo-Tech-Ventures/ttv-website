export const NEW_CONVERSATION_TITLE = "New conversation";
export const CHAT_STREAM_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

export interface ChatCitation {
  recordingId: string;
  title: string;
  startTime: number;
  endTime: number;
  text: string;
}

export interface ChatConversationView {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: ChatCitation[];
  createdAt: string;
}

export type RetrievalStatus = "grounded" | "general" | "unavailable";

export type ChatStreamEvent =
  | {
      type: "metadata";
      conversation: ChatConversationView;
      userMessage: ChatMessageView;
      citations: ChatCitation[];
      retrievalStatus: RetrievalStatus;
    }
  | { type: "delta"; content: string }
  | { type: "done"; message: ChatMessageView }
  | { type: "error"; error: string };
