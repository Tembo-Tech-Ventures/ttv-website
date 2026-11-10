import { postedWorkEligibility } from "@/lib/community/eligibility";
import { createId } from "@paralleldrive/cuid2";
import { CONDUCT_VERSION } from "@/lib/channels/conduct";
import {
  confirmationsOf,
  embedsForReader,
  resolveOwnProject,
  screeningText,
} from "@/lib/channels/embeds";
import { ChannelError } from "@/lib/channels/errors";
import { detectFindings, textKey } from "@/lib/channels/moderation/detectors";
import { bodyForReader } from "@/lib/channels/moderation/mask";
import { FLAG_EVENT, screenedReasons } from "@/lib/channels/mutations";
import {
  MessageEmbed,
  type MentorRequestListQuery,
  type Conversation,
  type CreateMentorRequest,
  type DeclineMentorRequest,
  type MentorRequest,
  type MentorRequestCheck,
  type MentorRequestList,
  type MentorRequestProject,
  type MentorRequestStatus,
  type ProjectEmbed,
  type RedirectMentorRequest,
} from "@/lib/platform/contracts";
import { capacityOf, hasSpot, monthStart, spotColumns } from "./capacity";
import { personColumns, personRow, personSummary } from "./people";
import { LISTED } from "./profiles";
import { HELD, MENTOR_SEES } from "./visibility";

/**
 * Asking a mentor for time (README.md beside this file, "Requests"). Only the person asking and the
 * mentor asked ever see a request; anyone else gets the same 404 as for a missing one. Each write
 * checks its conditions inside the statement that makes it, so two requests at once cannot both pass
 * a check one of them should fail. Callers own the flag, authentication and same-origin checks.
 */

/** Requests one person may have waiting at once, across mentors. */
export const OPEN_REQUEST_LIMIT = 5;
/** Requests one person may make in a rolling day, so asking and withdrawing cannot flood mentors. */
export const DAILY_REQUEST_LIMIT = Object.freeze({
  count: 10,
  windowMs: 24 * 60 * 60_000,
});
/** Requests per page of a list. */
export const REQUEST_PAGE_SIZE = 20;
/** The name a conversation keeps for itself; each member sees the other person's name instead. */
export const CONVERSATION_NAME = "Mentoring conversation";
/** A conversation's slug: direct conversations have no page by slug and may share one. */
export const CONVERSATION_SLUG = "conversation";
/** The client nonce of the message a request's note becomes, unique per author like any post's. */
export const openingNonce = (requestId: string) =>
  `mentor-request-${requestId}`;

export interface MentoringContext {
  db: D1Database;
  viewerId: string;
  now: number;
  /** The code of conduct version asking needs; tests raise it to show a new version asks again. */
  conductVersion?: number;
}

export const notFound = () =>
  new ChannelError("not_found", "Request not found.", 404);
const REPORTED = () =>
  new ChannelError(
    "conflict",
    "You reported this request. TTV is checking it.",
    409,
  );
const MENTOR_ROLE = (userId: string) =>
  `EXISTS (SELECT 1 FROM UserRoles ur JOIN Roles r ON r.id = ur.roleId WHERE ur.userId = ${userId} AND r.name = 'MENTOR')`;

export interface RequestRow extends Record<string, unknown> {
  id: string;
  requesterId: string;
  mentorId: string;
  status: MentorRequestStatus;
  format: MentorRequest["format"];
  note: string;
  noteReasons: string;
  project: string | null;
  projectAccess: string | null;
  channelId: string | null;
  redirectedToId: string | null;
  responseNote: string | null;
  createdAt: number;
  updatedAt: number;
  caseState: "OPEN" | "DECIDED" | null;
  caseDecision: "KEEP" | "REMOVE" | null;
  reported: number;
  closedRequest: number | null;
}

/**
 * Every column a MentorRequest needs, from mentor_request `r`, its check `c` (mentor_request_case)
 * and the mentor's report `rp`. The attached work is checked again on every read with the channel
 * embeds' rule (still the asker's, still published), and carries the mentors' confirmations at or
 * before the attached revision.
 */
