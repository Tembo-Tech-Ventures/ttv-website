import { MINUTE_MS, type CallContext } from "./clock";
import { MAX_PEOPLE_PER_CALL, SEATS_KEPT_FOR_HOST, type MeetingSeatRole } from "./rules";

/**
 * Seats (README.md beside this file, "Seats"). A seat is the only thing a join token is minted for,
 * one per person per call. The claim is one conditional statement, and D1 runs one write at a time,
 * so two people can never take the last seat: of MAX_PEOPLE_PER_CALL places, SEATS_KEPT_FOR_HOST are
 * always kept for a host, so members hold at most MAX_PEOPLE_PER_CALL − max(SEATS_KEPT_FOR_HOST,
 * hosts in the call). A REMOVED seat is never claimed again. Leaving releases a seat; removing marks it
 * REMOVED; either way the provider participant is deleted, which revokes its token at once. Ending the
 * call removes everyone from the provider meeting and deletes every seat (clock.ts).
 */

export type SeatClaim = { outcome: "held" | "removed" | "closed" | "full" };

/** The caller's seat and the call's state, read in the same batch as the claim. */
interface ClaimState { seatState: string | null; callState: string | null; hardEndAt: number | null }

/**
 * Takes (or takes back) the caller's seat as `role`, if the call is live and before its end, the caller
 * was never removed, and there is room for them. A seat taken back keeps the provider participant an
 * earlier join left (another tab) until attachParticipant replaces it, so a join that fails at the
 * provider leaves that tab as it was. On a check-in, the second person taking their seat starts its
 * clock: hardEndAt is set, in the same batch.
 */
export async function claimSeat(
  { db, now }: CallContext, meetingId: string, userId: string, role: MeetingSeatRole,
): Promise<SeatClaim> {
  const others = (where = "") => `(SELECT count(*) FROM meeting_seat WHERE meetingId = ?1 AND userId <> ?2 AND state = 'HELD'${where})`;
  const [before, claimed, , after] = await db.batch<Record<string, unknown>>([
    db.prepare("SELECT state FROM meeting_seat WHERE meetingId = ?1 AND userId = ?2").bind(meetingId, userId),
    // A member counts the host places still kept; a host needs only a free place.
    db.prepare(`INSERT INTO meeting_seat (meetingId, userId, role, state, lastSeenAt, createdAt, updatedAt)
      SELECT ?1, ?2, ?3, 'HELD', ?4, ?4, ?4
      WHERE EXISTS (SELECT 1 FROM meeting WHERE id = ?1 AND state = 'LIVE' AND (hardEndAt IS NULL OR hardEndAt > ?4))
        AND NOT EXISTS (SELECT 1 FROM meeting_seat WHERE meetingId = ?1 AND userId = ?2 AND state = 'REMOVED')
        AND ${others()} + CASE WHEN ?3 = 'HOST' THEN 0 ELSE max(0, ?6 - ${others(" AND role = 'HOST'")}) END < ?5
      ON CONFLICT (meetingId, userId) DO UPDATE SET role = excluded.role, state = 'HELD',
        lastSeenAt = excluded.lastSeenAt, updatedAt = excluded.updatedAt
        WHERE meeting_seat.state <> 'REMOVED'
      RETURNING role`).bind(meetingId, userId, role, now, MAX_PEOPLE_PER_CALL, SEATS_KEPT_FOR_HOST),
    db.prepare(`UPDATE meeting SET hardEndAt = ?2 + limitMinutes * ?3, updatedAt = ?2
      WHERE id = ?1 AND purpose = 'CHECKIN' AND state = 'LIVE' AND hardEndAt IS NULL
        AND (SELECT count(*) FROM meeting_seat WHERE meetingId = ?1 AND state = 'HELD') >= 2`).bind(meetingId, now, MINUTE_MS),
    db.prepare("SELECT state, hardEndAt FROM meeting WHERE id = ?1").bind(meetingId),
  ]);
  const seat = before.results[0] as { state: string } | undefined;
  const call = after.results[0] as { state: string; hardEndAt: number | null } | undefined;
  return classify({ seatState: seat?.state ?? null, callState: call?.state ?? null, hardEndAt: call?.hardEndAt ?? null },
    claimed.results.length > 0, now);
}

