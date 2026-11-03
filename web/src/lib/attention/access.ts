import { and, eq, exists, inArray, or, sql } from "drizzle-orm";
import {
  accessRequest, attentionItem, channel, channelMember, channelMessage, communityJourney, mentorRequest, mentorRequestCase, mentorRequestReport, moderationCase, profileContact,
  programApplication, recording, studentProfile, type Database,
} from "@/lib/db/schema";
import { HELD, MENTOR_SEES } from "@/lib/mentoring/visibility";
import type { PlatformCapabilities } from "@/lib/platform/server/capabilities";

/**
 * Shared by list/count/read: historical notification delivery never preserves revoked access.
 * Access requests: the requester sees their decision; administrators see a request only while it is
 * still pending, so a request another administrator decided, or its owner withdrew, leaves every bell.
 * Messages (B-2.5): a hidden-message notice while the author's message stays hidden; an admin's
 * decision on their message for its author while it is still the case's decision (B-3.2); a moderation
 * notice while its case is pending, for admins; a mention or Tembo's answer while the message is
 * visible in a channel the person can still read, their own direct conversations included (B-4.1).
 * Mentor requests (B-4.1): each notice to the party it was for, the mentor or the person asking; the
 * mentor's only while they may see the request (a check can hold it back), a new request's only while
 * it waits for their answer, the asker's notice that a check is open only while it is, and an open
 * check's notice for admins while it stays open on a request still waiting or reported.
 */