export const REQUEST_COLUMNS = `r.id, r.requesterId, r.mentorId, r.status, r.format, r.note, r.noteReasons, r.project,
  r.channelId, r.redirectedToId, r.responseNote, r.createdAt, r.updatedAt,
  c.state AS caseState, c.decision AS caseDecision, rp.requestId IS NOT NULL AS reported,
  c.closedRequest,
  CASE WHEN r.project IS NOT NULL THEN (SELECT ${confirmationsOf("j.id", "r.journeyVersion")} FROM communityJourney j
    WHERE j.id = r.journeyId AND j.userId = r.requesterId AND ${postedWorkEligibility("j")}) END AS projectAccess,
  ${personColumns("ru", "r.requesterId", "requester", { cohorts: true })},
  ${personColumns("mu", "r.mentorId", "mentor")},
  ${personColumns("tu", "r.redirectedToId", "target")}`;
/** The joins REQUEST_COLUMNS reads besides `r` and `c`: the people and the report. */
export const REQUEST_JOINS = `JOIN "user" ru ON ru.id = r.requesterId JOIN "user" mu ON mu.id = r.mentorId
  LEFT JOIN "user" tu ON tu.id = r.redirectedToId LEFT JOIN mentor_request_report rp ON rp.requestId = r.id`;
const REQUEST_SELECT = `SELECT ${REQUEST_COLUMNS}
FROM mentor_request r LEFT JOIN mentor_request_case c ON c.requestId = r.id ${REQUEST_JOINS}`;

