import { MINUTE_MS } from "@/lib/meetings/clock";
import { CALL_LIMIT_MINUTES, STARTING_SOON_MINUTES } from "@/lib/meetings/rules";
import { callPath } from "@/lib/platform/server/space-routes";
import { audienceFor, bestEffort, persist, type AttentionProducerContext } from "./producers";

/**
 * Attention for cohort sessions (in-app calls P9; README.md beside this file, "Calls"): "starting
 * soon" before a session and "live" once its room opens, to the cohort's people, the only reminders
 * there are (no email). Each shows only while it is true (access.ts): "starting soon" while the session
 * still waits for a host at that very time, "live" while it is live, so both leave the bell once it
 * ends. Best effort and post-commit like every producer, and they need `meetings` (with `channels` and
 * `spaces`) for their recipient. Neither copies the session's title: the label stays "Cohort session".
 */

/**
 * Each session `where` admits (over `meeting m` and its `channel c`), once per person of its cohort, as
 * recording_ready reaches them: members and alumni, its instructors, TAs and invited mentors.
 */
const toCohortPeople = (where: string) => `SELECT m.id, m.scheduledStartAt, a.userId FROM meeting m JOIN channel c ON c.id = m.channelId
    JOIN programApplication a ON a.programId = c.programId AND a.status IN ('APPROVED', 'AUDIT', 'COMPLETED') WHERE ${where}
  UNION SELECT m.id, m.scheduledStartAt, pr.userId FROM meeting m JOIN channel c ON c.id = m.channelId
    JOIN programRole pr ON pr.programId = c.programId AND pr.name IN ('INSTRUCTOR', 'TA', 'MENTOR') WHERE ${where}`;

const subject = (meetingId: string) => ({ kind: "meeting" as const, id: meetingId, href: callPath(meetingId), label: "Cohort session" });

/** A cohort session opened by a host: "live" to everyone else in the cohort, naming the host who opened it. */
export function meetingLiveAttention(context: AttentionProducerContext, meetingId: string, hostId: string, now = Date.now()) {
  return bestEffort(async () => {
    const audience = await audienceFor(context, "meetings");
    if (audience === "OFF") return;
    const { results } = await context.db.prepare(toCohortPeople("m.id = ?1 AND m.purpose = 'SESSION' AND m.state = 'LIVE' AND c.kind = 'COHORT'"))
      .bind(meetingId).all<{ userId: string }>();
    await persist(context, audience, results.filter(({ userId }) => userId !== hostId).map(({ userId }) => ({
      userId, actorId: hostId, kind: "meeting_live", space: "cohort", eventKey: JSON.stringify(["meeting_live", meetingId]),
      subject: subject(meetingId), summary: "Your cohort's session is live. Join it from here.",
    })), now);
  });
}

/**
 * The hook the every-minute meeting clock calls (slice P4 runs it; nothing in this slice adds a cron):
 * "starting soon" for every cohort session that starts within STARTING_SOON_MINUTES and hasn't opened,
 * to its cohort's people. Running it again adds nothing: each item's key is the session and the start
 * it announces, so a session moved to another time is announced again at its new time, and the old
 * item, which no longer applies, leaves the bell. Two statements whatever the number of sessions.
 */
export function remindSessionsStartingSoon(context: AttentionProducerContext, now: number) {
  return bestEffort(async () => {
    const audience = await audienceFor(context, "meetings");
    if (audience === "OFF") return;
    // meeting_state_idx: scheduled sessions starting from the longest a booked session lasts ago, up to the reminder's lead.
    const { results } = await context.db.prepare(toCohortPeople(`m.state = 'SCHEDULED' AND m.scheduledStartAt > ?1 - ?3
        AND m.scheduledStartAt <= ?1 + ?2 AND m.scheduledStartAt + m.bookedMinutes * ?4 > ?1 AND m.purpose = 'SESSION'
        AND c.kind = 'COHORT' AND c.archivedAt IS NULL`))
      .bind(now, STARTING_SOON_MINUTES * MINUTE_MS, CALL_LIMIT_MINUTES * MINUTE_MS, MINUTE_MS)
      .all<{ id: string; scheduledStartAt: number; userId: string }>();
    await persist(context, audience, results.map(({ id, scheduledStartAt, userId }) => ({
      userId, actorId: null, kind: "meeting_soon", space: "cohort", eventKey: JSON.stringify(["meeting_soon", id, scheduledStartAt]),
      subject: subject(id), summary: "Your cohort's session starts soon.",
    })), now);
  });
}
