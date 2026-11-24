import { describe, expect, it } from "vitest";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { MINUTE_MS } from "./clock";
import { CALL_LIMIT_MINUTES, SESSION_SERIES_MAX_WEEKS } from "./rules";
import {
  cancelSession, changeSession, hostableCohorts, readSession, scheduleSessions, scheduledNote, upcomingSessions, type SessionCaller,
} from "./sessions";
import { nairobiMoment, weeklyDates } from "./session-times";
import { meetingDatabase, PEOPLE, T0, type MeetingFixture } from "./test-support";

/*
 * Scheduling cohort sessions (slice P8) on SQLite with every migration: cohort A ("Cohort 04", channel
 * #cohort-04) with Faith its TA, Otieno and Achieng its members, Joseph its invited mentor; Kevin in
 * cohort B; Amina an admin; David a mentor outside every cohort. The clock is T0, a Tuesday.
 */
const at = (date: string, time = "18:00") => nairobiMoment(date, time) as number;
const THURSDAYS = weeklyDates("2026-11-26", 6);

async function caller(s: MeetingFixture, userId: string, meetings = true): Promise<SessionCaller> {
  return { userId, capabilities: await capabilitiesFor(s.db, { id: userId }), meetings };
}
const ctx = (s: MeetingFixture) => ({ db: s.d1, now: s.now() });
const rows = (s: MeetingFixture) => s.database.prepare(`SELECT id, title, seriesId, scheduledStartAt, bookedMinutes, limitMinutes,
    recordingPolicy, state, createdBy FROM meeting ORDER BY scheduledStartAt`).all() as Record<string, unknown>[];
const notes = (s: MeetingFixture) => s.database.prepare(`SELECT m.body, m.authorId, c.slug FROM channel_message m JOIN channel c ON c.id = m.channelId
    ORDER BY m.createdAt, m.seq`).all() as { body: string; authorId: string; slug: string }[];

async function sixThursdaysSkippingOne(s: MeetingFixture) {
  const skipped = THURSDAYS[3];
  const chosen = THURSDAYS.filter((date) => date !== skipped);
  return scheduleSessions(ctx(s), await caller(s, PEOPLE.faith), {
    programId: "cohort-a", title: "Testing payment callbacks", startTimes: chosen.map((date) => at(date)), bookedMinutes: 45, skipped: [skipped],
  });
}

