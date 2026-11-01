import { and, eq, exists, inArray, or, sql } from "drizzle-orm";
import { accessRequest, attentionItem, communityJourney, profileContact, programApplication, recording, studentProfile, type Database } from "@/lib/db/schema";
import type { PlatformCapabilities } from "@/lib/platform/server/capabilities";

/**
 * Shared by list/count/read: historical notification delivery never preserves revoked access.
 * Access requests: the requester sees their decision; administrators see a request only while it is
 * still pending, so a request another administrator decided, or its owner withdrew, leaves every bell.
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
      and(eq(attentionItem.subjectKind, "accessRequest"), exists(db.select({ id: accessRequest.id }).from(accessRequest)
        .where(and(eq(accessRequest.id, attentionItem.subjectId), or(
          and(eq(attentionItem.kind, "access_decided"), eq(accessRequest.userId, userId)),
          capabilities.isAdmin ? and(eq(attentionItem.kind, "access_request"), eq(accessRequest.status, "PENDING")) : sql`0`,
        ))))),
    ),
  );
}
