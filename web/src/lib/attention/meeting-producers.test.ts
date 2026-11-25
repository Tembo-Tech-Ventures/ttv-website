import { describe, expect, it } from "vitest";
import { MINUTE_MS } from "@/lib/meetings/clock";
import { meetingDatabase, PEOPLE, T0, type MeetingFixture } from "@/lib/meetings/test-support";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { getAttentionCount } from "./count";
import { remindSessionsStartingSoon } from "./meeting-producers";
import { listAttention } from "./service";

/*
 * "Starting soon" and "Live" for a cohort session (in-app calls P9), with a clock the test moves. The
 * session is cohort A's, at T0 for 60 minutes; its people are Otieno (member), Achieng (alumna), Faith
 * (TA) and Joseph (invited mentor). Kevin is in cohort B; Amina is an admin outside the cohort's people.
 * The every-minute clock (slice P4) calls remindSessionsStartingSoon; here the test does.
 */
const context = (s: MeetingFixture, env: Record<string, unknown> = { PLATFORM_FLAGS_OVERRIDE: "all" }) => ({ db: s.d1, env: env as never });

/** What one person's bell shows a second after the test's clock: each item's kind, and the unread count. */
async function bell(s: MeetingFixture, userId: string) {
  const capabilities = await capabilitiesFor(s.db, { id: userId });
  const at = s.now() + 1000;
  const { items } = await listAttention(s.db, userId, {}, capabilities, at);
  const { count } = await getAttentionCount(s.db, userId, capabilities, at);
  return { kinds: items.map((item) => item.kind), count, items };
}
const stored = (s: MeetingFixture, kind: string) => (s.database.prepare("SELECT userId FROM attention_item WHERE kind = ? ORDER BY userId")
  .all(kind) as { userId: string }[]).map(({ userId }) => userId);
const COHORT_A = [PEOPLE.achieng, PEOPLE.faith, PEOPLE.joseph, PEOPLE.otieno].toSorted();

describe("a cohort session in Attention", () => {
  it("says 'starting soon' from ten minutes before, then 'live' once a host opens it, then nothing once it ends", async () => {
    const s = meetingDatabase();
    const id = s.meeting();

    s.at(-11);
    await remindSessionsStartingSoon(context(s), s.now());
    expect(stored(s, "meeting_soon")).toEqual([]);

    s.at(-10);
    await remindSessionsStartingSoon(context(s), s.now());
    expect(stored(s, "meeting_soon")).toEqual(COHORT_A);
    // The clock runs every minute: nobody hears twice.
    s.at(-9);
    await remindSessionsStartingSoon(context(s), s.now());
    expect(stored(s, "meeting_soon")).toEqual(COHORT_A);

    const soon = await bell(s, PEOPLE.otieno);
    expect(soon.kinds).toEqual(["meeting_soon"]);
    expect(soon.count).toBe(1);
    expect(soon.items[0]).toMatchObject({
      space: "cohort", actor: null, summary: "Your cohort's session starts soon.",
      subject: { kind: "meeting", id, href: `/dashboard/calls/${id}`, label: "Cohort session" },
    });
    for (const outsider of [PEOPLE.kevin, PEOPLE.amina, PEOPLE.david]) expect((await bell(s, outsider)).kinds).toEqual([]);

    // Faith opens the room: everyone else hears it is live, named as the host who opened it; "soon" is gone.
    s.at(0);
    expect((await s.call("joinMeeting", { id, user: PEOPLE.faith })).status).toBe(200);
    expect(stored(s, "meeting_live")).toEqual(COHORT_A.filter((person) => person !== PEOPLE.faith));
    const live = await bell(s, PEOPLE.otieno);
    expect(live.kinds).toEqual(["meeting_live"]);
    expect(live.items[0]).toMatchObject({ actor: { id: PEOPLE.faith }, summary: "Your cohort's session is live. Join it from here." });
    expect((await bell(s, PEOPLE.faith)).kinds).toEqual([]);

    // It ends: the bell is empty again.
    s.at(40);
    expect((await s.call("endMeeting", { id, user: PEOPLE.faith })).status).toBe(200);
    expect(await bell(s, PEOPLE.otieno)).toMatchObject({ kinds: [], count: 0 });
  });

  it("lets 'starting soon' go once the booked time passes with no host, or the date is cancelled", async () => {
    const s = meetingDatabase();
    const first = s.meeting();
    s.at(-5);
    await remindSessionsStartingSoon(context(s), s.now());
    expect((await bell(s, PEOPLE.otieno)).kinds).toEqual(["meeting_soon"]);
    s.at(59);
    expect((await bell(s, PEOPLE.otieno)).kinds).toEqual(["meeting_soon"]);
    s.at(60);
    expect(await bell(s, PEOPLE.otieno)).toMatchObject({ kinds: [], count: 0 });
    // Too late to remind anyone of it now.
    s.database.exec("DELETE FROM attention_item");
    await remindSessionsStartingSoon(context(s), s.now());
    expect(stored(s, "meeting_soon")).toEqual([]);

    // Back before the start, a date cancelled after its reminder leaves the bell; the other stays.
    const cancelled = s.meeting();
    s.at(-5);
    await remindSessionsStartingSoon(context(s), s.now());
    const subjects = async () => (await bell(s, PEOPLE.otieno)).items.map(({ subject }) => subject.id).toSorted();
    expect(await subjects()).toEqual([cancelled, first].toSorted());
    s.database.prepare("UPDATE meeting SET state = 'CANCELLED' WHERE id = ?").run(cancelled);
    expect(await subjects()).toEqual([first]);
  });

  it("announces a moved date again at its new time, and the old reminder leaves the bell", async () => {
    const s = meetingDatabase();
    const id = s.meeting();
    s.at(-5);
    await remindSessionsStartingSoon(context(s), s.now());
    s.database.prepare("UPDATE meeting SET scheduledStartAt = ? WHERE id = ?").run(T0 + 30 * MINUTE_MS, id);
    expect((await bell(s, PEOPLE.otieno)).kinds).toEqual([]);
    s.at(22);
    await remindSessionsStartingSoon(context(s), s.now());
    expect((await bell(s, PEOPLE.otieno)).kinds).toEqual(["meeting_soon"]);
    expect(stored(s, "meeting_soon")).toHaveLength(COHORT_A.length * 2);
  });

  it("follows the reader's access and the flags: someone who leaves the cohort stops seeing it, and with `meetings` off nothing is written", async () => {
    const s = meetingDatabase();
    const id = s.meeting();
    s.at(-5);
    await remindSessionsStartingSoon(context(s), s.now());
    s.database.exec("UPDATE programApplication SET status = 'REJECTED' WHERE userId = 'synthetic-otieno'");
    expect((await bell(s, PEOPLE.otieno)).kinds).toEqual([]);

    const dark = meetingDatabase();
    dark.meeting();
    dark.at(-5);
    await remindSessionsStartingSoon(context(dark, {}), dark.now());
    expect(stored(dark, "meeting_soon")).toEqual([]);
    expect(id).toBeTruthy();
  });

  it("writes nothing for a session in an archived channel, or another kind of call", async () => {
    const s = meetingDatabase();
    s.meeting({ channelId: s.direct(), purpose: "CALL", recordingPolicy: "BOTH_AGREE" });
    const archived = s.meeting();
    s.database.prepare("UPDATE channel SET archivedAt = 1 WHERE id = (SELECT channelId FROM meeting WHERE id = ?)").run(archived);
    s.at(-5);
    await remindSessionsStartingSoon(context(s), s.now());
    expect(stored(s, "meeting_soon")).toEqual([]);
  });
});
