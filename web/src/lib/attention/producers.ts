import { createId } from "@paralleldrive/cuid2";
import { isFlagEnabled, type FlagContext } from "@/lib/platform/server/flags";
import type { AttentionKind, SpaceId, SubjectRef } from "@/lib/platform/contracts";

export interface AttentionProducerContext {
  db: D1Database;
  env: FlagContext["env"];
}
interface EventItem {
  userId: string;
  eventKey: string;
  kind: AttentionKind;
  space: SpaceId;
  subject: SubjectRef;
  actorId: string | null;
  summary: string;
}

async function persist(context: AttentionProducerContext, item: EventItem) {
  if (!await isFlagEnabled({ ...context, user: { id: item.userId } }, "spaces")) return;
  await context.db.prepare(`INSERT INTO attention_item
    (id,userId,eventKey,kind,space,category,subjectKind,subjectId,subjectHref,subjectLabel,actorId,summary,createdAt)
    VALUES (?,?,?,?,?,'updates',?,?,?,?,?,?,?) ON CONFLICT(userId,eventKey) DO NOTHING`)
    .bind(createId(), item.userId, item.eventKey, item.kind, item.space,
      item.subject.kind, item.subject.id, item.subject.href, item.subject.label,
      item.actorId, item.summary, Date.now()).run();
}

/** Attention is secondary: failure must never turn a committed domain event into a failed mutation. */
async function bestEffort(work: () => Promise<void>) {
  try { await work(); }
  catch { console.warn("Attention event could not be recorded."); }
}

// These are internal post-commit adapters, never request-payload handlers.
// Every recipient and every displayed fact is loaded from the persisted domain event.
export function applicationStatusAttention(context: AttentionProducerContext, applicationId: string, actorId: string) {
  return bestEffort(async () => {
    const row = await context.db.prepare(`SELECT a.userId,a.status FROM programApplication a
      WHERE a.id=? AND a.status<>'PENDING' AND EXISTS
      (SELECT 1 FROM UserRoles ur JOIN Roles r ON r.id=ur.roleId WHERE ur.userId=? AND r.name='ADMIN')`)
      .bind(applicationId, actorId).first<{ userId: string; status: string }>();
    if (!row) return;
    // The existing application state machine is acyclic: each status is reached at most once.
    await persist(context, { userId: row.userId, actorId, kind: "application_status", space: "cohort",
      eventKey: JSON.stringify(["application_status", applicationId, row.status]),
      subject: { kind: "application", id: applicationId, href: `/dashboard/application/${encodeURIComponent(applicationId)}`, label: "Your application" },
      summary: `Your application status changed to ${row.status.toLowerCase()}.` });
  });
}

export function recordingReadyAttention(context: AttentionProducerContext, recordingId: string) {
  return bestEffort(async () => {
    const rows = await context.db.prepare(`SELECT a.userId FROM recording r
      JOIN programApplication a ON a.programId=r.programId
      WHERE r.id=? AND r.processingStatus='complete' AND a.status IN ('APPROVED','AUDIT','COMPLETED')
      UNION SELECT pr.userId FROM recording r JOIN programRole pr ON pr.programId=r.programId
      WHERE r.id=? AND r.processingStatus='complete' AND pr.name IN ('INSTRUCTOR','TA','MENTOR')`)
      .bind(recordingId, recordingId).all<{ userId: string }>();
    for (const row of rows.results) await persist(context, {
      userId: row.userId, actorId: null, kind: "recording_ready", space: "cohort",
      eventKey: JSON.stringify(["recording_ready", recordingId]),
      subject: { kind: "recording", id: recordingId, href: `/dashboard/sessions/${encodeURIComponent(recordingId)}`, label: "Cohort recording" },
      summary: "A recording in your cohort is ready to watch.",
    });
  });
}

export function workConfirmedAttention(context: AttentionProducerContext, confirmationId: string) {
  return bestEffort(async () => {
    const row = await context.db.prepare(`SELECT j.userId,j.id AS journeyId,c.mentorId,c.journeyVersion
      FROM communityConfirmation c JOIN communityJourney j ON j.id=c.journeyId
      WHERE c.id=? AND c.mentorId<>j.userId AND c.mentorRole IN ('MENTOR','ADMIN')`)
      .bind(confirmationId).first<{ userId: string; journeyId: string; mentorId: string; journeyVersion: number }>();
    if (!row) return;
    await persist(context, { userId: row.userId, actorId: row.mentorId, kind: "work_confirmed", space: "profile",
      eventKey: JSON.stringify(["work_confirmed", confirmationId]),
      subject: { kind: "journey", id: row.journeyId, href: "/dashboard/community", label: "Your contribution" },
      summary: `Your contribution at revision ${row.journeyVersion} received a confirmation.` });
  });
}

export function visitorMessageAttention(context: AttentionProducerContext, contactId: string) {
  return bestEffort(async () => {
    const row = await context.db.prepare(`SELECT p.userId FROM profileContact c
      JOIN studentProfile p ON p.id=c.profileId WHERE c.id=?`)
      .bind(contactId).first<{ userId: string }>();
    if (!row) return;
    await persist(context, { userId: row.userId, actorId: null, kind: "visitor_message", space: "profile",
      eventKey: JSON.stringify(["visitor_message", contactId]),
      subject: { kind: "visitorMessage", id: contactId, href: "/dashboard/leads", label: "Visitor message" },
      summary: "You received a new message through your profile." });
  });
}