function classify(state: ClaimState, held: boolean, now: number): SeatClaim {
  if (held) return { outcome: "held" };
  if (state.seatState === "REMOVED") return { outcome: "removed" };
  if (state.callState !== "LIVE" || (state.hardEndAt !== null && state.hardEndAt <= now)) return { outcome: "closed" };
  return { outcome: "full" };
}

/**
 * Records the provider participant just added for the caller's held seat. False when the seat is no
 * longer held (they left, were removed, or the call ended meanwhile): the caller then deletes the
 * participant it made. `replaced` is the participant the seat held before (an earlier tab, or one
 * whose deletion failed), for the caller to delete.
 */
export async function attachParticipant(
  { db, now }: CallContext, meetingId: string, userId: string, participantId: string,
): Promise<{ attached: boolean; replaced: string | null }> {
  const [before, attached] = await db.batch<Record<string, unknown>>([
    db.prepare("SELECT providerParticipantId FROM meeting_seat WHERE meetingId = ?1 AND userId = ?2 AND state = 'HELD'").bind(meetingId, userId),
    db.prepare(`UPDATE meeting_seat SET providerParticipantId = ?3, lastSeenAt = ?4, updatedAt = ?4
      WHERE meetingId = ?1 AND userId = ?2 AND state = 'HELD' RETURNING userId`).bind(meetingId, userId, participantId, now),
  ]);
  const replaced = (before.results[0] as { providerParticipantId: string | null } | undefined)?.providerParticipantId ?? null;
  return { attached: attached.results.length > 0, replaced };
}

/**
 * Gives back a held seat the provider never got a participant for (adding one failed), so a failed
 * join never keeps a place. A seat with a participant (another tab still in the call) is left alone.
 */
export async function abandonClaim({ db, now }: CallContext, meetingId: string, userId: string): Promise<void> {
  await db.prepare(`UPDATE meeting_seat SET state = 'RELEASED', updatedAt = ?3
    WHERE meetingId = ?1 AND userId = ?2 AND state = 'HELD' AND providerParticipantId IS NULL`).bind(meetingId, userId, now).run();
}

/**
 * Moves the person's seat to `state`: RELEASED when they leave (a held seat only), REMOVED when a host
 * removes them (a member's seat only; removing again changes nothing). The seat keeps its provider
 * participant until revokeParticipants has deleted it, so a removal whose provider call failed is
 * finished by trying again. Returns whether there was such a seat, and its participant.
 */
export async function vacateSeat(
  { db, now }: CallContext, meetingId: string, userId: string, state: "RELEASED" | "REMOVED",
): Promise<{ found: boolean; participantId: string | null }> {
  const which = state === "RELEASED" ? "state = 'HELD'" : "role = 'MEMBER'";
  const row = await db.prepare(`UPDATE meeting_seat SET state = ?3, updatedAt = CASE WHEN state = ?3 THEN updatedAt ELSE ?4 END
    WHERE meetingId = ?1 AND userId = ?2 AND ${which} RETURNING providerParticipantId`)
    .bind(meetingId, userId, state, now).first<{ providerParticipantId: string | null }>();
  return { found: row !== null, participantId: row?.providerParticipantId ?? null };
}

/**
 * Deletes provider participants, which revokes their tokens at once, and forgets each one deleted
 * from the seat that is no longer held. True when every deletion succeeded. A participant left behind
 * by a failure stays on its seat for the next try (and, from slice P4, the clock's).
 */
export async function revokeParticipants(
  { db, provider }: CallContext, meetingId: string, providerMeetingId: string, participantIds: readonly (string | null)[],
): Promise<boolean> {
  if (!provider) return false;
  const unique = [...new Set(participantIds.filter((id): id is string => id !== null))];
  const results = await Promise.allSettled(unique.map(async (participantId) => {
    await provider.deleteParticipant({ providerMeetingId, participantId });
    await db.prepare(`UPDATE meeting_seat SET providerParticipantId = NULL
      WHERE meetingId = ?1 AND providerParticipantId = ?2 AND state <> 'HELD'`).bind(meetingId, participantId).run();
  }));
  return results.every(({ status }) => status === "fulfilled");
}