export function attentionAccess(db: Database, userId: string, capabilities: PlatformCapabilities) {
  return and(
    inArray(attentionItem.space, capabilities.spaces),
    or(
      and(eq(attentionItem.subjectKind, "application"), exists(db.select({ id: programApplication.id }).from(programApplication)
        .where(and(eq(programApplication.id, attentionItem.subjectId), eq(programApplication.userId, userId))))),
      and(eq(attentionItem.subjectKind, "journey"), exists(db.select({ id: communityJourney.id }).from(communityJourney)
        .where(and(eq(communityJourney.id, attentionItem.subjectId), eq(communityJourney.userId, userId))))),
      and(eq(attentionItem.subjectKind, "visitorMessage"), exists(db.select({ id: profileContact.id }).from(profileContact)
        .innerJoin(studentProfile, eq(profileContact.profileId, studentProfile.id))
        .where(and(eq(profileContact.id, attentionItem.subjectId), eq(studentProfile.userId, userId))))),
      and(eq(attentionItem.subjectKind, "recording"), exists(db.select({ id: recording.id }).from(recording)
        .where(and(eq(recording.id, attentionItem.subjectId), capabilities.isAdmin ? sql`1`
          : sql`${recording.programId} IN (SELECT value FROM json_each(${JSON.stringify(capabilities.cohortIds)}))`)))),
      and(eq(attentionItem.subjectKind, "message"), exists(db.select({ id: channelMessage.id }).from(channelMessage)
        .innerJoin(channel, eq(channel.id, channelMessage.channelId))
        .where(and(eq(channelMessage.id, attentionItem.subjectId), sql`${channelMessage.deletedAt} IS NULL`, or(
          and(eq(attentionItem.kind, "message_hidden"), eq(channelMessage.authorId, userId), eq(channelMessage.moderationState, "HIDDEN")),
          // Only the latest decision's notice: its eventKey carries the decidedAt it describes (channel-producers.ts).
          and(eq(attentionItem.kind, "moderation_decided"), eq(channelMessage.authorId, userId), exists(db.select({ id: moderationCase.messageId })
            .from(moderationCase).where(and(eq(moderationCase.messageId, channelMessage.id), eq(moderationCase.state, "DECIDED"),
              sql`json_extract(${attentionItem.eventKey}, '$[2]') = ${moderationCase.decidedAt}`)))),
          capabilities.isAdmin ? and(eq(attentionItem.kind, "moderation_pending"), exists(db.select({ id: moderationCase.messageId })
            .from(moderationCase).where(and(eq(moderationCase.messageId, channelMessage.id), eq(moderationCase.state, "PENDING"))))) : sql`0`,
          and(inArray(attentionItem.kind, ["mention", "tembo_answer"]), sql`${channelMessage.moderationState} <> 'HIDDEN'`, or(
            eq(channel.kind, "COMMUNITY"),
            and(eq(channel.kind, "COHORT"), capabilities.isAdmin ? sql`1`
              : sql`${channel.programId} IN (SELECT value FROM json_each(${JSON.stringify(capabilities.cohortIds)}))`),
            and(eq(channel.kind, "DIRECT"), exists(db.select({ id: channelMember.userId }).from(channelMember)
              .where(and(eq(channelMember.channelId, channel.id), eq(channelMember.userId, userId))))),
          )),
        ))))),
      and(eq(attentionItem.subjectKind, "mentorRequest"), exists(db.select({ id: mentorRequest.id }).from(mentorRequest)
        .where(and(eq(mentorRequest.id, attentionItem.subjectId), or(
          // A new request's notice only while it still waits for this mentor's answer (QA4-07).
          and(eq(attentionItem.kind, "mentor_request"), eq(mentorRequest.mentorId, userId), eq(mentorRequest.status, "PENDING"),
            sql.raw(`${MENTOR_SEES(`"mentor_request"`)} AND NOT ${HELD(`"mentor_request"`)}`)),
          and(eq(attentionItem.kind, "mentor_withdrawn"), eq(mentorRequest.mentorId, userId), sql.raw(MENTOR_SEES(`"mentor_request"`))),
          and(inArray(attentionItem.kind, ["mentor_accepted", "mentor_redirected", "mentor_declined"]), eq(mentorRequest.requesterId, userId)),
          // A check's notice only while it still describes the check (mentor-producers.ts keys the notice at $[2] and
          // its time at $[3]): "waiting" or "checking" while that very opening is open on a waiting request, and a
          // decision while it is the check's latest.
          and(eq(attentionItem.kind, "mentor_checked"), eq(mentorRequest.requesterId, userId), exists(db.select({ id: mentorRequestCase.requestId })
            .from(mentorRequestCase).where(and(eq(mentorRequestCase.requestId, mentorRequest.id), or(
              and(sql`json_extract(${attentionItem.eventKey}, '$[2]') IN ('waiting', 'checking')`, eq(mentorRequestCase.state, "OPEN"),
                eq(mentorRequest.status, "PENDING"), sql`json_extract(${attentionItem.eventKey}, '$[3]') = ${mentorRequestCase.openedAt}`),
              and(sql`json_extract(${attentionItem.eventKey}, '$[2]') NOT IN ('waiting', 'checking')`, eq(mentorRequestCase.state, "DECIDED"),
                sql`json_extract(${attentionItem.eventKey}, '$[3]') = ${mentorRequestCase.decidedAt}`),
            ))))),
          capabilities.isAdmin ? and(eq(attentionItem.kind, "moderation_pending"), or(eq(mentorRequest.status, "PENDING"), exists(db.select({ id: mentorRequestReport.requestId })
            .from(mentorRequestReport).where(eq(mentorRequestReport.requestId, mentorRequest.id)))), exists(db.select({ id: mentorRequestCase.requestId })
            .from(mentorRequestCase).where(and(eq(mentorRequestCase.requestId, mentorRequest.id), eq(mentorRequestCase.state, "OPEN"))))) : sql`0`,
        ))))),
      and(eq(attentionItem.subjectKind, "accessRequest"), exists(db.select({ id: accessRequest.id }).from(accessRequest)
        .where(and(eq(accessRequest.id, attentionItem.subjectId), or(
          and(eq(attentionItem.kind, "access_decided"), eq(accessRequest.userId, userId)),
          capabilities.isAdmin ? and(eq(attentionItem.kind, "access_request"), eq(accessRequest.status, "PENDING")) : sql`0`,
        ))))),
    ),
  );
}