export function reasonsOf(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function projectFor(row: RequestRow): MentorRequestProject | null {
  if (row.project === null) return null;
  let stored: unknown;
  try {
    stored = JSON.parse(row.project);
  } catch {
    stored = null;
  }
  const [view] = embedsForReader([stored], JSON.stringify([row.projectAccess]));
  return view?.type === "project" || view?.type === "unavailable"
    ? view
    : { type: "unavailable", was: "project" };
}

/**
 * The mentor's reply as the person asking sees it: contact details masked, as the asker's own note is
 * for the mentor. Screened on each read by the same detectors (nothing about it is stored), so a
 * reply cannot carry a number or a chat invitation out of TTV.
 */
function responseFor(row: RequestRow, viewerId: string): string | null {
  if (row.responseNote === null || row.mentorId === viewerId)
    return row.responseNote;
  const reasons = [
    ...new Set(
      detectFindings(row.responseNote).map((finding) => finding.reason),
    ),
  ];
  return bodyForReader(
    {
      body: row.responseNote,
      moderationState: reasons.length > 0 ? "FLAGGED" : "VISIBLE",
      reasons,
    },
    false,
  );
}

/**
 * What a check means to this party (contracts MentorRequestCheck), only ever what is true: the person
 * asking waits while it is open, and learns only that a removed request was closed; whether it was
 * ever sent depends on whether the mentor saw it, which a report says (MENTOR_SEES). The mentor who
 * reported it sees that, until an admin keeps it.
 */
function checkFor(
  row: RequestRow,
  viewerId: string,
): MentorRequestCheck | null {
  if (row.requesterId === viewerId) {
    const seen = Boolean(row.reported);
    if (row.caseState === "OPEN" && row.status === "PENDING")
      return seen ? "checking" : "waiting";
    // Only when the removal closed it: a request the asker withdrew first stays theirs ("withdrawn").
    if (row.closedRequest) return seen ? "closed" : "not_sent";
    return null;
  }
  return row.reported &&
    !(row.caseState === "DECIDED" && row.caseDecision === "KEEP")
    ? "reported"
    : null;
}

/**
 * The request as this party sees it: each sees contact details in the other's words masked, as in a
 * channel. An admin checking it (`admin`) reads both texts as written, and no party's check.
 */
export function toRequest(
  row: RequestRow,
  viewerId: string,
  { admin = false } = {},
): MentorRequest {
  const reasons = reasonsOf(row.noteReasons);
  const note = admin
    ? row.note
    : bodyForReader(
        {
          body: row.note,
          moderationState: reasons.length > 0 ? "FLAGGED" : "VISIBLE",
          reasons,
        },
        row.requesterId === viewerId,
      );
  return {
    id: row.id,
    requester: personSummary(row.requesterId, personRow(row, "requester")),
    mentor: personSummary(row.mentorId, personRow(row, "mentor")),
    note,
    project: projectFor(row),
    format: row.format,
    status: row.status,
    channelId: row.channelId,
    redirectedTo:
      row.redirectedToId === null
        ? null
        : personSummary(row.redirectedToId, personRow(row, "target")),
    responseNote: admin ? row.responseNote : responseFor(row, viewerId),
    check: admin ? null : checkFor(row, viewerId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The request if the viewer is one of its two parties, and the mentor may see it (MENTOR_SEES); null
 * otherwise, whether or not it exists. One read.
 */
export async function partyRow(
  ctx: MentoringContext,
  id: string,
): Promise<RequestRow | null> {
  return ctx.db
    .prepare(
      `${REQUEST_SELECT} WHERE r.id = ?1 AND (r.requesterId = ?2 OR (r.mentorId = ?2 AND ${MENTOR_SEES("r")}))`,
    )
    .bind(id, ctx.viewerId)
    .first<RequestRow>();
}

/** GET /api/mentor-requests/:id: for its two parties only. */
export async function getRequest(
  ctx: MentoringContext,
  id: string,
): Promise<MentorRequest> {
  const row = await partyRow(ctx, id);
  if (!row) throw notFound();
  return toRequest(row, ctx.viewerId);
}

/**
 * The header of a direct conversation the caller is a member of (U-4.1's /dm/:id page): the other
 * member, with global badges, and the latest accepted request between them that points at it. null
 * for anyone else, and for a channel that is not a direct conversation, through the same reads. Two
 * statements read together, the membership and counterpart beside the request: the request is read
 * only by its parties, and is dropped unless the caller is a member, so it says nothing to anyone else.
 */
export async function getConversation(
  ctx: MentoringContext,
  channelId: string,
): Promise<Conversation | null> {
  const [member, request] = await Promise.all([
    ctx.db
      .prepare(
        `SELECT other.userId AS counterpartId, ${personColumns("u", "other.userId", "counterpart")}
      FROM channel c JOIN channel_member mine ON mine.channelId = c.id AND mine.userId = ?2
        LEFT JOIN channel_member other ON other.channelId = c.id AND other.userId <> ?2
        LEFT JOIN "user" u ON u.id = other.userId
      WHERE c.id = ?1 AND c.kind = 'DIRECT' ORDER BY u.name, other.userId LIMIT 1`,
      )
      .bind(channelId, ctx.viewerId)
      .first<Record<string, unknown> & { counterpartId: string | null }>(),
    ctx.db
      .prepare(
        `${REQUEST_SELECT}
      WHERE r.channelId = ?1 AND r.status = 'ACCEPTED' AND ?2 IN (r.requesterId, r.mentorId)
      ORDER BY r.acceptedAt DESC, r.id DESC LIMIT 1`,
      )
      .bind(channelId, ctx.viewerId)
      .first<RequestRow>(),
  ]);
  if (!member) return null;
  return {
    counterpart:
      member.counterpartId === null
        ? null
        : personSummary(member.counterpartId, personRow(member, "counterpart")),
    request: request ? toRequest(request, ctx.viewerId) : null,
  };
}

/** A page boundary: the last item's time and id, base64url JSON. Opaque to clients. */
export function encodeCursor(at: number, id: string): string {
  return btoa(JSON.stringify([at, id]))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function decodeCursor(cursor: string): [number, string] {
  try {
    const value: unknown = JSON.parse(
      atob(cursor.replaceAll("-", "+").replaceAll("_", "/")),
    );
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      Number.isSafeInteger(value[0]) &&
      typeof value[1] === "string"
    ) {
      return [value[0] as number, value[1]];
    }
  } catch {
    /* reported below */
  }
  throw new ChannelError("validation", "Invalid cursor.", 400);
}

/**
 * GET /api/mentor-requests: the requests the caller sent (as=requester) or received (as=mentor, those
 * MENTOR_SEES lets them see), newest first, REQUEST_PAGE_SIZE at a time, optionally of one status.
 * One statement, along mentor_request_requester_idx or mentor_request_mentor_idx.
 */
export async function listRequests(
  ctx: MentoringContext,
  query: MentorRequestListQuery,
): Promise<MentorRequestList> {
  const [beforeAt, beforeId] =
    query.cursor === undefined ? [null, null] : decodeCursor(query.cursor);
  const side =
    query.as === "mentor"
      ? `r.mentorId = ?1 AND ${MENTOR_SEES("r")}`
      : "r.requesterId = ?1";
  const { results } = await ctx.db
    .prepare(
      `${REQUEST_SELECT}
    WHERE ${side} AND (?2 IS NULL OR r.status = ?2)
      AND (?3 IS NULL OR r.createdAt < ?3 OR (r.createdAt = ?3 AND r.id < ?4))
    ORDER BY r.createdAt DESC, r.id DESC LIMIT ?5`,
    )
    .bind(
      ctx.viewerId,
      query.status ?? null,
      beforeAt,
      beforeId,
      REQUEST_PAGE_SIZE + 1,
    )
    .all<RequestRow>();
  const page = results.slice(0, REQUEST_PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map((row) => toRequest(row, ctx.viewerId)),
    nextCursor:
      results.length > REQUEST_PAGE_SIZE && last
        ? encodeCursor(last.createdAt, last.id)
        : null,
  };
}

/** The detectors' findings on what the mentor will read: the note and the attached work's text. */
async function screened(note: string, project: ProjectEmbed | null) {
  const text = screeningText(note, project ? [project] : []);
  return {
    findings: JSON.stringify(detectFindings(text)),
    key: await textKey(text),
  };
}

interface CreateRefusalRow {
  listed: number;
  offersFormat: number;
  conduct: number;
  duplicate: "WAITING" | "HELD" | "CHECKING" | null;
  open: number;
  day: string;
  spot: number | null;
  mentorName: string | null;
  spotLimit: number | null;
  pendingCount: number;
  acceptedCount: number;
}

const capitalised = (text: string) =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
/** "1 December", in Nairobi time, as the directory says when a full mentor's next opening is. */
const openingDay = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  timeZone: "Africa/Nairobi",
});

/**
 * Why a request was not written, from one read of the INSERT's own conditions, in the order a person
 * can act on them: a mentor taking requests in that format, the code of conduct, then their own waiting requests, then
 * the mentor's spots.
 */
async function createRefusal(
  ctx: MentoringContext,
  input: CreateMentorRequest,
): Promise<ChannelError> {
  const { db, viewerId, now } = ctx;
  const why = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM mentor_profile p WHERE p.userId = ?2 AND ${LISTED}) AS listed,
      EXISTS (SELECT 1 FROM mentor_profile p, json_each(p.formats) f WHERE p.userId = ?2 AND f.value = ?3) AS offersFormat,
      coalesce((SELECT version FROM channel_conduct WHERE userId = ?1), 0) AS conduct,
      (SELECT CASE WHEN NOT ${HELD("d")} THEN 'WAITING'
          WHEN EXISTS (SELECT 1 FROM mentor_request_report dr WHERE dr.requestId = d.id) THEN 'CHECKING' ELSE 'HELD' END
        FROM mentor_request d WHERE d.requesterId = ?1 AND d.mentorId = ?2 AND d.status = 'PENDING') AS duplicate,
      (SELECT COUNT(*) FROM mentor_request o WHERE o.requesterId = ?1 AND o.status = 'PENDING') AS open,
      (SELECT json_array(COUNT(*), MIN(createdAt)) FROM mentor_request o WHERE o.requesterId = ?1 AND o.createdAt > ?5) AS day,
      (SELECT ${hasSpot("p.userId", "?4", "p.monthlyCapacity")} FROM mentor_profile p WHERE p.userId = ?2) AS spot,
      (SELECT nullif(trim(name), '') FROM "user" WHERE id = ?2) AS mentorName,
      (SELECT monthlyCapacity FROM mentor_profile WHERE userId = ?2) AS spotLimit, ${spotColumns("?2", "?4")}`,
    )
    .bind(
      viewerId,
      input.mentorId,
      input.format,
      monthStart(now),
      now - DAILY_REQUEST_LIMIT.windowMs,
    )
    .first<CreateRefusalRow>();
  if (!why) throw new Error("Could not read the request conditions.");
  if (!why.listed)
    return new ChannelError(
      "not_found",
      "This mentor isn't taking requests right now.",
      404,
    );
  if (!why.offersFormat)
    return new ChannelError(
      "validation",
      "This mentor doesn't offer that format.",
      400,
    );
  if (why.conduct < (ctx.conductVersion ?? CONDUCT_VERSION)) {
    return new ChannelError(
      "conduct_required",
      "Agree to how we talk to each other before you ask.",
      403,
    );
  }
  const mentor = why.mentorName ?? "this mentor";
  // The person asking learns which of their own requests is in the way, and never who opened a check.
  if (why.duplicate === "WAITING")
    return new ChannelError(
      "conflict",
      `You already have a request waiting with ${mentor}.`,
      409,
    );
  if (why.duplicate === "HELD") {
    return new ChannelError(
      "conflict",
      `Your earlier request to ${mentor} is waiting for a check before it's sent. ` +
        "Your requests will show when the check is done.",
      409,
    );
  }
  if (why.duplicate === "CHECKING") {
    return new ChannelError(
      "conflict",
      `TTV is checking your earlier request to ${mentor}. ` +
        "Your requests will show when the check is done.",
      409,
    );
  }
  if (why.open >= OPEN_REQUEST_LIMIT) {
    return new ChannelError(
      "rate_limited",
      `You have ${OPEN_REQUEST_LIMIT} requests waiting. Withdraw one or wait for an answer first.`,
      429,
    );
  }
  const [count, oldest] = JSON.parse(why.day) as [number, number | null];
  if (count >= DAILY_REQUEST_LIMIT.count) {
    return new ChannelError(
      "rate_limited",
      "You've asked for a lot of time today. Try again later.",
      429,
      Math.max(1, (oldest ?? now) + DAILY_REQUEST_LIMIT.windowMs - now),
    );
  }
  if (!why.spot) {
    // Like the directory, the next opening is known only when the turn of the month frees a spot.
    const { nextOpeningAt } = capacityOf(
      {
        limit: why.spotLimit ?? 0,
        pending: why.pendingCount,
        accepted: why.acceptedCount,
      },
      now,
    );
    return nextOpeningAt === null
      ? new ChannelError(
          "conflict",
          `${capitalised(mentor)} has no spots left this month.`,
          409,
        )
      : new ChannelError(
          "conflict",
          `${capitalised(mentor)} has no spots left this month. The next opening is ${openingDay.format(nextOpeningAt)}.`,
          409,
          nextOpeningAt - now,
        );
  }
  throw new Error(
    "A mentor request insert wrote nothing, for no known reason.",
  );
}

