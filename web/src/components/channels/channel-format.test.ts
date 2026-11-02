import { describe, expect, it } from "vitest";
import { channels, FIXTURE_NOW, messages, meByPersona, people } from "@/lib/platform/fixtures";
import { MASKED_CONTACT, type Channel, type Message } from "@/lib/platform/contracts";
import {
  messageActionsLabel,
  ago, channelTitle, clipTime, clock, composerTools, dayKey, dayLabel, fullTime, groupByDay, mentionsTembo, moderationNotice,
  openingDivider, parseBody, postingFor, reviewState, temboReach, temboResetsIn, temboScope, temboSees, threadSummary,
} from "./channel-format";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
// FIXTURE_NOW is 2026-11-03 07:00 UTC, 10:00 in Nairobi, a Tuesday.
const now = FIXTURE_NOW;

describe("days and times", () => {
  it("reads days in Nairobi, so the day turns at Nairobi midnight", () => {
    expect(dayKey(now)).toBe("2026-11-03");
    // 21:30 UTC on the 2nd is 00:30 on the 3rd in Nairobi.
    expect(dayKey(Date.parse("2026-11-02T21:30:00Z"))).toBe("2026-11-03");
    expect(dayKey(Date.parse("2026-11-02T20:59:00Z"))).toBe("2026-11-02");
  });

  it("names today, yesterday, this week's days, then dates", () => {
    expect(dayLabel(now - 30 * MINUTE, now)).toBe("Today");
    expect(dayLabel(now - DAY, now)).toBe("Yesterday");
    expect(dayLabel(now - 3 * DAY, now)).toBe("Saturday");
    expect(dayLabel(now - 9 * DAY, now)).toBe("Sunday 25 October");
    expect(dayLabel(Date.parse("2025-12-24T09:00:00Z"), now)).toBe("24 December 2025");
  });

  it("writes the 24-hour clock in Nairobi time", () => {
    expect(clock(now)).toBe("10:00");
    expect(clock(Date.parse("2026-11-03T13:40:00Z"))).toBe("16:40");
    // The full moment names its zone (QA2-13).
    expect(fullTime(Date.parse("2026-11-03T13:40:00Z"))).toMatch(/^Tuesday,? 3 November 2026 at 16:40 EAT$/);
  });

  it("says how long ago a reply was", () => {
    expect(ago(now - 10_000, now)).toBe("just now");
    expect(ago(now - 12 * MINUTE, now)).toBe("12 min ago");
    expect(ago(now - 3 * 60 * MINUTE, now)).toBe("3 h ago");
    expect(ago(now - DAY, now)).toBe("yesterday");
    expect(ago(now - 3 * DAY, now)).toBe("on Saturday");
    // A clock that runs ahead of the server never says "in the future".
    expect(ago(now + MINUTE, now)).toBe("just now");
  });

  it("groups messages under one heading per day, keeping their order", () => {
    const groups = groupByDay([messages.projectPost, messages.firstPr, messages.mentorOffer], now);
    expect(groups.map((group) => [group.label, group.messages.map((m) => m.id)])).toEqual([
      ["Yesterday", [messages.projectPost.id]],
      ["Today", [messages.firstPr.id, messages.mentorOffer.id]],
    ]);
    expect(groupByDay([], now)).toEqual([]);
  });

  it("starts a group at the New divider, so its day's heading sits right under it (QA2-18)", () => {
    const list = [messages.projectPost, messages.firstPr, messages.mentorOffer];
    // Mid-day: today is said again under the divider.
    expect(groupByDay(list, now, messages.mentorOffer.id).map((group) => [group.label, group.messages.map((m) => m.id)])).toEqual([
      ["Yesterday", [messages.projectPost.id]],
      ["Today", [messages.firstPr.id]],
      ["Today", [messages.mentorOffer.id]],
    ]);
    // The first of its day: still one heading for the day, and the keys stay unique.
    const opening = groupByDay(list, now, messages.firstPr.id);
    expect(opening.map((group) => [group.label, group.messages.map((m) => m.id)])).toEqual([
      ["Yesterday", [messages.projectPost.id]],
      ["Today", [messages.firstPr.id, messages.mentorOffer.id]],
    ]);
    expect(new Set(groupByDay(list, now, messages.mentorOffer.id).map((group) => group.key)).size).toBe(3);
  });

  it("writes positions in a recording", () => {
    expect(clipTime(2052)).toBe("34:12");
    expect(clipTime(59.9)).toBe("0:59");
    expect(clipTime(3723)).toBe("1:02:03");
    expect(clipTime(-4)).toBe("0:00");
  });
});

