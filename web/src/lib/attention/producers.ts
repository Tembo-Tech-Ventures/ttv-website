import { createId } from "@paralleldrive/cuid2";
import type { FlagContext } from "@/lib/platform/server/flags";
import type { ProgramApplicationStatus } from "@/lib/admin/program-application";
import type { AttentionKind, FlagAudience, SpaceId, SubjectRef } from "@/lib/platform/contracts";

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

/** One audience read per event/bulk operation; OFF never reads the domain sources. */
async function audienceFor(context: AttentionProducerContext): Promise<FlagAudience> {
  // Keep the production aliases identical to the API flag resolver.
  const environment = (context.env.DEPLOYMENT_ENVIRONMENT ?? "")
    .toLowerCase().replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
  if (environment !== "production" && context.env.PLATFORM_FLAGS_OVERRIDE === "all") return "ALL";
  const row = await context.db.prepare("SELECT audience FROM feature_flag WHERE key='spaces'")
    .first<{ audience: FlagAudience }>();
  return row?.audience === "ALL" || row?.audience === "STAFF" ? row.audience : "OFF";
}

async function persist(context: AttentionProducerContext, audience: FlagAudience, items: EventItem[]) {
  if (items.length === 0) return;
  // JSON keeps both the bind count and the number of D1 round trips constant.
  // STAFF eligibility is evaluated from recipient roles inside the INSERT.
  await context.db.prepare(`INSERT INTO attention_item
    (id,userId,eventKey,kind,space,category,subjectKind,subjectId,subjectHref,subjectLabel,actorId,summary,createdAt)
    SELECT json_extract(e.value,'$.id'),json_extract(e.value,'$.userId'),
      json_extract(e.value,'$.eventKey'),json_extract(e.value,'$.kind'),json_extract(e.value,'$.space'),'updates',
      json_extract(e.value,'$.subject.kind'),json_extract(e.value,'$.subject.id'),
      json_extract(e.value,'$.subject.href'),json_extract(e.value,'$.subject.label'),
      json_extract(e.value,'$.actorId'),json_extract(e.value,'$.summary'),?
    FROM json_each(?) e WHERE ?='ALL' OR (?='STAFF' AND EXISTS
      (SELECT 1 FROM UserRoles ur JOIN Roles r ON r.id=ur.roleId
       WHERE ur.userId=json_extract(e.value,'$.userId') AND r.name='ADMIN'))
    ON CONFLICT(userId,eventKey) DO NOTHING`)
    .bind(Date.now(), JSON.stringify(items.map(item => ({ ...item, id: createId() }))), audience, audience).run();
}

const applicationSummary: Record<ProgramApplicationStatus, string> = {
  PENDING: "Your application is awaiting a decision.",
  APPROVED: "You have been accepted into the cohort.",
  REJECTED: "Your application was not accepted.",
  AUDIT: "You have been accepted to audit the cohort.",
  COMPLETED: "You have completed the cohort.",
};

/** Attention is secondary: failure must never turn a committed domain event into a failed mutation. */
async function bestEffort(work: () => Promise<void>) {
  try { await work(); }
  catch { console.warn("Attention event could not be recorded."); }
}

// These are internal post-commit adapters, never request-payload handlers.
// Every recipient and every displayed fact is loaded from the persisted domain event.
export function applicationStatusAttention(context: AttentionProducerContext, applicationIds: readonly string[], actorId: string, status: ProgramApplicationStatus) {
  return bestEffort(async () => {
    const audience = await audienceFor(context);
    if (audience === "OFF" || applicationIds.length === 0 || status === "PENDING") return;
    const { results } = await context.db.prepare(`SELECT a.id,a.userId FROM programApplication a
      WHERE a.id IN (SELECT value FROM json_each(?)) AND a.status=? AND EXISTS
      (SELECT 1 FROM UserRoles ur JOIN Roles r ON r.id=ur.roleId WHERE ur.userId=? AND r.name='ADMIN')`)
      .bind(JSON.stringify(applicationIds), status, actorId).all<{ id: string; userId: string }>();
    // Key the committed plan, never a later transition observed on a re-read.
    // A superseded transition is omitted by this best-effort adapter.
    await persist(context, audience, results.map(row => ({
      userId: row.userId, actorId: null, kind: "application_status", space: "cohort",
      eventKey: JSON.stringify(["application_status", row.id, status]),
      subject: { kind: "application", id: row.id, href: `/dashboard/application/${encodeURIComponent(row.id)}`, label: "Your application" },
      summary: applicationSummary[status],
    })));
  });
}

export function recordingReadyAttention(context: AttentionProducerContext, recordingId: string) {
  return bestEffort(async () => {
    const audience = await audienceFor(context);
    if (audience === "OFF") return;
    const rows = await context.db.prepare(`SELECT a.userId FROM recording r
      JOIN programApplication a ON a.programId=r.programId
      WHERE r.id=? AND r.processingStatus='complete' AND a.status IN ('APPROVED','AUDIT','COMPLETED')
      UNION SELECT pr.userId FROM recording r JOIN programRole pr ON pr.programId=r.programId
      WHERE r.id=? AND r.processingStatus='complete' AND pr.name IN ('INSTRUCTOR','TA','MENTOR')`)
      .bind(recordingId, recordingId).all<{ userId: string }>();
    await persist(context, audience, rows.results.map(row => ({
      userId: row.userId, actorId: null, kind: "recording_ready", space: "cohort",
      eventKey: JSON.stringify(["recording_ready", recordingId]),
      subject: { kind: "recording", id: recordingId, href: `/dashboard/sessions/${encodeURIComponent(recordingId)}`, label: "Cohort recording" },
      summary: "A recording in your cohort is ready to watch.",
    })));
  });
}

export function workConfirmedAttention(context: AttentionProducerContext, confirmationId: string) {
  return bestEffort(async () => {
    const audience = await audienceFor(context);
    if (audience === "OFF") return;
    const row = await context.db.prepare(`SELECT j.userId,j.id AS journeyId,c.mentorId,c.journeyVersion
      FROM communityConfirmation c JOIN communityJourney j ON j.id=c.journeyId
      WHERE c.id=? AND c.mentorId<>j.userId AND c.mentorRole IN ('MENTOR','ADMIN')`)
      .bind(confirmationId).first<{ userId: string; journeyId: string; mentorId: string; journeyVersion: number }>();
    if (!row) return;
    await persist(context, audience, [{ userId: row.userId, actorId: row.mentorId, kind: "work_confirmed", space: "profile",
      eventKey: JSON.stringify(["work_confirmed", confirmationId]),
      subject: { kind: "journey", id: row.journeyId, href: "/dashboard/community", label: "Your contribution" },
      summary: `Your contribution at revision ${row.journeyVersion} received a confirmation.` }]);
  });
}

export function visitorMessageAttention(context: AttentionProducerContext, contactId: string) {
  return bestEffort(async () => {
    const audience = await audienceFor(context);
    if (audience === "OFF") return;
    const row = await context.db.prepare(`SELECT p.userId FROM profileContact c
      JOIN studentProfile p ON p.id=c.profileId WHERE c.id=?`)
      .bind(contactId).first<{ userId: string }>();
    if (!row) return;
    await persist(context, audience, [{ userId: row.userId, actorId: null, kind: "visitor_message", space: "profile",
      eventKey: JSON.stringify(["visitor_message", contactId]),
      subject: { kind: "visitorMessage", id: contactId, href: "/dashboard/leads", label: "Visitor message" },
      summary: "You received a new message through your profile." }]);
  });
}
