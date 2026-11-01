import { describe, expect, it } from "vitest";
import { CONDUCT_ACCEPT, CONDUCT_FIRST_VISIT, CONDUCT_HABITS, CONDUCT_LEAD, CONDUCT_TITLE, agreedOn } from "./conduct";
import { CONDUCT_PATH } from "@/lib/platform/server/space-routes";
import { channelPath, channelSpace } from "./paths";
import { channels } from "@/lib/platform/fixtures";

const everything = [CONDUCT_TITLE, CONDUCT_LEAD, CONDUCT_FIRST_VISIT, CONDUCT_ACCEPT, ...CONDUCT_HABITS.flatMap((habit) => [habit.title, habit.body])].join(" ");

describe("how we talk to each other", () => {
  it("speaks as a community, never as a rescuer", () => {
    // Policy: no savior framing. People here are builders and peers, not beneficiaries.
    for (const phrase of [/\bempower/i, /\buplift/i, /\bunderprivileged/i, /\bless fortunate/i, /\bgive back\b/i, /\bhelp them\b/i, /\bsave\b/i, /\bneedy\b/i, /\bdisadvantaged\b/i]) {
      expect(everything, `${phrase}`).not.toMatch(phrase);
    }
  });

  it("tells the truth about contact details: flagged for a person, never silently hidden", () => {
    const contact = CONDUCT_HABITS.find((habit) => habit.key === "contact")!;
    expect(contact.body).toMatch(/flagged for a moderator/);
    expect(contact.body).toMatch(/stays up until a person decides/);
    expect(everything).not.toMatch(/\b(?:removed|deleted) automatically\b/i);
  });

  it("promises no WhatsApp bridge, and offers none", () => {
    expect(CONDUCT_HABITS.find((habit) => habit.key === "here")!.body).toMatch(/no WhatsApp group or bridge/);
    expect(everything).not.toMatch(/\bjoin (?:our|the) WhatsApp\b|wa\.me|chat\.whatsapp\.com/i);
  });

  it("says institutions can read community channels, as the owner decided", () => {
    expect(CONDUCT_HABITS.find((habit) => habit.key === "audience")!.body).toMatch(/organisations with approved access/);
  });

  it("keeps each habit addressable once, with a full stop closing each title", () => {
    expect(new Set(CONDUCT_HABITS.map((habit) => habit.key)).size).toBe(CONDUCT_HABITS.length);
    for (const habit of CONDUCT_HABITS) expect(habit.title, `${habit.key}`).toMatch(/\.$/);
  });

  it("dates an agreement as members read every moment: the Nairobi day", () => {
    // 21:30 UTC on 1 Nov is already 2 Nov in Nairobi.
    expect(agreedOn(Date.parse("2026-11-01T21:30:00Z"))).toBe("You agreed to this on 2 Nov 2026.");
  });
});

describe("channel paths", () => {
  it("open community channels in Community and cohort channels in Cohort", () => {
    expect(channelSpace(channels.help)).toBe("community");
    expect(channelSpace(channels.cohort04)).toBe("cohort");
    expect(channelPath(channels.help)).toBe("/dashboard/community/c/help");
    expect(channelPath(channels.cohortHelp)).toBe("/dashboard/cohort/c/c04-help");
    expect(CONDUCT_PATH).toBe("/dashboard/community/conduct");
  });

  it("give direct conversations no page until mentor requests open them", () => {
    expect(channelSpace(channels.davidConversation)).toBeNull();
    expect(channelPath(channels.davidConversation)).toBeNull();
  });

  it("treat a slug as opaque text, never as more path", () => {
    expect(channelPath({ kind: "COMMUNITY", slug: "../admin?x=1#y" })).toBe("/dashboard/community/c/..%2Fadmin%3Fx%3D1%23y");
  });
});