/**
 * POST /api/mentor-requests: a signed-in person asks a listed mentor for time as themselves (owner
 * decision 2026-11-02, "Mentor requests are personal": an institution affiliation neither grants nor
 * blocks it), in a format they offer, with their own published project at its current revision attached or nothing. Refusals:
 * asking yourself (400); attached work that cannot be shared (as in a post: 400, or 409 for a stale
 * revision); then createRefusal's, in its order. The note is screened by the channel detectors now,
 * so the mentor sees contact details masked; the conversation it opens is screened again.
 */
export async function createRequest(
  ctx: MentoringContext,
  input: CreateMentorRequest,
): Promise<MentorRequest> {
  const { db, viewerId, now } = ctx;
  if (input.mentorId === viewerId)
    throw new ChannelError(
      "validation",
      "You can't ask yourself for time.",
      400,
    );
  const project =
    input.project === null
      ? null
      : await resolveOwnProject(db, viewerId, input.project);
  const { findings, key } = await screened(input.note, project);
  const id = createId();
  const written = await db
    .prepare(
      `INSERT INTO mentor_request
      (id, requesterId, mentorId, status, format, note, noteReasons, journeyId, journeyVersion, project, createdAt, updatedAt)
    SELECT ?1, ?2, ?3, 'PENDING', ?4, ?5, ${screenedReasons("?6", "?7")}, ?8, ?9, ?10, ?11, ?11
    FROM mentor_profile p
    WHERE p.userId = ?3 AND ${LISTED}
      AND EXISTS (SELECT 1 FROM json_each(p.formats) f WHERE f.value = ?4)
      AND EXISTS (SELECT 1 FROM channel_conduct WHERE userId = ?2 AND version >= ?12)
      AND NOT EXISTS (SELECT 1 FROM mentor_request d WHERE d.requesterId = ?2 AND d.mentorId = ?3 AND d.status = 'PENDING')
      AND (SELECT COUNT(*) FROM mentor_request o WHERE o.requesterId = ?2 AND o.status = 'PENDING') < ?13
      AND (SELECT COUNT(*) FROM mentor_request o WHERE o.requesterId = ?2 AND o.createdAt > ?14) < ?15
      AND ${hasSpot("p.userId", "?16", "p.monthlyCapacity")}
    RETURNING id`,
    )
    .bind(
      id,
      viewerId,
      input.mentorId,
      input.format,
      input.note,
      findings,
      key,
      project?.journeyId ?? null,
      project?.version ?? null,
      project === null ? null : JSON.stringify(project),
      now,
      ctx.conductVersion ?? CONDUCT_VERSION,
      OPEN_REQUEST_LIMIT,
      now - DAILY_REQUEST_LIMIT.windowMs,
      DAILY_REQUEST_LIMIT.count,
      monthStart(now),
    )
    .all<{ id: string }>();
  if (written.results.length !== 1) throw await createRefusal(ctx, input);
  return getRequest(ctx, id);
}