describe("scheduling cohort sessions", () => {
  it("lets a TA schedule six Thursdays and skip one: five separate sessions, always recorded, one note", async () => {
    const s = meetingDatabase();
    const result = await sixThursdaysSkippingOne(s);
    expect(result.note).toBe("posted");
    const scheduled = rows(s);
    expect(scheduled.map(({ scheduledStartAt }) => new Date(scheduledStartAt as number).toISOString())).toEqual([
      "2026-11-26T15:00:00.000Z", "2026-12-03T15:00:00.000Z", "2026-12-10T15:00:00.000Z", "2026-12-24T15:00:00.000Z", "2026-12-31T15:00:00.000Z",
    ]);
    expect(new Set(scheduled.map(({ seriesId }) => seriesId)).size).toBe(1);
    expect(scheduled.every(({ seriesId }) => typeof seriesId === "string")).toBe(true);
    expect(scheduled.every((row) => row.recordingPolicy === "ALWAYS" && row.state === "SCHEDULED" && row.bookedMinutes === 45
      && row.limitMinutes === CALL_LIMIT_MINUTES && row.createdBy === PEOPLE.faith)).toBe(true);
    // One line in the cohort's main channel, by the TA, never a card per date.
    expect(notes(s)).toEqual([{
      slug: "cohort-04", authorId: PEOPLE.faith,
      body: "Scheduled 5 sessions: “Testing payment callbacks”, Thursdays at 18:00 EAT from 26 Nov to 31 Dec, 45 minutes each, "
        + "with no session on Thu 17 Dec. Each date is separate. They're in Sessions, where you can add them to your calendar.",
    }]);
  });

  it("schedules one date with no series, and says so in one line", async () => {
    const s = meetingDatabase();
    await scheduleSessions(ctx(s), await caller(s, PEOPLE.amina), {
      programId: "cohort-a", title: "Office hours", startTimes: [at("2026-11-27", "10:30")], bookedMinutes: 90,
    });
    expect(rows(s)).toMatchObject([{ seriesId: null, bookedMinutes: 90, createdBy: PEOPLE.amina }]);
    expect(notes(s)[0].body).toBe("Scheduled a session: “Office hours”, Fri 27 Nov at 10:30 EAT, 1 hour 30 minutes. "
      + "It's in Sessions, where you can add it to your calendar.");
  });

  it("refuses everyone but the cohort's instructors, TAs and admins with the same 404, and writes nothing", async () => {
    const s = meetingDatabase();
    const input = { programId: "cohort-a", title: "Session", startTimes: [at("2026-11-26")], bookedMinutes: 60 };
    // A member of another cohort, a mentor not invited to the cohort, the cohort's own members (a
    // current one and an alumna), its invited mentor, and an institution.
    for (const userId of [PEOPLE.kevin, PEOPLE.david, PEOPLE.otieno, PEOPLE.achieng, PEOPLE.joseph, PEOPLE.amani]) {
      await expect(scheduleSessions(ctx(s), await caller(s, userId), input)).rejects.toMatchObject({ status: 404, code: "not_found" });
    }
    // The TA of cohort A can't schedule for cohort B, nor for a cohort that doesn't exist.
    await expect(scheduleSessions(ctx(s), await caller(s, PEOPLE.faith), { ...input, programId: "cohort-b" })).rejects.toMatchObject({ status: 404 });
    await expect(scheduleSessions(ctx(s), await caller(s, PEOPLE.faith), { ...input, programId: "nope" })).rejects.toMatchObject({ status: 404 });
    // With `meetings` off, not even the TA.
    await expect(scheduleSessions(ctx(s), await caller(s, PEOPLE.faith, false), input)).rejects.toMatchObject({ status: 404 });
    expect(rows(s)).toEqual([]);
    expect(notes(s)).toEqual([]);
  });

  it("lists the cohorts each host may schedule for", async () => {
    const s = meetingDatabase();
    expect((await hostableCohorts(s.d1, (await caller(s, PEOPLE.faith)).capabilities)).map(({ programId, channel }) => [programId, channel.slug]))
      .toEqual([["cohort-a", "cohort-04"]]);
    expect((await hostableCohorts(s.d1, (await caller(s, PEOPLE.amina)).capabilities)).map(({ programId }) => programId).toSorted())
      .toEqual(["cohort-a", "cohort-b"]);
    for (const userId of [PEOPLE.otieno, PEOPLE.joseph, PEOPLE.david]) {
      expect(await hostableCohorts(s.d1, (await caller(s, userId)).capabilities)).toEqual([]);
    }
  });

  it("checks every date and length on the server, whatever the form sent", async () => {
    const s = meetingDatabase();
    const faith = await caller(s, PEOPLE.faith);
    const base = { programId: "cohort-a", title: "Session", startTimes: [at("2026-11-26")], bookedMinutes: 60 };
    const refused = async (input: Partial<typeof base>, message: RegExp) =>
      expect(scheduleSessions(ctx(s), faith, { ...base, ...input })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(message) });
    await refused({ startTimes: [T0 - MINUTE_MS] }, /hasn't passed/);
    await refused({ startTimes: [T0] }, /hasn't passed/);
    await refused({ startTimes: [at("2028-01-01")] }, /a year ahead/);
    await refused({ bookedMinutes: CALL_LIMIT_MINUTES + 15 }, /up to 90 minutes/);
    await refused({ bookedMinutes: 50 }, /up to 90 minutes/);
    await refused({ title: "   " }, /title/);
    await refused({ title: "x".repeat(121) }, /title/);
    await refused({ startTimes: [] }, /at least one date/);
    await refused({ startTimes: weeklyDates("2026-11-26", SESSION_SERIES_MAX_WEEKS + 1).map((date) => at(date)) }, /26 weeks/);
    expect(rows(s)).toEqual([]);
  });

  it("asks a host who hasn't agreed to the code of conduct to agree first", async () => {
    const s = meetingDatabase({ assignments: [{ programId: "cohort-a", name: "INSTRUCTOR" }], conduct: false });
    await expect(scheduleSessions(ctx(s), await caller(s, PEOPLE.wanjiku), {
      programId: "cohort-a", title: "Session", startTimes: [at("2026-11-26")], bookedMinutes: 60,
    })).rejects.toMatchObject({ status: 403, code: "conduct_required" });
    expect(rows(s)).toEqual([]);
  });

  it("keeps the sessions when the channel refuses the note, and says the note didn't post", async () => {
    const s = meetingDatabase();
    // The TA's burst limit in the channel is already used up.
    for (let n = 0; n < 10; n++) s.message("cohort-04", { author: "synthetic-faith", createdAt: T0 - 1000 });
    const result = await sixThursdaysSkippingOne(s);
    expect(result.note).toBe("not_posted");
    expect(rows(s)).toHaveLength(5);
  });
});

describe("one date of a series", () => {
  it("moves one date and leaves the others as they were, with one line saying so", async () => {
    const s = meetingDatabase();
    await sixThursdaysSkippingOne(s);
    const before = rows(s);
    const target = before[1];
    s.advance(60);
    const result = await changeSession(ctx(s), await caller(s, PEOPLE.faith), target.id as string, {
      title: "Testing payment callbacks", startAt: at("2026-12-04", "17:00"), bookedMinutes: 60,
    });
    expect(result.moved).toBe(true);
    expect(result.note).toBe("posted");
    const after = rows(s);
    const moved = after.find(({ id }) => id === target.id);
    expect(moved).toMatchObject({ scheduledStartAt: at("2026-12-04", "17:00"), bookedMinutes: 60, state: "SCHEDULED", seriesId: target.seriesId });
    expect(after.filter(({ id }) => id !== target.id)).toEqual(before.filter(({ id }) => id !== target.id));
    expect(notes(s).at(-1)?.body).toBe("Moved “Testing payment callbacks” from Thu 3 Dec at 18:00 EAT to Fri 4 Dec at 17:00 EAT. "
      + "If you added it to your calendar, add it again from Sessions to update it.");
  });

  it("renames a date without moving it, and tells nobody", async () => {
    const s = meetingDatabase();
    await sixThursdaysSkippingOne(s);
    const target = rows(s)[0];
    const count = notes(s).length;
    const result = await changeSession(ctx(s), await caller(s, PEOPLE.amina), target.id as string, {
      title: "Callbacks, part 1", startAt: target.scheduledStartAt as number, bookedMinutes: 45,
    });
    expect(result).toMatchObject({ moved: false, note: null, session: { title: "Callbacks, part 1" } });
    expect(notes(s)).toHaveLength(count);
  });

  it("cancels one date and leaves the others as they were; cancelling again changes nothing", async () => {
    const s = meetingDatabase();
    await sixThursdaysSkippingOne(s);
    const before = rows(s);
    const target = before[2];
    const faith = await caller(s, PEOPLE.faith);
    const result = await cancelSession(ctx(s), faith, target.id as string);
    expect(result).toMatchObject({ note: "posted", session: { state: "CANCELLED" } });
    expect(rows(s).filter(({ id }) => id !== target.id)).toEqual(before.filter(({ id }) => id !== target.id));
    expect(notes(s).at(-1)?.body).toBe("Cancelled “Testing payment callbacks” on Thu 10 Dec at 18:00 EAT. If you added it to your calendar, remove it there.");
    const count = notes(s).length;
    expect(await cancelSession(ctx(s), faith, target.id as string)).toMatchObject({ note: null, session: { state: "CANCELLED" } });
    expect(notes(s)).toHaveLength(count);
    // A cancelled date can't be moved back.
    await expect(changeSession(ctx(s), faith, target.id as string, { title: "Back", startAt: at("2026-12-11"), bookedMinutes: 45 }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("can't change or cancel a session once it is live", async () => {
    const s = meetingDatabase();
    const live = s.meeting({ state: "LIVE" });
    const faith = await caller(s, PEOPLE.faith);
    await expect(changeSession(ctx(s), faith, live, { title: "Later", startAt: at("2026-12-11"), bookedMinutes: 45 })).rejects.toMatchObject({ status: 409 });
    await expect(cancelSession(ctx(s), faith, live)).rejects.toMatchObject({ status: 409 });
    expect(s.row(live).state).toBe("LIVE");
  });

  it("is the same 404 for members, other cohorts and mentors, and for a call that isn't a session", async () => {
    const s = meetingDatabase();
    await sixThursdaysSkippingOne(s);
    const target = rows(s)[0].id as string;
    for (const userId of [PEOPLE.otieno, PEOPLE.kevin, PEOPLE.david, PEOPLE.joseph]) {
      const who = await caller(s, userId);
      await expect(changeSession(ctx(s), who, target, { title: "x", startAt: at("2026-12-11"), bookedMinutes: 45 })).rejects.toMatchObject({ status: 404 });
      await expect(cancelSession(ctx(s), who, target)).rejects.toMatchObject({ status: 404 });
    }
    // Members and the invited mentor can see it (for the calendar file); the other cohort and an outside mentor can't.
    expect((await readSession(s.d1, await caller(s, PEOPLE.otieno), target, { host: false })).id).toBe(target);
    expect((await readSession(s.d1, await caller(s, PEOPLE.joseph), target, { host: false })).id).toBe(target);
    await expect(readSession(s.d1, await caller(s, PEOPLE.kevin), target, { host: false })).rejects.toMatchObject({ status: 404 });
    await expect(readSession(s.d1, await caller(s, PEOPLE.david), target, { host: false })).rejects.toMatchObject({ status: 404 });
    await expect(readSession(s.d1, await caller(s, PEOPLE.otieno, false), target, { host: false })).rejects.toMatchObject({ status: 404 });
    const call = s.meeting({ channelId: s.direct([PEOPLE.faith, PEOPLE.otieno]), purpose: "CALL", recordingPolicy: "NONE" });
    await expect(readSession(s.d1, await caller(s, PEOPLE.faith), call)).rejects.toMatchObject({ status: 404 });
    expect(rows(s).filter(({ state }) => state !== "SCHEDULED")).toEqual([]);
  });
});

describe("coming up", () => {
  it("lists the sessions still to come in the reader's cohorts, soonest first, with who may host them", async () => {
    const s = meetingDatabase();
    await sixThursdaysSkippingOne(s);
    const live = s.meeting({ state: "LIVE", title: "On now" });
    const past = s.meeting({ title: "Over" });
    s.database.prepare("UPDATE meeting SET scheduledStartAt = ? WHERE id = ?").run(T0 - 120 * MINUTE_MS, past);
    const member = await upcomingSessions(s.d1, (await caller(s, PEOPLE.otieno)).capabilities, s.now());
    expect(member.map(({ title }) => title)).toEqual(["On now", ...Array(5).fill("Testing payment callbacks")]);
    expect(member.map(({ id }) => id)).toContain(live);
    expect(member.every(({ access }) => access.canSee && !access.canHost)).toBe(true);
    const ta = await upcomingSessions(s.d1, (await caller(s, PEOPLE.faith)).capabilities, s.now());
    expect(ta.every(({ access }) => access.canHost)).toBe(true);
    expect(await upcomingSessions(s.d1, (await caller(s, PEOPLE.kevin)).capabilities, s.now())).toEqual([]);
    expect(await upcomingSessions(s.d1, (await caller(s, PEOPLE.david)).capabilities, s.now())).toEqual([]);
    expect((await upcomingSessions(s.d1, (await caller(s, PEOPLE.amina)).capabilities, s.now())).length).toBe(6);
  });

  it("drops a cancelled date, and a scheduled one once its booked time is over", async () => {
    const s = meetingDatabase();
    await sixThursdaysSkippingOne(s);
    const [first, second] = rows(s);
    await cancelSession(ctx(s), await caller(s, PEOPLE.faith), second.id as string);
    s.at(((first.scheduledStartAt as number) - T0) / MINUTE_MS + 44);
    const otieno = (await caller(s, PEOPLE.otieno)).capabilities;
    expect((await upcomingSessions(s.d1, otieno, s.now())).map(({ id }) => id)[0]).toBe(first.id);
    s.advance(1);
    const listed = (await upcomingSessions(s.d1, otieno, s.now())).map(({ id }) => id);
    expect(listed).not.toContain(first.id);
    expect(listed).not.toContain(second.id);
    expect(listed).toHaveLength(3);
  });
});

describe("the note's words", () => {
  it("names a series by weekday and time, and lists more than one skipped date", () => {
    expect(scheduledNote({ title: "Ledgers", starts: [at("2026-11-26"), at("2026-12-17")], minutes: 60, skipped: ["2026-12-03", "2026-12-10"], now: T0 }))
      .toContain("Thursdays at 18:00 EAT from 26 Nov to 17 Dec, 1 hour each, with no session on Thu 3 Dec and Thu 10 Dec.");
  });
});
