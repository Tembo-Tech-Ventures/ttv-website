import { useEffect, useRef, useState } from "react";
import TimestampBadge from "@/components/recordings/TimestampBadge";

interface Citation {
  recordingId: string;
  title: string;
  startTime: number;
  endTime: number;
  text: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || loading) return;

    setInput("");
    setLoading(true);
    setError("");
    const nextMessages: Message[] = [...messages, { role: "user", content: message }];
    setMessages(nextMessages);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, conversationHistory: nextMessages.slice(-6) }),
      });
      const payload = (await response.json()) as {
        error?: string;
        answer: string;
        citations: Citation[];
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to send message");
      }
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: payload.answer,
          citations: payload.citations,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send message");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] flex-col rounded-md border border-teal/20 bg-dark/35">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-white/50">
            Ask about recorded sessions, topics, or moments you want to revisit.
          </div>
        ) : (
          messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-md px-4 py-3 text-sm leading-relaxed ${
                  message.role === "user"
                    ? "bg-primary text-dark"
                    : "bg-teal/25 text-white"
                }`}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                {message.citations && message.citations.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {message.citations.map((citation, citationIndex) => (
                      <div
                        key={`${citation.recordingId}-${citation.startTime}-${citationIndex}`}
                        className="rounded-md border border-primary/20 bg-dark/35 p-3"
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <TimestampBadge
                            seconds={citation.startTime}
                            href={`/dashboard/sessions/${citation.recordingId}?t=${Math.floor(citation.startTime)}`}
                          />
                          <span className="text-xs font-semibold text-white/75">
                            {citation.title}
                          </span>
                        </div>
                        <p className="line-clamp-2 text-xs text-white/55">
                          {citation.text}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        {loading && <p className="text-sm text-white/45">Thinking...</p>}
        {error && <p className="text-sm text-red-200">{error}</p>}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={sendMessage} className="flex gap-3 border-t border-teal/20 p-4">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask a question"
          className="min-w-0 flex-1 rounded-md border border-teal bg-dark/60 px-3 py-2 text-white placeholder:text-white/35 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-dark hover:bg-primary/90 disabled:opacity-60"
        >
          Send
        </button>
      </form>
    </div>
  );
}
