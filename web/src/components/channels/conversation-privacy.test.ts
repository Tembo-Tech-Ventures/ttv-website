import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { acceptedMentorRequest, FIXTURE_NOW } from "@/lib/platform/fixtures";
import { CONDUCT_HABITS } from "./conduct";
import {
  CONVERSATION_ADMIN_NOTE, CONVERSATION_READERS_HREF, conversationReaders, conversationTimeline,
} from "./conversation-privacy";

const minute = 60_000;
const header = readFileSync(new URL("../platform/mentors/ConversationHeader.astro", import.meta.url), "utf8");

describe("who reads a private conversation (QA4-08)", () => {
  it("names the two people, by first name, and stays true once the other account is gone", () => {
    expect(conversationReaders("David Kamau")).toBe("Only you and David can read this");
    expect(conversationReaders(null)).toBe("Only the two of you can read this");
    expect(conversationReaders("  ")).toBe("Only the two of you can read this");
  });

  it("says what TTV admins see, truthfully: a reported or flagged message, and only that one", () => {
    expect(CONVERSATION_ADMIN_NOTE).toBe(
      "TTV admins see a message here only if one of you reports it or our checks flag it, and then only that message.",
    );
  });

  it("links to the habit that says who reads what, which covers private conversations too", () => {
    expect(CONVERSATION_READERS_HREF).toBe("/dashboard/community/conduct#conduct-audience");
    expect(CONDUCT_HABITS.find((habit) => habit.key === "audience")?.body).toMatch(/private conversation/);
  });

  it("is a disclosure in the header, not an inert label", () => {
    expect(header).toContain("<details data-conversation-privacy");
    expect(header).toContain("{conversationReaders(counterpart?.name ?? null)}");
    expect(header).toContain("{CONVERSATION_ADMIN_NOTE}");
    expect(header).not.toContain("Private conversation\n");
  });
});

describe("when the request was asked and accepted (QA4-16, QA4-17)", () => {
  it("says each day apart from what was asked for, so no day reads as the call's", () => {
    // Asked on Saturday 31 Oct, accepted ten minutes before Tuesday's fixture moment.
    expect(conversationTimeline(acceptedMentorRequest, FIXTURE_NOW)).toEqual({ sameDay: false, asked: "Asked on Saturday", accepted: "accepted today" });
    expect(header).toContain("{context}.");
    expect(header).not.toMatch(/\{context\} <time/);
  });

  it("says it once when both were the same day", () => {
    const request = { createdAt: FIXTURE_NOW - 90 * minute, updatedAt: FIXTURE_NOW - 10 * minute };
    expect(conversationTimeline(request, FIXTURE_NOW)).toEqual({ sameDay: true, text: "Asked and accepted today" });
  });

  it("goes by the Nairobi day", () => {
    // 22:30 UTC on 2 Nov is already 3 Nov in Nairobi: the same day as the fixture's morning.
    const request = { createdAt: Date.parse("2026-11-02T20:30:00Z"), updatedAt: Date.parse("2026-11-02T22:30:00Z") };
    expect(conversationTimeline(request, FIXTURE_NOW)).toEqual({ sameDay: false, asked: "Asked yesterday", accepted: "accepted today" });
  });
});
