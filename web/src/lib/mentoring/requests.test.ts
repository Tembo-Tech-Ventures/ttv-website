import { afterEach, describe, expect, it, vi } from "vitest";
import { VIEWER } from "@/lib/channels/test-support";
import { ErrorEnvelope, MASKED_CONTACT, MentorRequest, MentorRequestList, MessageList } from "@/lib/platform/contracts";
import { monthStart, nextMonthStart } from "./capacity";
import { DAILY_REQUEST_LIMIT, OPEN_REQUEST_LIMIT, REQUEST_PAGE_SIZE, openingNonce } from "./requests";
import { mentoringDatabase, NOW, PEOPLE, type MentoringFixture } from "./test-support";

vi.mock("@/lib/observability/errors", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/observability/errors")>(),
  recordErrorInBackground: vi.fn(),
}));

const fixtures: MentoringFixture[] = [];
afterEach(() => { fixtures.splice(0).forEach(({ database }) => database.close()); });
function setup(...args: Parameters<typeof mentoringDatabase>) {
  const fixture = mentoringDatabase(...args);
  fixtures.push(fixture);
  return fixture;
}
const errorOf = (body: unknown) => ErrorEnvelope.parse(body).error;
const request = (body: unknown) => MentorRequest.parse(body);
type Move = "acceptMentorRequest" | "redirectMentorRequest" | "declineMentorRequest" | "withdrawMentorRequest";
const MOVES: Record<Move, { by: "mentor" | "requester"; body: unknown; status: string }> = {
  acceptMentorRequest: { by: "mentor", body: {}, status: "ACCEPTED" },
  redirectMentorRequest: { by: "mentor", body: { mentorId: PEOPLE.joseph, note: "Joseph knows career moves." }, status: "REDIRECTED" },
  declineMentorRequest: { by: "mentor", body: {}, status: "DECLINED" },
  withdrawMentorRequest: { by: "requester", body: {}, status: "WITHDRAWN" },
};
const move = (s: MentoringFixture, operation: Move, id: string, user?: string) =>
  s.call(operation, { id, body: MOVES[operation].body, user: user ?? (MOVES[operation].by === "mentor" ? PEOPLE.david : VIEWER) });

