import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CallProposalCardView, MeetingCardView, ProjectEmbed } from "@/lib/platform/contracts";
import { people, projects, sessionClip } from "@/lib/platform/fixtures";
import EmbedCard, { ASK_TEMBO_HREF, clipHref, confirmationText, sessionCardLine, shownConfirmations } from "./EmbedCard";

const ledger = projects.chamaLedger; // revision 3, confirmed by David on revision 2
const html = (node: React.ReactElement) => renderToStaticMarkup(node).replaceAll("<!-- -->", "").replaceAll("&#x27;", "'");
const text = (node: React.ReactElement) => html(node).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("a shared project", () => {
  it("says which revision was shared and which revision each confirmation covers", () => {
    const card = text(<EmbedCard embed={ledger} />);
    expect(card).toContain("Project · revision 3");
    expect(card).toContain("Chama ledger: M-Pesa receipt parser");
    expect(card).toContain("Confirmed by David on revision 2");
    expect(card).not.toContain("on this revision");
  });

  it("shows one confirmation per mentor: on this revision when there is one, else their latest", () => {
    const embed: ProjectEmbed = {
      ...ledger,
      confirmations: [
        { mentorId: people.david.id, mentorName: people.david.name, version: 1 },
        { mentorId: people.mercy.id, mentorName: people.mercy.name, version: 2 },
        { mentorId: people.david.id, mentorName: people.david.name, version: 2 },
        { mentorId: people.mercy.id, mentorName: people.mercy.name, version: 3 },
      ],
    };
    const shown = shownConfirmations(embed);
    expect(shown.map((c) => [c.mentorName, c.version])).toEqual([["Mercy Wambui", 3], ["David Kamau", 2]]);
    expect(shown.map((c) => confirmationText(embed, c))).toEqual(["Confirmed by Mercy on this revision", "Confirmed by David on revision 2"]);
    expect(html(<EmbedCard embed={embed} />)).toContain('data-confirmation="this-revision"');
  });

  it("says nothing about confirmation when there is none: missing evidence is not evidence against", () => {
    const card = text(<EmbedCard embed={{ ...ledger, confirmations: [] }} />);
    expect(card).not.toMatch(/confirm/i);
    expect(html(<EmbedCard embed={{ ...ledger, confirmations: [] }} />)).not.toContain("Mentor confirmations");
  });

  it("opens an outside link in a new tab and says so, and a TTV page in place", () => {
    const outside = html(<EmbedCard embed={ledger} />);
    expect(outside).toContain('target="_blank"');
    expect(outside).toContain('rel="noopener noreferrer"');
    expect(text(<EmbedCard embed={ledger} />)).toContain("Open Chama ledger: M-Pesa receipt parser (opens in a new tab)");
    const inside = html(<EmbedCard embed={{ ...ledger, link: "/dashboard/community/projects/x" }} />);
    expect(inside).toContain('href="/dashboard/community/projects/x"');
    expect(inside).not.toContain("target=");
    expect(text(<EmbedCard embed={{ ...ledger, link: "/dashboard/community/projects/x" }} />)).not.toContain("new tab");
  });

  it("names the work as a link to its owner's member page while it has one, and as text otherwise", () => {
    const linked = html(<EmbedCard embed={{ ...ledger, memberHref: "/dashboard/community/members/achieng-otieno#work-ledger" }} />);
    expect(linked).toMatch(/<p class="channel-embed__title"><a href="\/dashboard\/community\/members\/achieng-otieno#work-ledger"[^>]*>Chama ledger: M-Pesa receipt parser<\/a><\/p>/);
    expect(html(<EmbedCard embed={ledger} />)).toMatch(/<p class="channel-embed__title">Chama ledger: M-Pesa receipt parser<\/p>/);
    // A 44px target on a touch screen.
    expect(linked).toMatch(/<a href="\/dashboard\/community\/members\/[^"]+" class="[^"]*pointer-coarse:min-h-11/);
  });

  it("draws no way in when the project has no evidence link", () => {
    const card = html(<EmbedCard embed={{ ...ledger, link: null }} />);
    expect(card).toContain(ledger.title);
    expect(card).not.toContain("<a");
    expect(text(<EmbedCard embed={{ ...ledger, link: null }} />)).toContain("Confirmed by David on revision 2");
    // Nothing to show at the foot: no empty rule either.
    expect(html(<EmbedCard embed={{ ...ledger, link: null, confirmations: [] }} />)).not.toContain("channel-embed__foot");
  });

  it("keeps the title, the confirmation and the way in when compact (a thread's first message)", () => {
    const card = text(<EmbedCard embed={ledger} compact />);
    expect(card).toContain("Chama ledger: M-Pesa receipt parser");
    expect(card).toContain("Confirmed by David on revision 2");
    expect(card).not.toContain("Turns C2B callbacks");
    expect(card).not.toContain("TypeScript");
  });
});

describe("a shared session clip", () => {
  it("plays from its moment, with what was said there", () => {
    const card = html(<EmbedCard embed={sessionClip} />);
    expect(card).toContain(`href="${clipHref(sessionClip)}"`);
    expect(clipHref(sessionClip)).toBe(`/dashboard/cohort/sessions/${sessionClip.recordingId}?t=2052`);
    expect(text(<EmbedCard embed={sessionClip} />)).toContain("Watch from 34:12 , Session 9 · Webhooks and retries");
    expect(text(<EmbedCard embed={sessionClip} />)).toContain(sessionClip.quote);
    // The poster is a larger pointer target for the same link, kept out of the tab order and the accessibility tree.
    expect(card).toMatch(/<a href="[^"]+" tabindex="-1" aria-hidden="true" class="channel-clip__poster"/);
    expect(text(<EmbedCard embed={sessionClip} compact />)).not.toContain(sessionClip.quote);
  });
});

describe("work that is no longer available", () => {
  it("says so, the same for every reason, and nothing about what it was", () => {
    const project = text(<EmbedCard embed={{ type: "unavailable", was: "project" }} />);
    expect(project).toBe("Project This project is no longer available It may have been removed, or it isn't shared with you.");
    const clip = text(<EmbedCard embed={{ type: "unavailable", was: "sessionClip" }} />);
    expect(clip).toBe("Session clip This session clip is no longer available It may have been removed, or it isn't shared with you.");
    const markup = html(<EmbedCard embed={{ type: "unavailable", was: "project" }} />);
    expect(markup).not.toContain("<a ");
    expect(markup).toContain('data-embed="unavailable"');
  });
});

describe("a cohort session's card (in-app calls P9)", () => {
  const session: MeetingCardView = {
    type: "meeting", meetingId: "week-9", purpose: "SESSION", title: "Testing payment callbacks", state: "scheduled",
    scheduledStartAt: Date.parse("2026-11-26T15:00:00Z"), bookedMinutes: 45, openedAt: null, endedAt: null,
    recordingId: null, transcriptReady: false, notRecordedReason: null,
  };
  const links = (card: MeetingCardView) => [...html(<EmbedCard embed={card} />).matchAll(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)]
    .map(([, href, label]) => [href, label!.replace(/<[^>]+>/g, "").trim()]);

  it("offers each state's way in, and only that", () => {
    expect(links(session)).toEqual([["/dashboard/cohort/sessions/upcoming/week-9/calendar.ics", "Add to calendar: Testing payment callbacks"]]);
    expect(text(<EmbedCard embed={session} />)).toMatch(/Thu 26 Nov( 2026)?, 18:00–18:45 EAT/);
    expect(links({ ...session, state: "live" })).toEqual([["/dashboard/calls/week-9", "Join session: Testing payment callbacks (opens in a new tab)"]]);
    expect(text(<EmbedCard embed={{ ...session, state: "live" }} />)).toContain("The chat is this message's thread.");
    expect(links({ ...session, state: "ready", recordingId: "video", transcriptReady: false })).toEqual([
      ["/dashboard/cohort/sessions/video", "Watch recording: Testing payment callbacks"],
    ]);
    expect(links({ ...session, state: "ready", recordingId: "video", transcriptReady: true })).toEqual([
      [ASK_TEMBO_HREF, "Ask Tembo"], ["/dashboard/cohort/sessions/video", "Watch recording: Testing payment callbacks"],
    ]);
    for (const state of ["processing", "notRecorded", "failed", "ended", "cancelled"] as const) expect(links({ ...session, state })).toEqual([]);
  });

  it("says in words where the session stands, never by colour alone", () => {
    const said = (card: MeetingCardView) => text(<EmbedCard embed={card} />);
    expect(said({ ...session, state: "live" })).toContain("Live now");
    expect(said({ ...session, state: "notRecorded", notRecordedReason: "limit" })).toContain("TTV had reached its recording limit for the month");
    expect(said({ ...session, state: "notRecorded", notRecordedReason: "short" })).toContain("it was too short to keep");
    expect(said({ ...session, state: "failed" })).toContain("Recording failed");
    expect(said({ ...session, state: "ended" })).toContain("Its recording isn't available to the cohort.");
    expect(sessionCardLine({ ...session, state: "processing" })).toBe("The recording will be on this card when it's ready.");
  });
});

describe("a call between two people (in-app calls P10)", () => {
  const times = [Date.parse("2099-11-25T08:00:00Z"), Date.parse("2099-11-25T11:00:00Z"), Date.parse("2099-11-26T08:00:00Z")];
  const proposal: CallProposalCardView = {
    type: "callProposal", proposalId: "suggestion", purpose: "CALL", state: "open", proposedBy: people.david.id, times,
    bookedMinutes: 30, askToRecord: false, work: null, call: null, moves: false,
  };
  const as = (viewerId: string, card: CallProposalCardView = proposal) => html(<EmbedCard embed={card} viewerId={viewerId} channelId="conversation" />);
  const forms = (markup: string) => [...markup.matchAll(/<form [^>]*action="([^"]+)"[^>]*>(.*?)<\/form>/g)]
    .map(([, action, inner]) => [action, [...inner!.matchAll(/name="([^"]+)" value="([^"]+)"/g)].map(([, name, value]) => `${name}=${value}`).join("&")]);

  it("offers the other person every time, other times and Not now, as plain forms to the suggestion's page", () => {
    const markup = as(people.wanjiku.id);
    expect(forms(markup)).toEqual([
      ...times.map((at) => ["/dashboard/me/calls/suggested/suggestion", `answer=pick&at=${at}&from=conversation`]),
      ["/dashboard/me/calls/suggested/suggestion", "answer=notNow&from=conversation"],
    ]);
    expect(markup).toContain('href="/dashboard/me/calls/suggest?conversation=conversation&amp;instead=suggestion"');
    expect(markup).not.toContain("Withdraw");
  });

  it("offers the person who suggested it only Withdraw", () => {
    const markup = as(people.david.id);
    expect(forms(markup)).toEqual([["/dashboard/me/calls/suggested/suggestion", "answer=withdraw&from=conversation"]]);
    expect(text(<EmbedCard embed={proposal} viewerId={people.david.id} channelId="conversation" />)).toContain("Waiting for an answer.");
  });

  it("offers nothing to act on once it is answered or its times have passed, only new times or the booked call", () => {
    for (const state of ["declined", "withdrawn", "expired", "countered", "accepted"] as const) {
      const card = { ...proposal, state, call: state === "accepted" ? { meetingId: "suggestion", state: "SCHEDULED" as const, scheduledStartAt: times[1]! } : null };
      expect(forms(as(people.wanjiku.id, card))).toEqual([]);
    }
    expect(text(<EmbedCard embed={{ ...proposal, state: "expired" }} viewerId={people.wanjiku.id} channelId="conversation" />)).toContain("These times have passed.");
    expect(as(people.wanjiku.id, { ...proposal, state: "accepted", call: { meetingId: "suggestion", state: "SCHEDULED", scheduledStartAt: times[1]! } }))
      .toContain('href="/dashboard/me/calls/suggestion"');
  });

  it("says a check-in's work and revision, its 30 minutes, and that recording is asked of both on the day", () => {
    const said = text(<EmbedCard embed={{ ...proposal, purpose: "CHECKIN", askToRecord: true, work: { title: "Bus fare splitter", version: 4 } }}
      viewerId={people.wanjiku.id} channelId="conversation" />);
    expect(said).toContain("Project check-in");
    expect(said).toContain("Bus fare splitter, revision 4");
    expect(said).toContain("Up to 30 minutes. Asked to record: you'll both be asked on the day, and it's recorded only if you both say yes.");
  });

  it("gives a booked call its own calendar file and page, and Join call while it is open", () => {
    const call: MeetingCardView = {
      type: "meeting", meetingId: "booked", purpose: "CALL", title: "Mentoring call", state: "scheduled", scheduledStartAt: times[0]!,
      bookedMinutes: 30, openedAt: null, endedAt: null, recordingId: null, transcriptReady: false, notRecordedReason: null,
    };
    const markup = html(<EmbedCard embed={call} />);
    expect(markup).toContain('href="/dashboard/me/calls/booked/calendar.ics"');
    expect(markup).toContain('href="/dashboard/me/calls/booked"');
    expect(text(<EmbedCard embed={{ ...call, state: "live", openedAt: times[0]! }} />)).toContain("Join call");
    expect(text(<EmbedCard embed={{ ...call, state: "notRecorded", openedAt: times[0]!, endedAt: times[0]! + 60_000 }} />)).toContain("This call wasn't recorded.");
  });
});
