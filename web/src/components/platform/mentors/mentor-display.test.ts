import { describe, expect, it } from "vitest";
import { MentorRequestStatus, type MentorRequest } from "@/lib/platform/contracts";
import { availability, FIXTURE_NOW, meByPersona, pendingMentorRequest, people } from "@/lib/platform/fixtures";
import {
  capacityView, conversationContext, conversationHref, dayPhrase, listingNote, mentorRequestsOpen, mentorStatus,
  monthName, openingDate, personContext, requesterStatus, requestMeta, usedShare, waitingText,
} from "./mentor-display";

const DEC_1_NAIROBI = Date.parse("2026-11-30T21:00:00Z");
const request: MentorRequest = pendingMentorRequest;

describe("capacity", () => {
  it("names the month and the opening in Nairobi time", () => {
    expect(monthName(FIXTURE_NOW)).toBe("November");
    // 21:00 UTC on 30 November is already 1 December in Nairobi.
    expect(openingDate(DEC_1_NAIROBI)).toBe("1 December");
    expect(monthName(DEC_1_NAIROBI)).toBe("December");
  });

  it("says how many spots are open this month", () => {
    expect(capacityView({ used: 1, limit: 3, nextOpeningAt: null }, FIXTURE_NOW)).toEqual({ open: true, text: "2 of 3 spots open in November" });
    expect(capacityView({ used: 1, limit: 2, nextOpeningAt: null }, FIXTURE_NOW).text).toBe("1 of 2 spots open in November");
    expect(capacityView({ used: 0, limit: 3, nextOpeningAt: null }, FIXTURE_NOW).text).toBe("3 spots open in November");
    expect(capacityView({ used: 0, limit: 1, nextOpeningAt: null }, FIXTURE_NOW).text).toBe("1 spot open in November");
  });

  it("gives a full mentor's next opening, and promises no date when only waiting requests fill it", () => {
    expect(capacityView({ used: 2, limit: 2, nextOpeningAt: DEC_1_NAIROBI }, FIXTURE_NOW)).toEqual({ open: false, text: "Next opening 1 December" });
    expect(capacityView({ used: 3, limit: 2, nextOpeningAt: null }, FIXTURE_NOW)).toEqual({ open: false, text: "No spots open right now" });
  });

  it("fills the meter by the share used, never past full", () => {
    expect(usedShare({ used: 1, limit: 4, nextOpeningAt: null })).toBe(0.25);
    expect(usedShare({ used: 5, limit: 4, nextOpeningAt: null })).toBe(1);
    expect(usedShare({ used: 0, limit: 0, nextOpeningAt: null })).toBe(0);
  });
});

describe("statuses", () => {
  it("give every status a label from both sides", () => {
    for (const status of MentorRequestStatus.options) {
      expect(requesterStatus(request, status).label).not.toBe("");
      expect(mentorStatus(request, status).label).not.toBe("");
    }
  });

  it("keep a mentor's choice neutral: no rejection, nothing held against anyone", () => {
    const words = MentorRequestStatus.options.flatMap((status) => {
      const asker = requesterStatus({ ...request, redirectedTo: status === "REDIRECTED" ? people.joseph : null }, status);
      const mentor = mentorStatus(request, status);
      return [asker.label, asker.detail ?? "", mentor.label, mentor.detail ?? ""];
    }).join(" ");
    expect(words).not.toMatch(/reject|denied|refus|unfortunately|sorry|fail/i);
    expect(requesterStatus(request, "DECLINED")).toMatchObject({ label: "Not this month", tone: "neutral" });
    expect(requesterStatus(request, "DECLINED").detail).toContain("welcome to ask again");
  });

  it("name the suggested mentor, or say the account has gone", () => {
    expect(requesterStatus({ ...request, redirectedTo: people.joseph }, "REDIRECTED").detail).toBe(
      "David suggested Joseph Mutua, who may be better placed to help.",
    );
    expect(requesterStatus({ ...request, redirectedTo: null }, "REDIRECTED").detail).toContain("account has since closed");
    expect(mentorStatus({ ...request, redirectedTo: people.joseph }, "REDIRECTED").label).toBe("Suggested Joseph Mutua");
    expect(mentorStatus(request, "WITHDRAWN").detail).toBe("Wanjiku withdrew this request.");
  });

  it("describe a request and its person", () => {
    expect(requestMeta(request, FIXTURE_NOW)).toBe("Written review · asked 2 h ago");
    expect(personContext(people.wanjiku)).toBe("Cohort 04");
    expect(personContext(people.achieng)).toBe("Alumni · Cohort 02");
    expect(personContext({ roleBadges: [] })).toBeNull();
    expect(waitingText(1)).toBe("1 request waiting for you");
    expect(waitingText(3)).toBe("3 requests waiting for you");
    // Past one page the count is a floor, and says so.
    expect(waitingText(20, true)).toBe("20+ requests waiting for you");
  });

  it("say what opened a conversation, from each side", () => {
    expect(conversationContext(request, people.david.id)).toBe("You accepted Wanjiku's request for a written review");
    expect(conversationContext({ ...request, format: "CALL_30_MIN" }, people.wanjiku.id)).toBe("David accepted your request for a 30-minute call");
    expect(dayPhrase(FIXTURE_NOW - 60_000, FIXTURE_NOW)).toBe("today");
    expect(dayPhrase(FIXTURE_NOW - 24 * 3_600_000, FIXTURE_NOW)).toBe("yesterday");
    expect(dayPhrase(FIXTURE_NOW - 3 * 24 * 3_600_000, FIXTURE_NOW)).toBe("on Saturday");
  });
});

describe("listing and routes", () => {
  it("explain why a mentor is or is not in the directory", () => {
    expect(listingNote(availability)).toContain("Members can find you");
    expect(listingNote({ ...availability, listed: false, headline: "" })).toContain("Not listed yet");
    expect(listingNote({ ...availability, listed: false, paused: true })).toContain("Requests already waiting stay with you");
    expect(listingNote({ ...availability, listed: false, monthlyCapacity: 0 })).toContain("above zero");
    expect(listingNote({ ...availability, listed: false })).toBe("Not listed in the mentor directory right now.");
  });

  it("open mentor connections only while channels is on as well", () => {
    expect(mentorRequestsOpen(meByPersona.wanjiku)).toBe(true);
    expect(mentorRequestsOpen({ flags: { ...meByPersona.wanjiku.flags, mentor_requests: false } })).toBe(false);
    expect(mentorRequestsOpen({ flags: { ...meByPersona.wanjiku.flags, channels: false } })).toBe(false);
  });

  it("encode a conversation id as one path segment", () => {
    expect(conversationHref("dm/1?x")).toBe("/dashboard/community/dm/dm%2F1%3Fx");
  });
});
