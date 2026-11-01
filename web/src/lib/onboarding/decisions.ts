import { createId } from "@paralleldrive/cuid2";
import { z } from "zod";
import { accessDecidedAttention, type AttentionProducerContext } from "@/lib/attention/producers";
import {
  AccessRequestQueueState, AccessRole, AdminAccessRequest, AdminAccessRequestList, Id, Timestamp, WebLink,
  type AccessDecision, type AdminAccessRequestQuery, type PersonSummary,
} from "@/lib/platform/contracts";
import { OnboardingError } from "./service";

/**
 * Granting, revoking and deciding the global community roles (README.md beside this file). Callers own
 * authentication, the ADMIN check and the browser-session rule. Timestamps are epoch milliseconds.
 */

export const ACCESS_REQUEST_PAGE_SIZE = 30;
/** How many of a person's earlier requests the queue shows beside each one. */
export const ACCESS_REQUEST_HISTORY_LIMIT = 20;

export interface RoleGrant {
  userId: string;
  role: AccessRole;
  /** The administrator, kept as decidedBy on any request the grant answers. */
  actorId: string;
}

/**
 * Grants a global role. Any request pending for it is approved in the same batch, so a request never
 * sits pending beside the role it asks for, and its requester hears about it without being told who.
 */
export async function grantCommunityRole(context: AttentionProducerContext, grant: RoleGrant, now = Date.now()): Promise<void> {
  const role = AccessRole.parse(grant.role);
  const decisionId = createId();
  const attention = await accessDecidedAttention(context, decisionId, now);
  await context.db.batch([
    context.db.prepare(`INSERT INTO UserRoles (id, userId, roleId) SELECT ?1, ?2, id FROM Roles WHERE name = ?3
      ON CONFLICT (userId, roleId) DO NOTHING`).bind(createId(), grant.userId, role),
    context.db.prepare(`UPDATE access_request SET status = 'APPROVED', decisionId = ?3, decidedBy = ?4, decidedAt = ?5,
        updatedAt = max(updatedAt, ?5)
      WHERE userId = ?1 AND role = ?2 AND status = 'PENDING' AND EXISTS (SELECT 1 FROM UserRoles ur
        JOIN Roles r ON r.id = ur.roleId WHERE ur.userId = ?1 AND r.name = ?2)`)
      .bind(grant.userId, role, decisionId, grant.actorId, now),
    ...(attention ? [attention] : []),
  ]);
}

/** Removes a global role. Request history stays as it was: role state always wins over it. */
export async function revokeCommunityRole(db: D1Database, userId: string, role: AccessRole): Promise<void> {
  await db.prepare("DELETE FROM UserRoles WHERE userId = ? AND roleId IN (SELECT id FROM Roles WHERE name = ?)")
    .bind(userId, AccessRole.parse(role)).run();
}

export interface AccessRequestDecision extends AccessDecision {
  id: string;
  actorId: string;
}

/**
 * Approves or declines a pending request in one batch keyed on a fresh decisionId. D1 runs every
 * statement of a batch, so the role and attention inserts select from the request by that id: they
 * write only if the first statement moved this request out of PENDING. A request withdrawn, declined
 * or approved first leaves nothing to select, and the caller gets `conflict`.
 */
export async function decideAccessRequest(
  context: AttentionProducerContext, input: AccessRequestDecision, now = Date.now(),
): Promise<AdminAccessRequest> {
  const { db } = context;
  const approve = input.decision === "approve";
  const decisionId = createId();
  const attention = await accessDecidedAttention(context, decisionId, now);
  const [update] = await db.batch([
    db.prepare(`UPDATE access_request SET status = ?2, decisionId = ?3, decisionMessage = ?4, decidedBy = ?5,
        decidedAt = ?6, updatedAt = max(updatedAt, ?6)
      WHERE id = ?1 AND status = 'PENDING' AND EXISTS (SELECT 1 FROM Roles WHERE name = access_request.role)`)
      .bind(input.id, approve ? "APPROVED" : "DECLINED", decisionId, input.message?.trim() || null, input.actorId, now),
    ...(approve ? [db.prepare(`INSERT INTO UserRoles (id, userId, roleId)
      SELECT ?1, a.userId, r.id FROM access_request a JOIN Roles r ON r.name = a.role
      WHERE a.decisionId = ?2 AND a.status = 'APPROVED'
      ON CONFLICT (userId, roleId) DO NOTHING`).bind(createId(), decisionId)] : []),
    ...(attention ? [attention] : []),
  ]);
  if (update.meta.changes !== 1) {
    const row = await db.prepare("SELECT status FROM access_request WHERE id = ?").bind(input.id).first<{ status: string }>();
    if (!row) throw new OnboardingError("not_found", "Request not found.");
    if (row.status !== "PENDING") throw new OnboardingError("conflict", "This request was already decided or withdrawn.");
    throw new Error("Access roles are missing: apply the community migrations.");
  }
  const decided = await getAdminAccessRequest(db, input.id);
  if (!decided) throw new OnboardingError("not_found", "Request not found.");
  return decided;
}

interface AdminRow {
  id: string; role: AccessRole; status: AdminAccessRequest["status"]; note: string;
  organisation: string | null; organisationRole: string | null; link: string | null; decisionMessage: string | null;
  createdAt: number; updatedAt: number; decidedAt: number | null; scopeAcknowledgedAt: number | null;
  requesterId: string; requesterName: string; requesterImage: string | null; githubLogin: string | null;
  deciderId: string | null; deciderName: string | null; deciderImage: string | null; earlierRequests: string;
}