describe("asking a mentor for time", () => {
  it("creates a PENDING request both parties can read, with the work attached at its current revision", async () => {
    const s = setup();
    const work = s.project("fare-splitter", { version: 4 });
    s.database.exec(`INSERT INTO communityConfirmation(id, journeyId, mentorId, statement, method, journeyVersion)
      VALUES ('c1', 'fare-splitter', '${PEOPLE.mercy}', 'Reviewed the callback handling.', 'CODE_REVIEW', 4)`);
    const created = await s.call("createMentorRequest", { body: { mentorId: PEOPLE.david, note: "Check my callback handling?", project: work, format: "WRITTEN_REVIEW" } });
    expect(created.status).toBe(201);
    const body = request(created.body);
    expect(body).toMatchObject({
      status: "PENDING", format: "WRITTEN_REVIEW", note: "Check my callback handling?", channelId: null, redirectedTo: null, responseNote: null,
      requester: { id: VIEWER, name: "Wanjiku Njeri" }, mentor: { id: PEOPLE.david, name: "David Kamau" },
      project: { type: "project", journeyId: "fare-splitter", version: 4, title: "Bus fare splitter",
        confirmations: [{ mentorId: PEOPLE.mercy, mentorName: "Mercy Wambui", version: 4 }] },
      createdAt: NOW, updatedAt: NOW,
    });
    expect(body.mentor.roleBadges).toEqual([{ kind: "MENTOR", label: "Mentor", programId: null }]);
    for (const user of [VIEWER, PEOPLE.david]) {
      const read = await s.call("getMentorRequest", { id: body.id, user });
      expect([read.status, request(read.body).id]).toEqual([200, body.id]);
    }
  });

  it("shows the mentor the asker's cohort, and the asker none of the mentor's", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }, { programId: "cohort-b", status: "COMPLETED" }] });
    s.database.exec(`INSERT INTO programApplication(id,userId,programId,status,application) VALUES ('d', '${PEOPLE.david}', 'cohort-a', 'COMPLETED', '{}')`);
    const id = await s.ask();
    const seen = request((await s.call("getMentorRequest", { id, user: PEOPLE.david })).body);
    expect(seen.requester.roleBadges).toEqual([
      { kind: "COHORT", label: "Cohort 04", programId: "cohort-a" }, { kind: "ALUMNI", label: "Alumni · Cohort 05", programId: "cohort-b" },
    ]);
    expect(seen.mentor.roleBadges).toEqual([{ kind: "MENTOR", label: "Mentor", programId: null }]);
  });

  it("is 404 to everyone but its two parties: other mentors, admins, institutions, other members", async () => {
    const s = setup();
    const id = await s.ask();
    for (const user of [PEOPLE.mercy, PEOPLE.amina, PEOPLE.amani, "synthetic-otieno"]) {
      const read = await s.call("getMentorRequest", { id, user });
      expect([read.status, errorOf(read.body).code], user).toEqual([404, "not_found"]);
      expect(request((await s.call("getMentorRequest", { id, user: VIEWER })).body).id).toBe(id);
      for (const operation of Object.keys(MOVES) as Move[]) {
        expect((await move(s, operation, id, user)).status, `${user} ${operation}`).toBe(404);
      }
    }
    expect((await s.call("getMentorRequest", { id: "missing" })).status).toBe(404);
  });

  it.each([
    ["yourself", { mentorId: VIEWER }, 400, "validation"],
    ["a person without the MENTOR role, even with a saved profile", { mentorId: PEOPLE.kevin }, 404, "not_found"],
    ["a paused mentor", { mentorId: PEOPLE.peter }, 404, "not_found"],
    ["a member who is not a mentor", { mentorId: "synthetic-otieno" }, 404, "not_found"],
    ["an unknown person", { mentorId: "nobody" }, 404, "not_found"],
    ["a format the mentor does not offer", { mentorId: PEOPLE.mercy, format: "CALL_30_MIN" }, 400, "validation"],
  ])("refuses asking %s", async (_, override, status, code) => {
    const s = setup();
    const response = await s.call("createMentorRequest", { body: { mentorId: PEOPLE.david, note: "Hello", project: null, format: "WRITTEN_REVIEW", ...override } });
    expect([response.status, errorOf(response.body).code]).toEqual([status, code]);
    expect(s.database.prepare("SELECT COUNT(*) AS n FROM mentor_request").get()).toEqual({ n: 0 });
  });

  it("refuses a mentor whose capacity is zero, and lists them nowhere", async () => {
    const s = setup();
    s.database.exec(`UPDATE mentor_profile SET monthlyCapacity = 0 WHERE userId = '${PEOPLE.david}'`);
    const response = await s.call("createMentorRequest", { body: { mentorId: PEOPLE.david, note: "Hi", project: null, format: "WRITTEN_REVIEW" } });
    expect([response.status, errorOf(response.body).code]).toEqual([404, "not_found"]);
  });

  it("refuses attached work that isn't the caller's own published project at its current revision", async () => {
    const s = setup();
    s.project("draft", { visibility: "private" });
    s.project("theirs", { owner: "synthetic-otieno" });
    s.project("moved-on", { version: 3 });
    const attach = (project: unknown) => s.call("createMentorRequest", { body: { mentorId: PEOPLE.david, note: "Hi", project, format: "WRITTEN_REVIEW" } });
    for (const [project, status] of [
      [{ type: "project", journeyId: "draft", version: 1 }, 400], [{ type: "project", journeyId: "theirs", version: 1 }, 400],
      [{ type: "project", journeyId: "missing", version: 1 }, 400], [{ type: "project", journeyId: "moved-on", version: 2 }, 409],
    ] as const) {
      expect((await attach(project)).status, JSON.stringify(project)).toBe(status);
    }
    expect(s.database.prepare("SELECT COUNT(*) AS n FROM mentor_request").get()).toEqual({ n: 0 });
  });

  it("needs the current code of conduct, because the note opens a conversation", async () => {
    const s = setup({ conduct: false });
    const refused = await s.call("createMentorRequest", { body: { mentorId: PEOPLE.david, note: "Hi", project: null, format: "WRITTEN_REVIEW" } });
    expect([refused.status, errorOf(refused.body).code]).toEqual([403, "conduct_required"]);
    s.agree();
    const newVersion = await s.call("createMentorRequest", { conductVersion: 2, body: { mentorId: PEOPLE.david, note: "Hi", project: null, format: "WRITTEN_REVIEW" } });
    expect(errorOf(newVersion.body).code).toBe("conduct_required");
    expect((await s.call("createMentorRequest", { body: { mentorId: PEOPLE.david, note: "Hi", project: null, format: "WRITTEN_REVIEW" } })).status).toBe(201);
  });

  it("allows no second PENDING request to the same mentor, and a new one once the first is answered", async () => {
    const s = setup();
    const first = await s.ask();
    const again = await s.call("createMentorRequest", { body: { mentorId: PEOPLE.david, note: "Again", project: null, format: "QUICK_QUESTION" } });
    expect([again.status, errorOf(again.body).code]).toEqual([409, "conflict"]);
    await move(s, "withdrawMentorRequest", first);
    await s.ask();
    expect(s.database.prepare("SELECT status FROM mentor_request ORDER BY status").all()).toEqual([{ status: "PENDING" }, { status: "WITHDRAWN" }]);
    // The database holds the line too, whatever the API checks.
    expect(() => s.database.exec(`INSERT INTO mentor_request(id, requesterId, mentorId, format, note) VALUES ('x', '${VIEWER}', '${PEOPLE.david}', 'WRITTEN_REVIEW', 'Third')`))
      .toThrow(/UNIQUE/);
  });

  it(`limits waiting requests to ${OPEN_REQUEST_LIMIT} at once, and requests made to ${DAILY_REQUEST_LIMIT.count} a day`, async () => {
    const s = setup();
    const mentors = Array.from({ length: OPEN_REQUEST_LIMIT + 1 }, (_, i) => `synthetic-extra-${i}`);
    for (const id of mentors) {
      s.database.prepare('INSERT INTO "user"(id,name,email) VALUES (?,?,?)').run(id, `Extra ${id}`, `${id}@example.test`);
      s.database.prepare("INSERT INTO UserRoles(id,userId,roleId) SELECT ?,?,id FROM Roles WHERE name = 'MENTOR'").run(`role-${id}`, id);
      s.database.prepare("INSERT INTO mentor_profile(userId,headline,monthlyCapacity,createdAt,updatedAt) VALUES (?,'Mentor',5,1,1)").run(id);
    }
    const ids = [];
    for (const id of mentors.slice(0, OPEN_REQUEST_LIMIT)) ids.push(await s.ask(id));
    const sixth = await s.call("createMentorRequest", { body: { mentorId: mentors.at(-1), note: "Hi", project: null, format: "WRITTEN_REVIEW" } });
    expect([sixth.status, errorOf(sixth.body).code]).toEqual([429, "rate_limited"]);
    // Withdrawing frees a place, until the day's requests run out.
    for (const id of ids) await move(s, "withdrawMentorRequest", id);
    for (let i = 0; i < DAILY_REQUEST_LIMIT.count - OPEN_REQUEST_LIMIT; i += 1) {
      await move(s, "withdrawMentorRequest", await s.ask(mentors[i % mentors.length]));
    }
    const tooMany = await s.call("createMentorRequest", { body: { mentorId: PEOPLE.david, note: "Hi", project: null, format: "WRITTEN_REVIEW" } });
    expect([tooMany.status, errorOf(tooMany.body).code]).toEqual([429, "rate_limited"]);
    expect(errorOf(tooMany.body).retryAfterMs).toBe(DAILY_REQUEST_LIMIT.windowMs);
    expect(tooMany.response.headers.get("Retry-After")).toBe(String(DAILY_REQUEST_LIMIT.windowMs / 1000));
  });

  it("masks contact details in the note for the mentor, not for the person who wrote it", async () => {
    const s = setup();
    const id = await s.ask(PEOPLE.david, { note: "Call me on 0712 345 678 to talk it through." });
    expect(request((await s.call("getMentorRequest", { id })).body).note).toBe("Call me on 0712 345 678 to talk it through.");
    const mentorSees = request((await s.call("getMentorRequest", { id, user: PEOPLE.david })).body).note;
    expect(mentorSees).toBe(`Call me on ${MASKED_CONTACT} to talk it through.`);
    expect(mentorSees).not.toMatch(/0712/);
  });

  it("re-checks attached work on every read: unavailable once it is made private", async () => {
    const s = setup();
    const id = await s.ask(PEOPLE.david, { project: s.project("ledger") });
    s.database.exec("UPDATE communityJourney SET visibility = 'private', version = 2 WHERE id = 'ledger'");
    for (const user of [VIEWER, PEOPLE.david]) {
      expect(request((await s.call("getMentorRequest", { id, user })).body).project).toEqual({ type: "unavailable", was: "project" });
    }
  });
});

