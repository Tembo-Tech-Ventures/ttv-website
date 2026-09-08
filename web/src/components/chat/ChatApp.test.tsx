import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChatApp from "./ChatApp";
import {
  conversationTitle,
  formatSessionDate,
  NEW_CHAT_TITLE,
  truncate,
} from "./ConversationList";
import { toPlainText } from "./Transcript";
import type { ChatSession } from "./types";

const SESSION: ChatSession = {
  id: "session-1",
  title: "Customer discovery",
  updatedAt: 1_800_000_000,
  messageCount: 2,
  latestMessage: "Interview customers before building.",
};

describe("ChatApp", () => {
  it("renders markdown answers and timestamped citation links", () => {
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

  it("puts the conversation title in the page heading", () => {
    const html = renderToStaticMarkup(
      <ChatApp mockMode initialSessions={[{ ...SESSION, title: "Pricing questions" }]} />
    );

    // Scoped to the <h1>, so the conversation list rendering the same string
    // cannot make this pass on its own.
    const heading = /<h1[^>]*>(.*?)<\/h1>/s.exec(html)?.[1] ?? "";
    expect(heading).toContain("Pricing questions");
  });

  it("exposes the heading as a switcher on mobile and plain text on desktop", () => {
    const html = renderToStaticMarkup(<ChatApp mockMode initialSessions={[SESSION]} />);
    const heading = /<h1[^>]*>(.*?)<\/h1>/s.exec(html)?.[1] ?? "";

    // The desktop title must not be a control. A button hidden with
    // `pointer-events-none` is still keyboard-activatable, and activating it
    // would open a display:none modal that swallows every click on the page.
    expect(heading).toContain('aria-haspopup="dialog"');
    expect(heading).toContain("lg:hidden");
    expect(heading).toContain("lg:inline");
  });

  it("offers example prompts and a capability-led heading when empty", () => {
    const html = renderToStaticMarkup(<ChatApp mockMode />);

    expect(html).toContain("Ask AI");
    expect(html).toContain("Ask about your sessions, your program, or anything you need help with.");
    expect(html).toContain("What were the main action items from mentor hours?");
    expect(html).toContain("Your saved chats will appear here");
  });

  it("keeps every dashboard destination reachable, logout included", () => {
    const html = renderToStaticMarkup(<ChatApp mockMode />);

    // This route drops DashboardLayout, so anything the shell offered has to be
    // offered here or it becomes unreachable while the user is in the chat.
    expect(html).toContain('href="/auth/logout"');
    expect(html).toContain('href="/dashboard/sessions"');
    expect(html).toContain('href="/dashboard/apply"');
    // The current page is not a destination.
    expect(html).not.toContain('href="/dashboard/ask"');
  });

  it("marks exactly one region as the transcript scroller", () => {
    const html = renderToStaticMarkup(<ChatApp mockMode initialSessions={[SESSION]} />);

    expect(html.match(/data-chat-scroller="true"/g)).toHaveLength(1);
  });
});

describe("conversationTitle", () => {
  it("names the active conversation", () => {
    expect(conversationTitle([SESSION], "session-1")).toBe("Customer discovery");
  });

  it("labels an unsaved conversation", () => {
    expect(conversationTitle([SESSION], null)).toBe(NEW_CHAT_TITLE);
  });

  it("labels a conversation that is not in the list yet", () => {
    // The id is assigned by the send response before the list has refreshed.
    expect(conversationTitle([SESSION], "session-not-loaded-yet")).toBe(NEW_CHAT_TITLE);
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

describe("toPlainText", () => {
  it("flattens markdown so a screen reader does not speak the markup", () => {
    const spoken = toPlainText(
      "## Start here\n\n> A quote\n\n- Interview users first. [1]\n- Read the [docs](https://x.test).\n- ~~Not this~~ but _this_ and **that**.\n\n```js\ncode()\n```"
    );

    expect(spoken).not.toMatch(/[*`[\]>~#]/);
    expect(spoken).toContain("Start here");
    expect(spoken).toContain("A quote");
    expect(spoken).toContain("Interview users first.");
    expect(spoken).toContain("Read the docs");
    expect(spoken).toContain("Not this but this and that.");
    expect(spoken).toContain("code block");
  });

  it("leaves underscores that are not emphasis alone", () => {
    // Identifiers turn up in answers about the codebase; "snakecase" is wrong.
    expect(toPlainText("Set snake_case on the_column.")).toBe("Set snake_case on the_column.");
  });

  it("drops a bare citation marker without eating the sentence", () => {
    expect(toPlainText("Validate first. [1]")).toBe("Validate first.");
  });
});
