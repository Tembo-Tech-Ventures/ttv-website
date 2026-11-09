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
import { RAISED } from "@/components/platform/ui";
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

  it("keeps its own way back and site navigation in the immersive frame", () => {
    const html = renderToStaticMarkup(<ChatApp mockMode />);
    expect(html).toContain("Back to dashboard");
    expect(html).toContain('aria-label="Site"');
    // The assistant is Tembo everywhere (owner decision, 31 Oct 2026), not only in the spaces shell,
    // and this page is named apart from a channel's "Ask Tembo here" (QA3-03).
    expect(html).toContain(">Ask Tembo privately</h2>");
    expect(html).not.toContain("Ask AI");
  });

  it("leaves navigation to the spaces shell and introduces itself as Ask Tembo there", () => {
    const html = renderToStaticMarkup(<ChatApp mockMode />);
    expect(html).not.toContain("Back to dashboard");
    expect(html).not.toContain('aria-label="Site"');
    expect(html).not.toContain('href="/dashboard"');
    expect(html).toContain(">Ask Tembo privately</h2>");
    expect(html).not.toContain("Ask AI");
    // The conversations stay reachable on both widths.
    expect(html).toContain('aria-label="Conversations"');
  });

  it("puts the conversation title in the heading under the page's h1", () => {
    const html = renderToStaticMarkup(
      <ChatApp mockMode initialSessions={[{ ...SESSION, title: "Pricing questions" }]} />
    );

    // Scoped to the title's <h2>, so the conversation list rendering the same
    // string cannot make this pass on its own.
    const heading = /<h2[^>]*data-chat-title[^>]*>(.*?)<\/h2>/s.exec(html)?.[1] ?? "";
    expect(heading).toContain("Pricing questions");
  });

  it("has one h1, the kit's Mattone page title, visually hidden so the chat keeps the screen", () => {
    {
      const html = renderToStaticMarkup(<ChatApp mockMode initialSessions={[SESSION]} />);
      const h1s = [...html.matchAll(/<h1([^>]*)>(.*?)<\/h1>/gs)];
      expect(h1s).toHaveLength(1);
      expect(h1s[0]![2]).toBe("Ask Tembo");
      expect(h1s[0]![1]).toContain("data-page-title");
      expect(h1s[0]![1]).toContain("sr-only");
      // The conversation's title is body type: no display face, no hand-set weight.
      const title = /<h2([^>]*data-chat-title[^>]*)>/.exec(html)?.[1] ?? "";
      expect(title).not.toMatch(/font-heading|font-semibold|tracking-display/);
    }
  });

  it("exposes the heading as a switcher on mobile and plain text on desktop", () => {
    const html = renderToStaticMarkup(<ChatApp mockMode initialSessions={[SESSION]} />);
    const heading = /<h2[^>]*data-chat-title[^>]*>(.*?)<\/h2>/s.exec(html)?.[1] ?? "";

    // The desktop title must not be a control. A button hidden with
    // `pointer-events-none` is still keyboard-activatable, and activating it
    // would open a display:none modal that swallows every click on the page.
    expect(heading).toContain('aria-haspopup="dialog"');
    expect(heading).toContain("lg:hidden");
    expect(heading).toContain("lg:inline");
  });

  it("offers example prompts and a capability-led heading when empty", () => {
    const html = renderToStaticMarkup(<ChatApp mockMode />);

    expect(html).toContain("Ask Tembo");
    expect(html).toContain("Ask about your sessions, your program, or anything you need help with.");
    expect(html).toContain("What were the main action items from mentor hours?");
  });

  it("says what the empty list is for in the kit's EmptyState", () => {
    const html = renderToStaticMarkup(<ChatApp mockMode />);
    const empty = /<div[^>]*data-empty-state[^>]*>(.*?)<\/div><\/div>/s.exec(html)?.[1] ?? "";
    expect(empty).toContain(">No conversations yet</h3>");
    expect(empty).toContain("Your chats are saved here after your first question.");
    expect(html).not.toContain("border-dashed border-rule");
  });

  it("keeps peach for Send alone: New chat is quiet and every icon control is the kit's", () => {
    {
      const html = renderToStaticMarkup(<ChatApp mockMode initialSessions={[SESSION]} />);
      const primaries = [...html.matchAll(/<button[^>]*data-variant="primary"[^>]*>/g)].map((match) => match[0]);
      expect(primaries).toHaveLength(1);
      expect(primaries[0]).toContain('aria-label="Send message"');
      expect(primaries[0]).toContain('type="submit"');
      // The rail's "New chat" (desktop) and the header's "Start a new chat" (phone).
      expect(html).toMatch(/<button[^>]*data-variant="quiet"[^>]*>(?:(?!<\/button>).)*New chat<\/button>/s);
      expect(html).toMatch(/<button[^>]*aria-label="Start a new chat"[^>]*data-variant="ghost"/);
      expect(html).not.toMatch(/bg-primary\/(10|15|20)/);
    }
  });

  it("gives each conversation row the kit's focus ring, its current state, and 44px on touch", () => {
    const other: ChatSession = { ...SESSION, id: "session-2", title: "Pricing" };
    const html = renderToStaticMarkup(<ChatApp mockMode initialSessions={[SESSION, other]} />);
    // The rail's list, then the phone sheet's: the same rows twice.
    const rows = [...html.matchAll(/<li><button([^>]*)>/g)].map((match) => match[1]!);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row).toContain("focus-visible:outline-peach-ink");
      expect(row).toContain("pointer-coarse:min-h-11");
      expect(row).not.toContain("disabled:opacity");
      // Only the others are refused mid-answer, and they go quiet, not faded.
      if (!row.includes("aria-current")) expect(row).toContain("disabled:cursor-not-allowed disabled:text-ink-muted");
    }
    expect(rows.map((row) => row.includes('aria-current="true"'))).toEqual([true, false, true, false]);
  });

  it("writes no uppercase eyebrows and no colours outside the platform tokens", () => {
    {
      const html = renderToStaticMarkup(
        <ChatApp
          mockMode
          initialSessions={[SESSION]}
          initialMessages={[
            { role: "user", content: "Where?" },
            {
              role: "assistant",
              content: "In `week 3`, see [the session](/dashboard/sessions/r1).\n\n```\ncode\n```",
              citations: [{ sourceNumber: 1, recordingId: "r1", title: "Week 3", startTime: 92, endTime: 100, text: "Quote." }],
            },
          ]}
        />
      );
      expect(html).not.toContain("uppercase");
      expect(html).toContain(">Recent</h2>");
      // Peach is checked above (Send alone); TemboMark's own peach T is the kit's.
      expect(html).not.toMatch(/border-rule|bg-dark\/|bg-bg-raised|text-red-|text-white|shadow-2xl|shadow-lg|focus:outline-none/);
    }
  });

  it("shows sources as kit cards with sentence-case chips, and Tembo by its mark and AI badge", () => {
    const html = renderToStaticMarkup(
      <ChatApp
        mockMode
        initialMessages={[
          {
            role: "assistant",
            content: "Answer. [1]",
            citations: [{ sourceNumber: 1, recordingId: "r1", title: "Week 3", startTime: 92, endTime: 100, text: "Quote." }],
          },
        ]}
      />
    );
    const source = /<a href="\/dashboard\/sessions\/r1\?t=92"([^>]*)>(.*?)<\/a>/s.exec(html);
    expect(source?.[1]).toContain("focus-visible:outline-peach-ink");
    expect(source?.[1]).toContain("border-hairline");
    expect(source?.[1]).toContain(RAISED);
    expect(source?.[2]).toMatch(/data-chip="neutral"[^>]*><span class="truncate">Source 1<\/span>/);
    expect(source?.[2]).toMatch(/data-chip="neutral"[^>]*><span class="truncate">1:32<\/span>/);
    const author = /<p[^>]*data-chat-author="true"[^>]*>(.*?)<\/p>/s.exec(html)?.[1] ?? "";
    expect(author).toContain("data-tembo-mark");
    expect(author).toMatch(/data-role-badge="AI"[^>]*>AI<\/span>$/);
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
