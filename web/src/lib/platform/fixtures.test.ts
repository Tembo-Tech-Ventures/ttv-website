import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as C from "./contracts";
import * as F from "./fixtures";

const fixtures = { ...F };

// Exhaustive at compile time: adding any fixture export requires a parsing test.
const schemas = {
  FIXTURE_NOTICE: z.string(), FIXTURE_NOW: C.Timestamp, fixtureIds: z.record(z.string(), C.Id),
  people: z.record(z.string(), C.PersonSummary), temboAuthor: C.AuthorSummary,
  meByPersona: z.record(z.string(), C.Me), channels: z.record(z.string(), C.Channel), channelList: C.ChannelList,
  projects: z.record(z.string(), C.ProjectEmbed), sessionClip: C.SessionClipEmbed, messages: z.record(z.string(), C.Message),
  communityMessages: C.MessageList, communityThread: C.MessageList, cohortMessages: C.MessageList, cohortThread: C.MessageList,
  hiddenMessageDelta: C.MessageList,
  attention: C.AttentionList, attentionCount: C.AttentionCount, searchResults: C.SearchResults, mentors: C.MentorDirectory,
  pendingMentorRequest: C.MentorRequest, acceptedMentorRequest: C.MentorRequest, brianMentorRequest: C.MentorRequest,
  availability: C.MentorAvailability, moderationQueue: C.ModerationQueue,
  temboPending: C.TemboResponse, temboAnswer: C.TemboResponse, flagsAdmin: C.FlagsAdmin,
} satisfies Record<keyof typeof F, z.ZodType>;

describe("synthetic fixtures", () => {
  it("removes a hidden message from reader caches without sending its content", () => {
    const delta = C.MessageList.parse(F.hiddenMessageDelta);
    expect(delta.removedIds).toEqual([F.messages.hidden.id]);
    expect(delta.items).toEqual([]);
    expect(JSON.stringify(delta)).not.toContain(F.messages.hidden.body);
    expect(delta.sinceCursor).not.toBe(F.communityMessages.sinceCursor);
  });

  it.each(Object.keys(schemas) as (keyof typeof F)[])("parses and JSON round-trips %s without dropping fields", (key) => {
    const value = fixtures[key];
    expect(schemas[key].parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
  });

  it("labels the dataset synthetic and never points project links at real people's repositories", () => {
    expect(F.FIXTURE_NOTICE).toMatch(/Synthetic.*fictional.*Not production/);
    for (const project of Object.values(F.projects)) expect(new URL(project.link).hostname).toBe("example.com");
    for (const p of Object.values(F.people)) expect(p.avatarUrl).toBeNull();
  });

  it("provides a me object for every persona, including every requested Kenyan persona", () => {
    expect(Object.keys(F.meByPersona).toSorted()).toEqual(Object.keys(F.people).toSorted());
    expect(Object.values(F.people).map((p) => p.name)).toEqual(expect.arrayContaining([
      "Wanjiku Mwangi", "Achieng Otieno", "David Kamau", "Lucy Chebet", "Joseph Mutua",
      "Amina Hassan", "Kevin Omondi", "Brian Kiprop", "Faith Njeri",
    ]));
    for (const key of Object.keys(F.people) as (keyof typeof F.people)[]) {
      expect(F.meByPersona[key].user).toEqual(F.people[key]);
      expect(F.meByPersona[key].spaces.at(-1)).toBe("profile");
    }
    expect(F.meByPersona.lucy.spaces).toEqual(["community", "profile"]);
    expect(F.meByPersona.lucy.capabilities.cohortIds).toEqual([]);
    expect(F.meByPersona.joseph.spaces).toEqual(["community", "mentoring", "discover", "profile"]);
    expect(F.meByPersona.achieng.spaces).toContain("cohort");
    expect(F.meByPersona.amina.spaces).toContain("discover");
    expect(F.meByPersona.amina.spaces).not.toContain("mentoring");
  });

  it("keeps prototype thread counts, parents, channels and participants internally consistent", () => {
    for (const [parent, thread] of [[F.messages.projectPost, F.communityThread], [F.messages.cohortAsk, F.cohortThread]] as const) {
      expect(thread.thread).toBe(parent.id);
      expect(parent.thread.replyCount).toBe(thread.items.length);
      expect(parent.thread.lastReplyAt).toBe(Math.max(...thread.items.map((m) => m.createdAt)));
      expect(new Set(parent.thread.participantIds)).toEqual(new Set(thread.items.flatMap((m) => m.author.id ? [m.author.id] : [])));
      for (const reply of thread.items) {
        expect(reply.parentId).toBe(parent.id);
        expect(reply.channelId).toBe(parent.channelId);
      }
    }
    const all = Object.values(F.messages);
    expect(new Set(all.map((m) => m.id)).size).toBe(all.length);
    for (const m of all) expect(Object.values(F.channels).some((c) => c.id === m.channelId)).toBe(true);
  });

  it("preserves revision-bound confirmation evidence without claiming the newer work is confirmed", () => {
    expect(F.projects.chamaLedger.version).toBe(3);
    expect(F.projects.chamaLedger.confirmations).toEqual([{ mentorId: F.people.david.id, mentorName: "David Kamau", version: 2 }]);
    expect(F.messages.communityAnswer.body).toContain("doesn't yet cover this change");
    expect(F.projects.fareSplitter.confirmations[0].version).toBe(4);
  });

  it("keeps cohort recordings and community-only Lucy out of community/cross-cohort fixtures", () => {
    for (const m of Object.values(F.messages)) {
      if (m.channelId !== F.channels.cohort04.id) {
        expect(m.embeds.some((e) => e.type === "sessionClip")).toBe(false);
        expect(m.citations.some((c) => c.type === "sessionClip")).toBe(false);
      } else {
        expect(m.author.id).not.toBe(F.people.lucy.id);
      }
    }
    expect(F.messages.sessionTime.author.id).toBe(F.people.brian.id);
    expect(F.searchResults.sessionMoments[0].visibility.kind).toBe("COHORT");
    expect(F.searchResults.sessionMoments[0].visibility.label).toContain("only you and your cohort");
  });

  it("aligns attention counts with unread items and the current persona", () => {
    const unread = F.attention.items.filter((a) => a.readAt === null);
    expect(unread).toHaveLength(F.attentionCount.count);
    for (const space of C.SPACE_ORDER) expect(F.attentionCount.unreadCounts[space]).toBe(unread.filter((a) => a.space === space).length);
    expect(F.meByPersona.wanjiku.unreadCounts).toEqual(F.attentionCount.unreadCounts);
    expect(F.attention.items[0].subject.id).toBe(F.acceptedMentorRequest.id);
  });

  it("covers capacity, all moderation sources and both Tembo response states", () => {
    expect(F.mentors.items[0].capacity).toEqual({ used: 1, limit: 3, nextOpeningAt: null });
    expect(F.mentors.items[1].capacity.used).toBe(F.mentors.items[1].capacity.limit);
    expect(F.mentors.items[1].capacity.nextOpeningAt).toBe(Date.parse("2026-12-01T00:00:00+03:00"));
    expect(F.moderationQueue.items.map((i) => i.source).toSorted()).toEqual([...C.ModerationSource.options].toSorted());
    expect(F.messages.flagged.moderation?.state).toBe("FLAGGED");
    expect(F.messages.flagged.body).not.toBe("");
    expect(F.messages.hidden.moderation?.state).toBe("HIDDEN");
    expect(F.temboPending.status).toBe("pending");
    expect(F.temboAnswer.status).toBe("answer");
  });
});