describe("the request state machine", () => {
  it.each(Object.entries(MOVES) as [Move, (typeof MOVES)[Move]][])("%s moves PENDING to its state, once", async (operation, { status }) => {
    const s = setup();
    const id = await s.ask();
    const moved = await move(s, operation, id);
    expect([moved.status, request(moved.body).status]).toEqual([200, status]);
    // Every move from the new state is refused, whoever tries it: the end states are final.
    for (const next of Object.keys(MOVES) as Move[]) {
      const again = await move(s, next, id);
      expect([again.status, errorOf(again.body).code], `${operation} then ${next}`).toEqual([409, "conflict"]);
    }
    expect(s.database.prepare("SELECT status FROM mentor_request").all()).toEqual([{ status }]);
  });

  it("lets only the mentor answer and only the asker withdraw (403)", async () => {
    const s = setup();
    const id = await s.ask();
    for (const operation of ["acceptMentorRequest", "redirectMentorRequest", "declineMentorRequest"] as const) {
      const response = await move(s, operation, id, VIEWER);
      expect([response.status, errorOf(response.body).code], operation).toEqual([403, "forbidden"]);
    }
    expect((await move(s, "withdrawMentorRequest", id, PEOPLE.david)).status).toBe(403);
    expect(s.database.prepare("SELECT status FROM mentor_request").get()).toEqual({ status: "PENDING" });
  });

  it("keeps the mentor's note on a redirect or decline, and names the suggested mentor", async () => {
    const s = setup();
    const redirected = request((await move(s, "redirectMentorRequest", await s.ask())).body);
    expect(redirected).toMatchObject({ status: "REDIRECTED", responseNote: "Joseph knows career moves.",
      redirectedTo: { id: PEOPLE.joseph, name: "Joseph Mutua" } });
    expect(redirected.redirectedTo?.roleBadges.map((badge) => badge.kind)).toEqual(["MENTOR", "INSTITUTION"]);
    const declined = await s.call("declineMentorRequest", { id: await s.ask(), user: PEOPLE.david, body: { note: "Full with launches this month." } });
    expect(request(declined.body)).toMatchObject({ status: "DECLINED", responseNote: "Full with launches this month.", redirectedTo: null });
    const plain = await s.call("declineMentorRequest", { id: await s.ask(PEOPLE.mercy), user: PEOPLE.mercy, body: {} });
    expect(request(plain.body).responseNote).toBeNull();
  });

  it.each([
    ["themselves", PEOPLE.david], ["the person asking", VIEWER], ["a paused mentor", PEOPLE.peter],
    ["someone without the MENTOR role", PEOPLE.kevin], ["an unknown person", "nobody"],
  ])("refuses redirecting to %s (400), leaving the request waiting", async (_, mentorId) => {
    const s = setup();
    const id = await s.ask();
    const response = await s.call("redirectMentorRequest", { id, user: PEOPLE.david, body: { mentorId } });
    expect([response.status, errorOf(response.body).code]).toEqual([400, "validation"]);
    expect(s.database.prepare("SELECT status, redirectedToId FROM mentor_request").get()).toEqual({ status: "PENDING", redirectedToId: null });
  });

  it("refuses accepting once the mentor has lost the MENTOR role, but still lets them decline", async () => {
    const s = setup();
    const id = await s.ask();
    s.database.exec(`DELETE FROM UserRoles WHERE userId = '${PEOPLE.david}'`);
    const accepted = await move(s, "acceptMentorRequest", id);
    expect([accepted.status, errorOf(accepted.body).code]).toEqual([403, "forbidden"]);
    expect(s.database.prepare("SELECT COUNT(*) AS n FROM channel WHERE kind = 'DIRECT'").get()).toEqual({ n: 0 });
    expect((await move(s, "declineMentorRequest", id)).status).toBe(200);
  });

  it("keeps a redirected request readable once the suggested mentor's account is gone", async () => {
    const s = setup();
    const id = await s.ask();
    await move(s, "redirectMentorRequest", id);
    s.database.exec(`DELETE FROM "user" WHERE id = '${PEOPLE.joseph}'`);
    expect(request((await s.call("getMentorRequest", { id })).body)).toMatchObject({ status: "REDIRECTED", redirectedTo: null });
  });
});