describe("message bodies", () => {
  it("finds @tembo and the longest known name, and stops at word ends", () => {
    const [paragraph] = parseBody("@tembo ask @David Kamau, not @Davidson or @temboX.", ["David", "David Kamau"]);
    expect(paragraph).toEqual([
      { kind: "mention", text: "@tembo", tembo: true },
      { kind: "text", text: " ask " },
      { kind: "mention", text: "@David Kamau", tembo: false },
      { kind: "text", text: ", not " },
      { kind: "mention", text: "@Davidson", tembo: false },
      { kind: "text", text: " or " },
      { kind: "mention", text: "@temboX", tembo: false },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves email addresses and lone at-signs as text", () => {
    expect(parseBody("mail synthetic@example.com @ noon")).toEqual([[{ kind: "text", text: "mail synthetic@example.com @ noon" }]]);
  });

  it("links bare web addresses without the sentence's punctuation, and nothing else", () => {
    expect(parseBody("See https://example.com/synthetic/a?b=1. Or javascript:alert(1)")).toEqual([[
      { kind: "text", text: "See " },
      { kind: "link", text: "https://example.com/synthetic/a?b=1", href: "https://example.com/synthetic/a?b=1" },
      { kind: "text", text: ". Or javascript:alert(1)" },
    ]]);
  });

  it("ends a link at a masked contact marker, so the marker stays whole text (#297 follow-up)", () => {
    const [paragraph] = parseBody(`Chat on https://wa.me/${MASKED_CONTACT}?text=hi or https://${MASKED_CONTACT} today`);
    expect(paragraph).toEqual([
      { kind: "text", text: "Chat on " },
      { kind: "link", text: "https://wa.me/", href: "https://wa.me/" },
      { kind: "text", text: `${MASKED_CONTACT}?text=hi or https://${MASKED_CONTACT} today` },
    ]);
  });

  it("never lets a label hide where a link goes: Markdown links show their address", () => {
    const [paragraph] = parseBody("[your bank](https://evil.example)");
    expect(paragraph).toEqual([
      { kind: "text", text: "[your bank](" },
      { kind: "link", text: "https://evil.example", href: "https://evil.example" },
      { kind: "text", text: ")" },
    ]);
    expect(paragraph.every((segment) => segment.kind !== "link" || segment.text === segment.href)).toBe(true);
  });

  it("keeps inline code literal, including at-signs inside it", () => {
    expect(parseBody("Run `npm test @tembo` first")).toEqual([[
      { kind: "text", text: "Run " },
      { kind: "code", text: "npm test @tembo" },
      { kind: "text", text: " first" },
    ]]);
    expect(parseBody("an `unclosed tick")).toEqual([[{ kind: "text", text: "an `unclosed tick" }]]);
  });

  it("splits paragraphs on blank lines and keeps single line breaks in the text", () => {
    expect(parseBody("one\ntwo\r\n\r\n\n three\n\n  ")).toEqual([
      [{ kind: "text", text: "one\ntwo" }],
      [{ kind: "text", text: " three" }],
    ]);
  });

  it("knows when a body asks Tembo", () => {
    expect(mentionsTembo(messages.communityAsk.body)).toBe(true);
    expect(mentionsTembo("tembo, without the at")).toBe(false);
    expect(mentionsTembo("`@tembo` in code")).toBe(false);
  });
});

describe("the New divider", () => {
  const list = [messages.recordingPost, messages.duplicateQuestion, messages.cohortAsk, messages.sessionTime, messages.sessionTimeReply, messages.mention];
  const wanjikuId = people.wanjiku.id;

  it("sits before the first message by someone else after the marker", () => {
    expect(openingDivider(list, { markerId: messages.recordingPost.id, unreadCount: 4 }, wanjikuId)).toBe(messages.duplicateQuestion.id);
    // Wanjiku's own question after the marker is not news to her.
    expect(openingDivider(list, { markerId: messages.duplicateQuestion.id, unreadCount: 3 }, wanjikuId)).toBe(messages.sessionTime.id);
  });

  it("has nowhere to go when everything is read", () => {
    expect(openingDivider(list, { markerId: messages.mention.id, unreadCount: 0 }, wanjikuId)).toBeNull();
    expect(openingDivider(list, { markerId: null, unreadCount: 0 }, wanjikuId)).toBeNull();
    expect(openingDivider([], { markerId: null, unreadCount: 3 }, wanjikuId)).toBeNull();
  });

  it("counts back from the end when the marker is older than anything loaded, or there is none", () => {
    expect(openingDivider(list, { markerId: "older-than-the-page", unreadCount: 2 }, wanjikuId)).toBe(messages.sessionTimeReply.id);
    expect(openingDivider(list, { markerId: null, unreadCount: 99 }, wanjikuId)).toBe(messages.recordingPost.id);
  });

  it("skips messages hidden from members, which a moderator still receives (N1)", () => {
    const hidden: Message = { ...messages.duplicateQuestion, moderation: { state: "HIDDEN", reasons: ["Harsh, not about the work"] } };
    const flagged: Message = { ...messages.sessionTime, moderation: { state: "FLAGGED", reasons: ["Contact details"] } };
    const moderated = [messages.recordingPost, hidden, messages.cohortAsk, flagged, messages.sessionTimeReply, messages.mention];
    expect(openingDivider(moderated, { markerId: messages.recordingPost.id, unreadCount: 3 }, wanjikuId)).toBe(flagged.id);
    // Counting back from the end skips it too: the unread count never included it.
    expect(openingDivider(moderated, { markerId: null, unreadCount: 4 }, wanjikuId)).toBe(messages.recordingPost.id);
    expect(openingDivider([messages.recordingPost, hidden], { markerId: messages.recordingPost.id, unreadCount: 0 }, wanjikuId)).toBeNull();
  });
});

describe("threads", () => {
  it("summarises replies and the last one", () => {
    expect(threadSummary(messages.projectPost, now)).toEqual({ replies: "5 replies", last: "last 1 h ago" });
    const one: Message = { ...messages.firstPr, thread: { replyCount: 1, participantIds: [], lastReplyAt: now - 12 * MINUTE } };
    expect(threadSummary(one, now)).toEqual({ replies: "1 reply", last: "last 12 min ago" });
    expect(threadSummary(messages.firstPr, now).last).toBeNull();
  });
});

describe("where a hidden message's review stands", () => {
  const hidden = (moderation: Partial<NonNullable<Message["moderation"]>>, deleted = false): Message => ({
    ...messages.hidden, deleted, moderation: { state: "HIDDEN", reasons: ["Harsh"], ...moderation },
  });

  it.each([
    [{ reviewable: true }, "available"],
    [{ reviewable: true, reviewRequested: false }, "available"],
    [{ reviewable: true, reviewRequested: true }, "requested"],
    [{ reviewable: false }, "final"],
    [{ reviewable: false, reviewRequested: false }, "final"],
    [{ reviewable: false, reviewRequested: true }, "final"],
    // An admin who is not the author learns only whether a review is open.
    [{ reviewRequested: true }, "requested"],
    [{ reviewRequested: false }, null],
    [{}, null],
  ] as const)("%j is %s", (moderation, state) => {
    expect(reviewState(hidden(moderation))).toBe(state);
  });

  it("is nothing for a deleted, visible, flagged or unmoderated message", () => {
    expect(reviewState(hidden({ reviewable: true }, true))).toBeNull();
    expect(reviewState({ ...messages.hidden, moderation: { state: "FLAGGED", reasons: [], reviewable: true } })).toBeNull();
    expect(reviewState({ ...messages.hidden, moderation: { state: "VISIBLE", reasons: [] } })).toBeNull();
    expect(reviewState(messages.firstPr)).toBeNull();
  });
});

describe("moderation notices", () => {
  it("tells the author a flag keeps the message up until a person decides", () => {
    expect(moderationNotice(messages.flagged, people.peter.id)).toEqual({
      state: "FLAGGED",
      title: "Flagged for a moderator: Contact details",
      detail: "Your message stays up until a person looks at it. Only you can see this note.",
    });
  });

  it("tells the author their hidden message is theirs alone now", () => {
    expect(moderationNotice(messages.hidden, people.dennis.id)?.title).toBe("Hidden from the channel: Harsh, not about the work");
    expect(moderationNotice(messages.hidden, people.dennis.id)?.detail).toBe("Only you can see this message now.");
  });

  it("tells a moderator who is not an admin what happens after a hide, and an admin only that it is hidden (QA2-11)", () => {
    expect(moderationNotice(messages.hidden, people.david.id)?.detail).toBe(
      "Moderators can still see it. An admin looks at every hide, and Dennis can ask for a review unless an admin made or upheld the hide. If an admin restores it, members see it here again.",
    );
    expect(moderationNotice(messages.hidden, people.amina.id, { admin: true })?.detail).toBe("Moderators can still see it.");
  });

  it("words the same states for a moderator who is not the author", () => {
    expect(moderationNotice(messages.hidden, people.amina.id)?.title).toBe("Hidden from members: Harsh, not about the work");
    expect(moderationNotice(messages.flagged, null)?.title).toBe("Flagged: Contact details");
  });

  it("says nothing for visible, unmoderated or deleted messages", () => {
    expect(moderationNotice(messages.reported, people.collins.id)).toBeNull();
    expect(moderationNotice(messages.firstPr, people.brian.id)).toBeNull();
    const deleted: Message = { ...messages.deleted, moderation: { state: "HIDDEN", reasons: ["Spam"] } };
    expect(moderationNotice(deleted, people.brian.id)).toBeNull();
  });

  it("does without reasons the server left out", () => {
    const flagged: Message = { ...messages.flagged, moderation: { state: "FLAGGED", reasons: [] } };
    expect(moderationNotice(flagged, people.peter.id)?.title).toBe("Flagged for a moderator");
  });
});

describe("the composer", () => {
  const flags = meByPersona.wanjiku.flags;

  it("offers a session clip only in a cohort channel that allows one", () => {
    expect(composerTools(channels.cohort04, flags).sessionClip).toBe(true);
    expect(composerTools(channels.cohortAnnouncements, flags).sessionClip).toBe(false);
    expect(composerTools(channels.showYourWork, flags).sessionClip).toBe(false);
  });

  it("never offers a session clip in community, even if a capability says so", () => {
    const community: Channel = { ...channels.showYourWork, capabilities: { canPost: true, canModerate: true, canShareSessionClip: true } };
    expect(composerTools(community, flags).sessionClip).toBe(false);
    const direct: Channel = { ...channels.davidConversation, capabilities: { ...community.capabilities } };
    expect(composerTools(direct, flags).sessionClip).toBe(false);
  });

  it("hides Ask Tembo while tembo_channels is off", () => {
    expect(composerTools(channels.cohort04, flags).askTembo).toBe(true);
    expect(composerTools(channels.cohort04, { ...flags, tembo_channels: false }).askTembo).toBe(false);
  });

  it("says why a person cannot post", () => {
    expect(postingFor(channels.cohort04)).toBe("open");
    expect(postingFor(channels.cohortAnnouncements)).toBe("staff");
    expect(postingFor({ ...channels.help, capabilities: { ...channels.help.capabilities, canPost: false } })).toBe("closed");
    expect(postingFor({ ...channels.help, archivedAt: now })).toBe("archived");
  });

  it("states Tembo's reach for each kind of channel", () => {
    expect(temboScope(channels.cohort04)).toMatch(/^This cohort's recordings and this channel\. Never private/);
    expect(temboScope(channels.showYourWork)).toMatch(/Never cohort recordings/);
    expect(temboScope(channels.davidConversation)).toBe("Only this conversation, and only when you ask.");
  });

  it("says the same reach everywhere, only what B-3.1 reads, and the same for an answer's stored scope", () => {
    const community = "this channel, projects shared in it and public builder profiles";
    expect(temboScope(channels.showYourWork)).toBe(`This channel, projects shared in it and public builder profiles. Never cohort recordings or private conversations.`);
    expect(temboReach(channels.showYourWork)).toBe(community);
    expect(temboSees("COMMUNITY")).toBe(community);
    expect(temboReach(channels.cohort04)).toBe(temboSees("COHORT"));
    expect(temboSees("DIRECT")).toBe("only this conversation");
  });

  it("says when today's questions to Tembo come back", () => {
    expect(temboResetsIn(now + 30_000, now)).toBe("in 1 minute");
    expect(temboResetsIn(now + 59 * 60_000, now)).toBe("in 59 minutes");
    expect(temboResetsIn(now + 60 * 60_000, now)).toBe("in about 1 hour");
    expect(temboResetsIn(now + 200 * 60_000, now)).toBe("in about 3 hours");
    expect(temboResetsIn(now - 1, now)).toBe("in 1 minute");
  });

  it("writes channels with a hash and conversations by name", () => {
    expect(channelTitle(channels.showYourWork)).toBe("#show-your-work");
    expect(channelTitle(channels.davidConversation)).toBe("David Kamau");
  });
});

describe("a message's actions button (QA2-05)", () => {
  const at = Date.UTC(2026, 10, 2, 6, 5);
  const from = (body: string, extra: Partial<Message> = {}): Message => ({ ...messages.mentorOffer, body, createdAt: at, ...extra });

  it("says whose message, when, and how it starts, so one person's messages have different names", () => {
    const first = messageActionsLabel(from("Anyone free to pair on the **webhook** retries?"));
    const second = messageActionsLabel(from("Thanks, that fixed it."));
    expect(first).toBe(`Actions for ${messages.mentorOffer.author.name}'s message at 09:05: “Anyone free to pair on the webhook retries?”`);
    expect(second).not.toBe(first);
  });

  it("quotes only the opening words, cut at a word", () => {
    const label = messageActionsLabel(from("If the provider sends the same callback twice, the second one should change nothing at all."));
    expect(label).toMatch(/: “If the provider sends the same callback twice,…”$/);
  });

  it("names shared work when there are no words, and a deleted message by its time", () => {
    expect(messageActionsLabel(from("", { embeds: messages.projectPost.embeds }))).toMatch(/: “.+”$/);
    expect(messageActionsLabel(from("", { deleted: true, embeds: [] }))).toBe("Actions for the deleted message at 09:05");
  });
});