// Earlier requests are the person's other decided or withdrawn ones created before this one, newest first.
const ADMIN_SELECT = `SELECT a.id, a.role, a.status, a.note, a.organisation, a.organisationRole, a.link,
    a.decisionMessage, a.createdAt, a.updatedAt, a.decidedAt, a.scopeAcknowledgedAt,
    u.id AS requesterId, u.name AS requesterName, u.image AS requesterImage,
    (SELECT nullif(trim(p.githubLogin), '') FROM studentProfile p WHERE p.userId = a.userId LIMIT 1) AS githubLogin,
    d.id AS deciderId, d.name AS deciderName, d.image AS deciderImage,
    (SELECT json_group_array(json_object('id', h.id, 'role', h.role, 'status', h.status,
        'decisionMessage', h.decisionMessage, 'createdAt', h.createdAt, 'decidedAt', h.decidedAt))
      FROM (SELECT * FROM access_request h WHERE h.userId = a.userId AND h.status <> 'PENDING'
        AND (h.createdAt < a.createdAt OR (h.createdAt = a.createdAt AND h.id < a.id))
        ORDER BY h.createdAt DESC, h.id DESC LIMIT ${ACCESS_REQUEST_HISTORY_LIMIT}) h) AS earlierRequests
  FROM access_request a JOIN user u ON u.id = a.userId LEFT JOIN user d ON d.id = a.decidedBy`;

const person = (id: string, name: string, image: string | null): PersonSummary => ({
  id, name: name.trim() || "Member", avatarUrl: WebLink.safeParse(image).data ?? null, roleBadges: [],
});

function adminRequest(row: AdminRow): AdminAccessRequest {
  return AdminAccessRequest.parse({
    id: row.id, role: row.role, status: row.status, note: row.note, organisation: row.organisation,
    organisationRole: row.organisationRole, link: row.link, decisionMessage: row.decisionMessage,
    createdAt: row.createdAt, updatedAt: row.updatedAt, decidedAt: row.decidedAt, scopeAcknowledgedAt: row.scopeAcknowledgedAt,
    requester: person(row.requesterId, row.requesterName, row.requesterImage), githubLogin: row.githubLogin,
    decidedBy: row.deciderId === null ? null : person(row.deciderId, row.deciderName ?? "", row.deciderImage),
    earlierRequests: JSON.parse(row.earlierRequests) as unknown,
  });
}

export async function getAdminAccessRequest(db: D1Database, id: string): Promise<AdminAccessRequest | null> {
  const row = await db.prepare(`${ADMIN_SELECT} WHERE a.id = ?`).bind(id).first<AdminRow>();
  return row ? adminRequest(row) : null;
}

/** Binds the list it pages, so a Pending cursor can't be replayed against Decided. */
const QueueCursor = z.strictObject({ v: z.literal(1), state: AccessRequestQueueState, at: Timestamp, id: Id });
type QueueCursor = z.infer<typeof QueueCursor>;
export class AccessRequestCursorError extends Error {}

function encodeCursor(cursor: QueueCursor): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(cursor))));
}
function decodeCursor(value: string, state: AccessRequestQueueState): QueueCursor {
  try {
    const cursor = QueueCursor.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(value), (character) => character.charCodeAt(0)),
    )));
    if (cursor.state === state) return cursor;
  } catch { /* Reported below, like a cursor for the other list. */ }
  throw new AccessRequestCursorError("Invalid access request cursor.");
}

// Pending is a queue, oldest first. Decided shows the latest decisions first.
const PAGE_QUERIES: Record<AccessRequestQueueState, string> = {
  PENDING: `${ADMIN_SELECT} WHERE a.status = 'PENDING'
    AND (?1 IS NULL OR a.createdAt > ?1 OR (a.createdAt = ?1 AND a.id > ?2))
    ORDER BY a.createdAt, a.id LIMIT ?3`,
  DECIDED: `${ADMIN_SELECT} WHERE a.status IN ('APPROVED', 'DECLINED')
    AND (?1 IS NULL OR a.decidedAt < ?1 OR (a.decidedAt = ?1 AND a.id < ?2))
    ORDER BY a.decidedAt DESC, a.id DESC LIMIT ?3`,
};

/** One page and the open-request count for the Admin sidebar, read in parallel. */
export async function listAccessRequests(db: D1Database, query: AdminAccessRequestQuery): Promise<AdminAccessRequestList> {
  const state = query.status ?? "PENDING";
  const cursor = query.cursor ? decodeCursor(query.cursor, state) : null;
  const [{ results }, pending] = await Promise.all([
    db.prepare(PAGE_QUERIES[state]).bind(cursor?.at ?? null, cursor?.id ?? null, ACCESS_REQUEST_PAGE_SIZE + 1).all<AdminRow>(),
    db.prepare("SELECT count(*) AS count FROM access_request WHERE status = 'PENDING'").first<{ count: number }>(),
  ]);
  const page = results.slice(0, ACCESS_REQUEST_PAGE_SIZE);
  const last = page.at(-1);
  const at = last && (state === "PENDING" ? last.createdAt : last.decidedAt);
  return AdminAccessRequestList.parse({
    items: page.map(adminRequest),
    nextCursor: results.length > ACCESS_REQUEST_PAGE_SIZE && last && typeof at === "number"
      ? encodeCursor({ v: 1, state, at, id: last.id }) : null,
    pendingCount: pending?.count ?? 0,
  });
}