export type Transition = "accept" | "redirect" | "decline" | "withdraw";

/** Who may make each move: the mentor answers, the person asking withdraws. */
const ACTOR: Record<Transition, "mentor" | "requester"> = {
  accept: "mentor",
  redirect: "mentor",
  decline: "mentor",
  withdraw: "requester",
};
export const ALREADY: Record<
  Exclude<MentorRequestStatus, "PENDING">,
  string
> = {
  ACCEPTED: "This request was already accepted.",
  REDIRECTED: "This request was already passed on to another mentor.",
  DECLINED: "This request was already declined.",
  WITHDRAWN: "This request was withdrawn.",
};

/**
 * The request a move names, once the caller may make it: a party (404 otherwise, as for a missing
 * request), the right party for the move (403), still PENDING (409), and for the mentor, not held by
 * the check their own report opened (409).
 */
async function movable(
  ctx: MentoringContext,
  id: string,
  move: Transition,
): Promise<RequestRow> {
  const row = await partyRow(ctx, id);
  if (!row) throw notFound();
  const actor = ACTOR[move] === "mentor" ? row.mentorId : row.requesterId;
  if (actor !== ctx.viewerId) {
    throw new ChannelError(
      "forbidden",
      move === "withdraw"
        ? "Only the person who asked can withdraw a request."
        : "Only the mentor asked can answer this request.",
      403,
    );
  }
  if (row.status !== "PENDING")
    throw new ChannelError("conflict", ALREADY[row.status], 409);
  if (ACTOR[move] === "mentor" && row.caseState === "OPEN") {
    throw REPORTED();
  }
  return row;
}