describe("accepting opens a conversation", () => {
  it("creates a DIRECT channel for the two of them, with the note as the asker's first message and the work attached", async () => {
    const s = setup();
    const id = await s.ask(PEOPLE.david, { note: "Here is my fare splitter.", project: s.project("fare-splitter", { version: 4 }) });
    const accepted = request((await move(s, "acceptMentorRequest", id)).body);
    expect(accepted.status).toBe("ACCEPTED");
    const channelId = accepted.channelId!;
    expect(s.database.prepare("SELECT kind, programId, postingPolicy FROM channel WHERE id = ?").get(channelId))
      .toEqual({ kind: "DIRECT", programId: null, postingPolicy: "ALL" });
    expect(s.database.prepare("SELECT userId FROM channel_member WHERE channelId = ? ORDER BY userId").all(channelId))
      .toEqual([{ userId: PEOPLE.david }, { userId: VIEWER }]);
    for (const user of [VIEWER, PEOPLE.david]) {
      const page = await s.channelCall("listMessages", { id: channelId, user });
      expect(page.status, user).toBe(200);
      const [opening] = MessageList.parse(page.body).items;
      expect(opening).toMatchObject({ authorKind: "USER", author: { id: VIEWER }, body: "Here is my fare splitter.",
        embeds: [{ type: "project", journeyId: "fare-splitter", version: 4 }] });
    }
    // Idempotent like any post: one message per request, under a nonce of the asker's.
    expect(s.database.prepare("SELECT authorId, clientNonce FROM channel_message").all()).toEqual([{ authorId: VIEWER, clientNonce: openingNonce(id) }]);
    // Each sees the conversation named for the other person.
    const names = async (user: string) => (await s.channelCall("listChannels", { user })).body as { items: { id: string; name: string }[] };
    expect((await names(VIEWER)).items.find((channel) => channel.id === channelId)?.name).toBe("David Kamau");
    expect((await names(PEOPLE.david)).items.find((channel) => channel.id === channelId)?.name).toBe("Wanjiku Njeri");
  });

  it("attaches the work at the requested revision even after the asker has moved it on", async () => {
    const s = setup();
    const id = await s.ask(PEOPLE.david, { project: s.project("ledger", { version: 2 }) });
    s.database.exec("UPDATE communityJourney SET version = 3 WHERE id = 'ledger'");
    const { channelId } = request((await move(s, "acceptMentorRequest", id)).body);
    const [opening] = MessageList.parse((await s.channelCall("listMessages", { id: channelId!, user: PEOPLE.david })).body).items;
    expect(opening?.embeds).toMatchObject([{ type: "project", journeyId: "ledger", version: 2 }]);
  });

  it("flags contact details in the opening message as a post would: masked for the mentor, whole for its author", async () => {
    const s = setup();
    const id = await s.ask(PEOPLE.david, { note: "WhatsApp me on +254 712 345 678." });
    const { channelId } = request((await move(s, "acceptMentorRequest", id)).body);
    const read = async (user: string) => MessageList.parse((await s.channelCall("listMessages", { id: channelId!, user })).body).items[0];
    expect((await read(VIEWER))?.body).toBe("WhatsApp me on +254 712 345 678.");
    expect((await read(PEOPLE.david))?.body).toBe(`WhatsApp me on ${MASKED_CONTACT}.`);
    expect(s.database.prepare("SELECT action, source FROM moderation_event").all()).toEqual([{ action: "FLAG", source: "DETECTOR" }]);
  });

  it("reuses the conversation the two already share for a later request", async () => {
    const s = setup();
    const first = request((await move(s, "acceptMentorRequest", await s.ask())).body);
    const second = request((await move(s, "acceptMentorRequest", await s.ask(PEOPLE.david, { note: "A follow-up question." }))).body);
    expect(second.channelId).toBe(first.channelId);
    expect(s.database.prepare("SELECT COUNT(*) AS n FROM channel WHERE kind = 'DIRECT'").get()).toEqual({ n: 1 });
    expect(s.database.prepare("SELECT seq, body FROM channel_message ORDER BY seq").all())
      .toEqual([{ seq: 1, body: "Could you check how I handle a payment callback that arrives twice?" }, { seq: 2, body: "A follow-up question." }]);
  });

  it("opens a separate conversation for a different pair", async () => {
    const s = setup();
    const withDavid = request((await move(s, "acceptMentorRequest", await s.ask())).body);
    const withMercy = request((await s.call("acceptMentorRequest", { id: await s.ask(PEOPLE.mercy), user: PEOPLE.mercy, body: {} })).body);
    expect(withMercy.channelId).not.toBe(withDavid.channelId);
  });
});

