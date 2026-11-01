import { createId } from "@paralleldrive/cuid2";
import type { FlagContext } from "@/lib/platform/server/flags";
import type { ProgramApplicationStatus } from "@/lib/admin/program-application";
import type { AccessRole, AttentionFilter, AttentionKind, FlagAudience, SpaceId, SubjectRef } from "@/lib/platform/contracts";

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

/** The stored category, which the list filters page on (README.md). */
const ATTENTION_CATEGORY: Record<AttentionKind, Exclude<AttentionFilter, "all">> = {
  mention: "mentions", reply: "mentions", tembo_answer: "mentions",
  mentor_request: "requests", mentor_accepted: "requests", mentor_redirected: "requests",
  mentor_declined: "requests", mentor_withdrawn: "requests", access_request: "requests",
  recording_ready: "updates", application_status: "updates", work_confirmed: "updates", visitor_message: "updates",
  opportunity_match: "updates", moderation_pending: "updates", message_hidden: "updates", access_decided: "updates",
};

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

/** STAFF eligibility is evaluated from the recipient's roles inside the INSERT. Both arguments are SQL, never input. */
const audienceAdmits = (recipient: string, audience: string) => `(${audience}='ALL' OR (${audience}='STAFF' AND EXISTS
  (SELECT 1 FROM UserRoles ur JOIN Roles r ON r.id=ur.roleId WHERE ur.userId=${recipient} AND r.name='ADMIN')))`;

async function persist(context: AttentionProducerContext, audience: FlagAudience, items: EventItem[]) {
  if (items.length === 0) return;
  // JSON keeps both the bind count and the number of D1 round trips constant.
  await context.db.prepare(`INSERT INTO attention_item
    (id,userId,eventKey,kind,space,category,subjectKind,subjectId,subjectHref,subjectLabel,actorId,summary,createdAt)
    SELECT json_extract(e.value,'$.id'),json_extract(e.value,'$.userId'),
      json_extract(e.value,'$.eventKey'),json_extract(e.value,'$.kind'),json_extract(e.value,'$.space'),
      json_extract(e.value,'$.category'),json_extract(e.value,'$.subject.kind'),json_extract(e.value,'$.subject.id'),
      json_extract(e.value,'$.subject.href'),json_extract(e.value,'$.subject.label'),
      json_extract(e.value,'$.actorId'),json_extract(e.value,'$.summary'),?1
    FROM json_each(?2) e WHERE ${audienceAdmits("json_extract(e.value,'$.userId')", "?3")}
    ON CONFLICT(userId,eventKey) DO NOTHING`)
    .bind(Date.now(), JSON.stringify(items.map(item => ({ ...item, id: createId(), category: ATTENTION_CATEGORY[item.kind] }))), audience)
    .run();
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

const ACCESS_LABEL: Record<AccessRole, string> = { MENTOR: "Mentor access", INSTITUTION: "Institution access" };
const ACCESS_DECIDED_SUMMARY: Record<AccessRole, Record<"APPROVED" | "DECLINED", string>> = {
  MENTOR: { APPROVED: "Mentoring is open.", DECLINED: "Mentor access wasn't approved this time." },
  INSTITUTION: { APPROVED: "Discover is open.", DECLINED: "Institution access wasn't approved this time." },
};
/** Where the requester reads the decision and its message (Account, "How you take part"). */
export const ACCESS_DECIDED_HREF = "/dashboard/account#taking-part";
export const ACCESS_REQUEST_QUEUE_HREF = "/admin/access-requests";

/**
 * A new access request, fanned out to every administrator except the requester. The requester is the
 * actor; the note and organisation stay in the queue and are never copied into attention.
 */
export function accessRequestAttention(context: AttentionProducerContext, requestId: string) {
  return bestEffort(async () => {
    const audience = await audienceFor(context);
    if (audience === "OFF") return;
    const { results } = await context.db.prepare(`SELECT ur.userId AS adminId,a.userId AS requesterId,a.role
      FROM access_request a JOIN UserRoles ur ON ur.userId<>a.userId JOIN Roles r ON r.id=ur.roleId AND r.name='ADMIN'
      WHERE a.id=? AND a.status='PENDING'`)
      .bind(requestId).all<{ adminId: string; requesterId: string; role: AccessRole }>();
    await persist(context, audience, results.map(row => ({
      userId: row.adminId, actorId: row.requesterId, kind: "access_request", space: "admin",
      eventKey: JSON.stringify(["access_request", requestId]),
      subject: { kind: "accessRequest", id: requestId, href: ACCESS_REQUEST_QUEUE_HREF, label: ACCESS_LABEL[row.role] },
      summary: `New ${ACCESS_LABEL[row.role].toLowerCase()} request.`,
    })));
  });
}

/**
 * The requester's decision item, as a statement for the deciding batch: it selects from the request by
 * this decision's id, so it writes only when that decision committed. It never names an actor, because
 * the requester is not told which administrator decided. Null while spaces is OFF for everyone, or when
 * the audience cannot be read: the decision still stands, as with every best-effort producer.
 */
export async function accessDecidedAttention(
  context: AttentionProducerContext, decisionId: string, now: number,
): Promise<D1PreparedStatement | null> {
  let audience: FlagAudience;
  try { audience = await audienceFor(context); }
  catch {
    console.warn("Attention event could not be recorded.");
    return null;
  }
  if (audience === "OFF") return null;
  return context.db.prepare(`INSERT INTO attention_item
    (id,userId,eventKey,kind,space,category,subjectKind,subjectId,subjectHref,subjectLabel,actorId,summary,createdAt)
    SELECT ?1,a.userId,json_array('access_decided',a.id,a.decisionId),'access_decided','community',?3,
      'accessRequest',a.id,?4,json_extract(?5,'$.'||a.role),NULL,json_extract(?6,'$.'||a.role||'.'||a.status),?7
    FROM access_request a WHERE a.decisionId=?2 AND a.status IN ('APPROVED','DECLINED') AND ${audienceAdmits("a.userId", "?8")}
    ON CONFLICT(userId,eventKey) DO NOTHING`)
    .bind(createId(), decisionId, ATTENTION_CATEGORY.access_decided, ACCESS_DECIDED_HREF,
      JSON.stringify(ACCESS_LABEL), JSON.stringify(ACCESS_DECIDED_SUMMARY), now, audience);
}