/** After a guarded write changed nothing: the request moved on meanwhile (409), or `otherwise`. */
export async function lostRace(
  ctx: MentoringContext,
  id: string,
  otherwise: () => Error,
): Promise<Error> {
  const row = await partyRow(ctx, id);
  if (!row) return notFound();
  if (row.status !== "PENDING")
    return new ChannelError("conflict", ALREADY[row.status], 409);
  return row.caseState === "OPEN" && row.mentorId === ctx.viewerId
    ? REPORTED()
    : otherwise();
}

/** What accepting created: the request, and the opening message (id and stored body) when this acceptance wrote it. */
export interface Accepted {
  request: MentorRequest;
  channelId: string;
  opening: { id: string; body: string } | null;
}

/**
 * The direct conversation these two people already share, if any: a DIRECT channel whose only
 * members are the two of them. Along channel_member_userId_idx and the members' primary key.
 */
async function pairConversation(
  db: D1Database,
  a: string,
  b: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT c.id FROM channel_member mine
      JOIN channel_member theirs ON theirs.channelId = mine.channelId AND theirs.userId = ?2
      JOIN channel c ON c.id = mine.channelId AND c.kind = 'DIRECT' AND c.archivedAt IS NULL
    WHERE mine.userId = ?1 AND (SELECT COUNT(*) FROM channel_member m WHERE m.channelId = mine.channelId) = 2
    ORDER BY c.createdAt, c.id LIMIT 1`,
    )
    .bind(a, b)
    .first<{ id: string }>();
  return row?.id ?? null;
}

function storedProject(row: RequestRow): ProjectEmbed[] {
  if (row.project === null) return [];
  try {
    const embed = MessageEmbed.safeParse(JSON.parse(row.project));
    return embed.success && embed.data.type === "project" ? [embed.data] : [];
  } catch {
    return [];
  }
}

/**
 * POST /api/mentor-requests/:id/accept: the mentor, who must still hold the MENTOR role (403), opens a
 * conversation with the person asking: the DIRECT conversation the two already share, or a new one
 * with the two of them as its only members. The request's note becomes the asker's first message
 * there, with the attached work at the requested revision, screened as a post is (flagged contact
 * details stay visible to its author and masked for the mentor). One batch: the conversation, its
 * members, the request and the message commit together or not at all. Accepting needs no spot: the
 * pending request already holds one.
 */
export async function acceptRequest(
  ctx: MentoringContext,
  id: string,
): Promise<Accepted> {
  const { db, viewerId, now } = ctx;
  const row = await movable(ctx, id, "accept");
  const existing = await pairConversation(db, row.requesterId, row.mentorId);
  const channelId = existing ?? createId();
  const embeds = storedProject(row);
  const { findings, key } = await screened(row.note, embeds[0] ?? null);
  const messageId = createId();
  // ?1 request, ?2 mentor: the move is still open to this mentor.
  const open = `EXISTS (SELECT 1 FROM mentor_request m WHERE m.id = ?1 AND m.mentorId = ?2 AND m.status = 'PENDING' AND NOT ${HELD("m")})
    AND ${MENTOR_ROLE("?2")}`;
  const statements: D1PreparedStatement[] = [];
  if (existing === null) {
    statements.push(
      db
        .prepare(
          `INSERT INTO channel (id, kind, slug, name, topic, createdAt, updatedAt)
        SELECT ?3, 'DIRECT', ?4, ?5, '', ?6, ?6 WHERE ${open}`,
        )
        .bind(
          id,
          viewerId,
          channelId,
          CONVERSATION_SLUG,
          CONVERSATION_NAME,
          now,
        ),
      db
        .prepare(
          `INSERT INTO channel_member (channelId, userId, addedBy, createdAt)
        SELECT ?3, value, ?2, ?5 FROM json_each(?4) WHERE ${open} AND EXISTS (SELECT 1 FROM channel WHERE id = ?3)`,
        )
        .bind(
          id,
          viewerId,
          channelId,
          JSON.stringify([row.requesterId, row.mentorId]),
          now,
        ),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE mentor_request SET status = 'ACCEPTED', channelId = ?3, acceptedAt = ?4, decidedAt = max(?4, createdAt),
        updatedAt = max(?4, createdAt)
      WHERE id = ?1 AND mentorId = ?2 AND status = 'PENDING' AND NOT ${HELD("mentor_request")} AND ${MENTOR_ROLE("?2")}
        AND EXISTS (SELECT 1 FROM channel WHERE id = ?3)
      RETURNING id`,
      )
      .bind(id, viewerId, channelId, now),
    // The opening message, only for this acceptance (?4, its time): numbered like any post in the channel.
    db
      .prepare(
        `INSERT INTO channel_message
        (id, channelId, parentId, seq, changeSeq, authorKind, authorId, clientNonce, body, embeds, moderationState, moderationReasons, createdAt)
      SELECT ?2, ?3, NULL, n.next, n.next, 'USER', r.requesterId, ?5, r.note, ?6,
        CASE WHEN json_array_length(x.reasons) > 0 THEN 'FLAGGED' ELSE 'VISIBLE' END, x.reasons, max(?4, n.lastAt)
      FROM mentor_request r,
        (SELECT coalesce(MAX(changeSeq), 0) + 1 AS next,
          coalesce((SELECT createdAt FROM channel_message WHERE channelId = ?3 ORDER BY seq DESC LIMIT 1), 0) AS lastAt
          FROM channel_message WHERE channelId = ?3) n,
        (SELECT ${screenedReasons("?7", "?8")} AS reasons) x
      WHERE r.id = ?1 AND r.status = 'ACCEPTED' AND r.channelId = ?3 AND r.acceptedAt = ?4
      ON CONFLICT (authorId, clientNonce) DO NOTHING`,
      )
      .bind(
        id,
        messageId,
        channelId,
        now,
        openingNonce(id),
        JSON.stringify(embeds),
        findings,
        key,
      ),
  );
  if (findings !== "[]") {
    statements.push(
      db
        .prepare(
          `${FLAG_EVENT} SELECT ?2, id, 'FLAG', 'DETECTOR', NULL, 'VISIBLE', 'FLAGGED', moderationReasons, createdAt
      FROM channel_message WHERE id = ?1 AND moderationState = 'FLAGGED'`,
        )
        .bind(messageId, createId()),
    );
  }
  const results = await db.batch(statements);
  const accepted = results[existing === null ? 2 : 0];
  if (accepted?.results.length !== 1) {
    throw await lostRace(
      ctx,
      id,
      () =>
        new ChannelError("forbidden", "Only mentors can accept requests.", 403),
    );
  }
  const opening = await db
    .prepare("SELECT id, body FROM channel_message WHERE id = ?1")
    .bind(messageId)
    .first<{ id: string; body: string }>();
  return { request: await getRequest(ctx, id), channelId, opening };
}

