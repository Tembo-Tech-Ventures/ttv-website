import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatSources } from "@/components/recordings/ChatSources";
import type { ChatMessageView } from "@/lib/chat/types";

const markdownComponents: Components = {
  a: ({ children, href }) => (
    <a
      href={href}
      className="font-semibold text-primary underline decoration-primary/35 underline-offset-4 hover:decoration-primary"
      rel="noreferrer"
      target={href?.startsWith("http") ? "_blank" : undefined}
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-primary/60 pl-4 text-white/65">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => (
    <code
      className={`${className ?? ""} rounded bg-black/25 px-1.5 py-0.5 font-mono text-[0.88em] text-[#ffd8ca]`}
    >
      {children}
    </code>
  ),
  h1: ({ children }) => <h3 className="mt-5 text-lg font-bold">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-5 text-base font-bold">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-4 font-bold">{children}</h4>,
  ol: ({ children }) => <ol className="ml-5 list-decimal space-y-1">{children}</ol>,
  p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-xl border border-white/10 bg-[#002c29] p-4 text-sm">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  td: ({ children }) => <td className="border border-white/10 p-2">{children}</td>,
  th: ({ children }) => (
    <th className="border border-white/10 bg-white/5 p-2 font-semibold">{children}</th>
  ),
  ul: ({ children }) => <ul className="ml-5 list-disc space-y-1">{children}</ul>,
};

interface ChatMessageProps {
  message: ChatMessageView;
}

export const ChatMessage = memo(function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <article
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
      aria-label={`${isUser ? "You" : "TTV Learning Coach"}: ${message.content}`}
    >
      <div
        className={`max-w-[92%] rounded-2xl px-4 py-3 text-[0.95rem] leading-7 sm:max-w-[82%] sm:px-5 ${
          isUser
            ? "rounded-br-sm bg-primary text-[#003936] shadow-[0_12px_32px_rgba(0,0,0,0.12)]"
            : "rounded-bl-sm border border-white/10 bg-[#064a45]/90 text-white shadow-[0_18px_50px_rgba(0,0,0,0.14)]"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap font-medium">{message.content}</p>
        ) : (
          <div className="space-y-3">
            <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}
        {!isUser && <ChatSources citations={message.citations} />}
      </div>
    </article>
  );
});