describe("capacity, counted per Africa/Nairobi month", () => {
  const nairobi = (iso: string) => Date.parse(`${iso}+03:00`);

  it("starts months at Nairobi midnight, not UTC", () => {
    expect(monthStart(nairobi("2026-11-30T23:59:59.999"))).toBe(nairobi("2026-11-01T00:00:00"));
    expect(monthStart(nairobi("2026-12-01T00:00:00"))).toBe(nairobi("2026-12-01T00:00:00"));
    // 21:30 UTC on 30 November is already December in Nairobi.
    expect(monthStart(Date.parse("2026-11-30T21:30:00Z"))).toBe(Date.parse("2026-11-30T21:00:00Z"));
    expect(nextMonthStart(nairobi("2026-12-31T23:00:00"))).toBe(nairobi("2027-01-01T00:00:00"));
  });

  it("holds a spot for each pending request and each request accepted this month, and frees it at the turn of the month", async () => {
    const s = setup();
    s.database.exec(`UPDATE mentor_profile SET monthlyCapacity = 1 WHERE userId = '${PEOPLE.david}'`);
    const lastMinute = nairobi("2026-11-30T23:59:00");
    const id = await s.ask(PEOPLE.david, { now: lastMinute });
    await s.call("acceptMentorRequest", { id, user: PEOPLE.david, body: {}, now: () => lastMinute });
    const full = await s.call("createMentorRequest", { user: "synthetic-otieno", now: () => lastMinute,
      body: { mentorId: PEOPLE.david, note: "Me too?", project: null, format: "WRITTEN_REVIEW" } });
    expect([full.status, errorOf(full.body).code, errorOf(full.body).message]).toEqual([409, "conflict", "This mentor has no spots left this month."]);
    const december = nairobi("2026-12-01T00:00:00");
    expect(await s.ask(PEOPLE.david, { user: "synthetic-otieno", now: december })).toEqual(expect.any(String));
  });

  it("does not free a pending request's spot at the turn of the month: it still waits on the mentor", async () => {
    const s = setup();
    s.database.exec(`UPDATE mentor_profile SET monthlyCapacity = 1 WHERE userId = '${PEOPLE.david}'`);
    await s.ask(PEOPLE.david, { now: nairobi("2026-11-30T12:00:00") });
    const december = await s.call("createMentorRequest", { user: "synthetic-otieno", now: () => nairobi("2026-12-02T00:00:00"),
      body: { mentorId: PEOPLE.david, note: "Me too?", project: null, format: "WRITTEN_REVIEW" } });
    expect(december.status).toBe(409);
  });

  it("frees a spot when a request is declined, redirected or withdrawn, and accepting needs none of its own", async () => {
    const s = setup();
    s.database.exec(`UPDATE mentor_profile SET monthlyCapacity = 1 WHERE userId = '${PEOPLE.david}'`);
    for (const operation of ["declineMentorRequest", "redirectMentorRequest", "withdrawMentorRequest"] as const) {
      await move(s, operation, await s.ask());
    }
    const id = await s.ask();
    // Lowering the capacity below what is held refuses nobody already waiting.
    s.database.exec(`UPDATE mentor_profile SET monthlyCapacity = 0 WHERE userId = '${PEOPLE.david}'`);
    expect((await move(s, "acceptMentorRequest", id)).status).toBe(200);
  });
});

