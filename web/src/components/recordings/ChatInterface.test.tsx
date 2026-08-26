import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChatInterface from "./ChatInterface";

describe("ChatInterface", () => {
  it("renders saved discussions and timestamp citation links", () => {
    const html = renderToStaticMarkup(
      <ChatInterface
        mockMode
        initialSessions={[
          {
            id: "session-1",
            title: "Customer discovery",
            updatedAt: 1_800_000_000,
            messageCount: 2,
            latestMessage: "Interview customers before building.",
          },
        ]}
        initialMessages={[
          {
            role: "assistant",
            content:
              "Use **customer discovery** before building.\n\n- Interview users first. [1]",
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

    expect(html).toContain("Discussions");
    expect(html).toContain("Customer discovery");
    expect(html).toContain("<strong>customer discovery</strong>");
    expect(html).toContain('href="/dashboard/sessions/recording-1?t=92"');
    expect(html).toContain("1:32");
    expect(html).toContain("Shift+Enter adds a new line");
  });

  it("renders example prompts when a discussion is empty", () => {
    const html = renderToStaticMarkup(<ChatInterface mockMode />);

    expect(html).toContain("What were the main action items from mentor hours?");
    expect(html).toContain("Your saved chats will appear here");
  });
});