/**
 * POST /api/mentor-requests/:id/redirect: the mentor suggests another listed mentor (not themselves,
 * not the person asking: 400 otherwise), with an optional note. The person asking decides whether to
 * ask them; nothing is sent to the suggested mentor.
 */
export async function redirectRequest(
  ctx: MentoringContext,
  id: string,
  input: RedirectMentorRequest,
): Promise<MentorRequest> {
  const { db, viewerId, now } = ctx;
  const row = await movable(ctx, id, "redirect");
  const unsuitable = () =>
    new ChannelError(
      "validation",
      "Suggest another mentor who is taking requests.",
      400,
    );
  if (input.mentorId === viewerId || input.mentorId === row.requesterId)
    throw unsuitable();
  const written = await db
    .prepare(
      `UPDATE mentor_request SET status = 'REDIRECTED', redirectedToId = ?3, responseNote = ?4,
      decidedAt = max(?5, createdAt), updatedAt = max(?5, createdAt)
    WHERE id = ?1 AND mentorId = ?2 AND status = 'PENDING' AND NOT ${HELD("mentor_request")} AND ?3 NOT IN (requesterId, mentorId)
      AND EXISTS (SELECT 1 FROM mentor_profile p WHERE p.userId = ?3 AND ${LISTED})
    RETURNING id`,
    )
    .bind(id, viewerId, input.mentorId, input.note ?? null, now)
    .all<{ id: string }>();
  if (written.results.length !== 1) throw await lostRace(ctx, id, unsuitable);
  return getRequest(ctx, id);
}