describe("listing requests", () => {
  it("lists what the caller sent or received, newest first, with a status filter and stable pages", async () => {
    const s = setup();
    const ids: string[] = [];
    // Three hours apart, so the daily limit never applies.
    const at = (i: number) => NOW + i * 3 * 60 * 60_000;
    for (let i = 0; i < REQUEST_PAGE_SIZE + 2; i += 1) {
      const id = await s.ask(PEOPLE.david, { now: at(i) });
      ids.push(id);
      if (i < REQUEST_PAGE_SIZE + 1) await s.call("withdrawMentorRequest", { id, body: {}, now: () => at(i) });
    }
    const list = async (query: string, user: string = VIEWER) => {
      const response = await s.call("listMentorRequests", { query, user });
      expect(response.status).toBe(200);
      return MentorRequestList.parse(response.body);
    };
    const first = await list("?as=requester");
    expect(first.items.map((item) => item.id)).toEqual(ids.toReversed().slice(0, REQUEST_PAGE_SIZE));
    const second = await list(`?as=requester&cursor=${first.nextCursor}`);
    expect([...second.items.map((item) => item.id), second.nextCursor]).toEqual([ids[1], ids[0], null]);
    expect((await list("?as=requester&status=PENDING")).items.map((item) => item.id)).toEqual([ids.at(-1)]);
    expect((await list("?as=mentor", PEOPLE.david)).items).toHaveLength(REQUEST_PAGE_SIZE);
    expect((await list("?as=mentor")).items).toEqual([]);
    expect((await list("?as=requester", PEOPLE.david)).items).toEqual([]);
  });

  it.each(["?as=requester&cursor=not-a-cursor", "?as=everyone", "?status=PENDING", "?as=mentor&as=requester"])("refuses %s (400)", async (query) => {
    const s = setup();
    expect((await s.call("listMentorRequests", { query })).status).toBe(400);
  });
});
