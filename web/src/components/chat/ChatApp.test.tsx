import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChatApp from "./ChatApp";
import { formatSessionDate, truncate } from "./ConversationList";

const SESSION = {
  id: "session-1",
  title: "Customer discovery",
  updatedAt: 1_800_000_000,
  messageCount: 2,
  latestMessage: "Interview customers before building.",
};

describe("ChatApp", () => {
  it("renders conversations, markdown answers and timestamped citation links", () => {
    const html = renderToStaticMarkup(
      <ChatApp
        mockMode
        initialSessions={[SESSION]}
        initialMessages={[
          {
            role: "assistant",
            content: "Use **customer discovery** before building.\n\n- Interview users first. [1]",
            citations: [
              {
                sourceNumber: 1,
                recordingId: "recording-1",
                title: "Mentor Hours",
                startTime: 92,
                endTime: 118,
                url: "/dashboard/sessions/recording-1?t=92",
                text: "Students should interview customers before building.",
              },
            ],
          },
        ]}
      />
    );

    expect(html).toContain("Customer discovery");
    expect(html).toContain("<strong>customer discovery</strong>");
    expect(html).toContain('href="/dashboard/sessions/recording-1?t=92"');
    expect(html).toContain("1:32");
  });

  it("falls back to a derived citation link when the API omits a url", () => {
    const html = renderToStaticMarkup(
      <ChatApp
        mockMode
        initialMessages={[
          {
            role: "assistant",
            content: "Answer.",
            citations: [
              {
                recordingId: "recording-9",
                title: "Workshop",
                startTime: 90.7,
                endTime: 120,
                text: "Quote.",
              },
            ],
          },
        ]}
      />
    );

    expect(html).toContain('href="/dashboard/sessions/recording-9?t=90"');
    // No sourceNumber supplied, so no "Source N" chip should be invented.
    expect(html).not.toContain("Source ");
  });

  it("names the active conversation in the header and offers it as a switcher", () => {
    const html = renderToStaticMarkup(<ChatApp mockMode initialSessions={[SESSION]} />);

    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("Customer discovery");
  });

  it("titles an unsaved conversation as a new chat", () => {
    const html = renderToStaticMarkup(<ChatApp mockMode />);

    expect(html).toContain("New chat");
  });

  it("offers example prompts and a capability-led heading when empty", () => {
    const html = renderToStaticMarkup(<ChatApp mockMode />);

    expect(html).toContain("Ask across your sessions");
    expect(html).toContain("What were the main action items from mentor hours?");
    expect(html).toContain("Your saved chats will appear here");
  });

  it("keeps the transcript as the only scrolling region in the chat column", () => {
    const html = renderToStaticMarkup(<ChatApp mockMode initialSessions={[SESSION]} />);

    // The desktop rail scrolls as a separate column; the chat column itself
    // must expose exactly one scroller, or the composer starts drifting off
    // the bottom of a phone screen again.
    const scrollers = html.match(/overflow-y-auto/g) ?? [];
    expect(scrollers).toHaveLength(3); // transcript + desktop rail + mobile sheet
    expect(html).toContain('data-chat-scroller="true"');
    expect(html).toContain("min-h-0 flex-1");
  });
});

describe("conversation list helpers", () => {
  it("formats an update time from unix seconds", () => {
    expect(formatSessionDate(1_800_000_000)).toMatch(/\d/);
  });

  it("returns an empty string for a missing timestamp", () => {
    expect(formatSessionDate(0)).toBe("");
  });

  it("collapses whitespace and ellipsises long previews", () => {
    expect(truncate("  a   b  ")).toBe("a b");
    expect(truncate("x".repeat(200))).toHaveLength(96);
    expect(truncate("x".repeat(200)).endsWith("…")).toBe(true);
  });

  it("describes an empty conversation rather than rendering nothing", () => {
    expect(truncate(null)).toBe("No messages yet");
  });
});