/** POST /api/mentor-requests/:id/decline: "Not this month", with an optional note. It counts against nobody. */
export async function declineRequest(
  ctx: MentoringContext,
  id: string,
  input: DeclineMentorRequest,
): Promise<MentorRequest> {
  const { db, viewerId, now } = ctx;
  await movable(ctx, id, "decline");
  const written = await db
    .prepare(
      `UPDATE mentor_request SET status = 'DECLINED', responseNote = ?3,
      decidedAt = max(?4, createdAt), updatedAt = max(?4, createdAt)
    WHERE id = ?1 AND mentorId = ?2 AND status = 'PENDING' AND NOT ${HELD("mentor_request")} RETURNING id`,
    )
    .bind(id, viewerId, input.note ?? null, now)
    .all<{ id: string }>();
  if (written.results.length !== 1)
    throw await lostRace(
      ctx,
      id,
      () => new Error("A decline wrote nothing, for no known reason."),
    );
  return getRequest(ctx, id);
}

/** POST /api/mentor-requests/:id/withdraw: the person asking takes a waiting request back, freeing its spot. */
export async function withdrawRequest(
  ctx: MentoringContext,
  id: string,
): Promise<MentorRequest> {
  const { db, viewerId, now } = ctx;
  await movable(ctx, id, "withdraw");
  const written = await db
    .prepare(
      `UPDATE mentor_request SET status = 'WITHDRAWN', decidedAt = max(?3, createdAt), updatedAt = max(?3, createdAt)
    WHERE id = ?1 AND requesterId = ?2 AND status = 'PENDING' RETURNING id`,
    )
    .bind(id, viewerId, now)
    .all<{ id: string }>();
  if (written.results.length !== 1)
    throw await lostRace(
      ctx,
      id,
      () => new Error("A withdrawal wrote nothing, for no known reason."),
    );
  return getRequest(ctx, id);
}
