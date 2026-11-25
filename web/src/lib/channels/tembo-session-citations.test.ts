import { afterEach, describe, expect, it } from "vitest";
import { listMessages, readMessage, TEMBO_SESSION_GONE, type ReadContext } from "./messages";
import { touchAnswersCiting } from "./mutations";
import { channelDatabase, type ChannelFixture } from "./test-support";

/*
 * Tembo's answers in a cohort channel quote the cohort's sessions (lib/recordings/README.md, "Stored
 * copies of transcript text"). Each read checks every cited session again, as the cohort reads it: an
 * answer citing one the cohort may no longer read keeps none of its words, and that citation goes.
 */
const fixtures: ChannelFixture[] = [];
afterEach(() => { fixtures.splice(0).forEach(({ database }) => database.close()); });

const WORDS = "Webhook retries need idempotency keys [1].";

function setup() {
  const s = channelDatabase({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
  fixtures.push(s);
  for (const id of ["shown", "changed"]) {
    s.database.prepare(`INSERT INTO recording(id,programId,accessScope,title,processingStatus) VALUES (?,'cohort-a','COHORT',?,'complete')`).run(id, `Session ${id}`);
  }
  const question = s.message("cohort-04", { body: "@tembo how do retries work?" });
  /** A Tembo answer in `slug` citing these sessions (and, with `message`, a message too). */
  const answer = (recordings: string[], { slug = "cohort-04", message = false } = {}) => {
    const parentId = slug === "cohort-04" ? question : s.message(slug, { body: "@tembo how do retries work?" });
    const id = s.message(slug, { tembo: true, parentId, body: WORDS });
    const citations = [
      ...recordings.map((recordingId) => ({ type: "sessionClip", recordingId, startSeconds: 0, title: `Session ${recordingId} at 0:00`, href: `/dashboard/sessions/${recordingId}?t=0` })),
      ...message ? [{ type: "message", messageId: question, channelId: s.channel("cohort-04"), title: "@tembo how do retries work?", href: "/dashboard/cohort/c/cohort-04" }] : [],
    ];
    s.database.prepare("UPDATE channel_message SET citations = ? WHERE id = ?").run(JSON.stringify(citations), id);
    return id;
  };
  const ctx = (slug = "cohort-04"): ReadContext => ({
    db: s.d1, viewerId: "synthetic-faith",
    channel: { id: s.channel(slug), kind: slug === "cohort-04" ? "COHORT" : "COMMUNITY", programId: slug === "cohort-04" ? "cohort-a" : null,
      capabilities: { canPost: true, canModerate: true, canShareSessionClip: true } },
  });
  return { ...s, answer, ctx };
}

describe("Tembo's answers that quote a session", () => {
  it("keep their words and citations while the cohort may read every session they cite", async () => {
    const s = setup();
    const id = s.answer(["shown"], { message: true });
    const message = await readMessage(s.ctx(), id);
    expect(message?.body).toBe(WORDS);
    expect(message?.citations.map((citation) => citation.type)).toEqual(["sessionClip", "message"]);
  });

  it.each([
    ["hidden from the cohort", "UPDATE recording SET hiddenAt = 1 WHERE id = 'changed'"],
    ["deleted", "UPDATE recording SET deletedAt = 1 WHERE id = 'changed'"],
    ["moved to another cohort", "UPDATE recording SET programId = 'cohort-b' WHERE id = 'changed'"],
    ["moved out of every cohort", "UPDATE recording SET programId = NULL WHERE id = 'changed'"],
    ["being processed again", "UPDATE recording SET processingStatus = 'transcribing' WHERE id = 'changed'"],
    ["gone from the table", "DELETE FROM recording WHERE id = 'changed'"],
  ])("are withheld once a cited session is %s, even for the cohort's hosts", async (_, change) => {
    const s = setup();
    const id = s.answer(["shown", "changed"], { message: true });
    s.database.exec(change);
    // The TA (a host, a moderator here) reads as the whole cohort does: Tembo answered all of it.
    const message = await readMessage(s.ctx(), id);
    expect(message?.body).toBe(TEMBO_SESSION_GONE);
    // Only the gone session's citation goes; what the cohort may still read stays.
    expect(message?.citations.map((citation) => citation.type === "sessionClip" ? citation.recordingId : citation.type)).toEqual(["shown", "message"]);
  });

  it("are withheld outside a cohort channel, where no session is anyone's to read", async () => {
    const s = setup();
    const id = s.answer(["shown"], { slug: "help" });
    expect((await readMessage(s.ctx("help"), id))?.body).toBe(TEMBO_SESSION_GONE);
  });

  it("leave a person's message alone, whatever it cites", async () => {
    const s = setup();
    const id = s.message("cohort-04", { body: "Session changed was good" });
    s.database.prepare("UPDATE channel_message SET citations = ? WHERE id = ?")
      .run(JSON.stringify([{ type: "sessionClip", recordingId: "changed", startSeconds: 0, title: "Session", href: "/dashboard/sessions/changed?t=0" }]), id);
    s.database.exec("UPDATE recording SET hiddenAt = 1 WHERE id = 'changed'");
    expect((await readMessage(s.ctx(), id))?.body).toBe("Session changed was good");
  });

  it("reach an open thread when a recording is hidden and restored, through touchAnswersCiting", async () => {
    const s = setup();
    const cited = s.answer(["changed"]);
    const other = s.answer(["shown"]);
    const thread = (await readMessage(s.ctx(), cited))!.parentId!;
    const first = await listMessages(s.ctx(), { thread });
    expect(first.items.find(({ id }) => id === cited)?.body).toBe(WORDS);

    s.database.exec("UPDATE recording SET hiddenAt = 1 WHERE id = 'changed'");
    await expect(touchAnswersCiting(s.d1, "changed")).resolves.toBe(1);
    const hidden = await listMessages(s.ctx(), { thread, since: first.sinceCursor });
    expect(hidden.items.map(({ id, body }) => [id, body])).toEqual([[cited, TEMBO_SESSION_GONE]]);

    s.database.exec("UPDATE recording SET hiddenAt = NULL WHERE id = 'changed'");
    await touchAnswersCiting(s.d1, "changed");
    const restored = await listMessages(s.ctx(), { thread, since: hidden.sinceCursor });
    expect(restored.items.map(({ id, body }) => [id, body])).toEqual([[cited, WORDS]]);
    expect(restored.items.some(({ id }) => id === other)).toBe(false);
  });

  it("are left alone by touchAnswersCiting when nothing cites the recording", async () => {
    const s = setup();
    s.answer(["shown"]);
    await expect(touchAnswersCiting(s.d1, "changed")).resolves.toBe(0);
  });
});
