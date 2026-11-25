import { describe, expect, it } from "vitest";
import { ASKER, createChatTestDb } from "@/test/chat-db";
import { getChatMessages, listChatSessions, saveChatExchange } from "./sessions";
import { messageForReader, storedCitations, WITHHELD_ANSWER } from "./stored-sources";
import type { TranscriptSource } from "./tools";

/*
 * Ask Tembo's saved answers are checked again on every read (lib/recordings/README.md, "Stored copies
 * of transcript text"): on SQLite with every migration, for the owner as they are now.
 */
const MEMBER = { cohortIds: ["cohort-a"], teachingCohortIds: [], isAdmin: false };
const HOST = { cohortIds: ["cohort-a"], teachingCohortIds: ["cohort-a"], isAdmin: false };
const ADMIN = { cohortIds: [], teachingCohortIds: [], isAdmin: true };
const WORDS = "Retries need idempotency keys [1].";

const source = (recordingId: string): TranscriptSource =>
  ({ sourceNumber: 1, recordingId, title: `Session ${recordingId}`, startTime: 0, endTime: 30, text: "Retries need idempotency keys" });
const citation = (recordingId: string) => ({ sourceNumber: 1, recordingId, title: `Session ${recordingId}`, startTime: 0, endTime: 30, text: "Retries" });

function setup() {
  const chat = createChatTestDb();
  chat.database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId) VALUES ('cohort-a','Cohort A','Test','curriculum'),('cohort-b','Cohort B','Test','curriculum');`);
  for (const id of ["shown", "changed"]) {
    chat.database.prepare(`INSERT INTO recording(id,programId,accessScope,title,processingStatus) VALUES (?,'cohort-a','COHORT',?,'complete')`).run(id, `Session ${id}`);
  }
  /** Saves one exchange as pages/api/chat.ts does: the answer's citations, then a trace of every recording read. */
  const ask = (id: string, { cited = [] as string[], read = [] as string[], at = 0 } = {}) => saveChatExchange(chat.db, ASKER.id,
    { kind: "new", id, title: id }, { question: `Question ${id}`, answer: `${WORDS} (${id})`,
      citations: storedCitations(cited.map(citation), cited.map(source), read) })
    .then(() => chat.database.prepare(`UPDATE chat_message SET createdAt = createdAt + ? WHERE sessionId = ?`).run(at, id));
  return { ...chat, ask };
}

describe("storedCitations", () => {
  it("keeps what the reader is shown, then traces each recording read once", () => {
    expect(storedCitations([citation("a")], [source("a"), source("a")], new Set(["b", "a"]))).toEqual([
      citation("a"), { type: "read", recordingId: "a" }, { type: "read", recordingId: "b" },
    ]);
  });
});

describe("messageForReader", () => {
  it("strips traces, and withholds only an answer that drew on a recording gone for its reader", () => {
    const answer = { role: "assistant", content: WORDS, citations: [citation("a"), citation("b"), { type: "read", recordingId: "c" }] };
    expect(messageForReader(answer, new Set())).toEqual({ ...answer, citations: [citation("a"), citation("b")] });
    expect(messageForReader(answer, new Set(["b"]))).toEqual({ role: "assistant", content: WITHHELD_ANSWER, citations: [citation("a")] });
    expect(messageForReader(answer, new Set(["c"]))).toEqual({ role: "assistant", content: WITHHELD_ANSWER, citations: [citation("a"), citation("b")] });
    expect(messageForReader({ role: "user", content: "Question", citations: [] }, new Set(["a"])).content).toBe("Question");
  });
});

describe("Ask Tembo's saved answers", () => {
  it("keep their words while the owner may read every session they drew on", async () => {
    const s = setup();
    await s.ask("both", { cited: ["shown", "changed"] });
    const messages = await getChatMessages(s.db, ASKER.id, "both", MEMBER);
    expect(messages?.map(({ role, content }) => [role, content])).toEqual([["user", "Question both"], ["assistant", `${WORDS} (both)`]]);
    expect(messages?.[1]?.citations).toEqual([citation("shown"), citation("changed")]);
  });

  it.each([
    ["hidden from the cohort", "UPDATE recording SET hiddenAt = 1 WHERE id = 'changed'"],
    ["deleted", "UPDATE recording SET deletedAt = 1 WHERE id = 'changed'"],
    ["moved to another cohort", "UPDATE recording SET programId = 'cohort-b' WHERE id = 'changed'"],
    ["moved out of every cohort", "UPDATE recording SET programId = NULL WHERE id = 'changed'"],
    ["being processed again", "UPDATE recording SET processingStatus = 'transcribing' WHERE id = 'changed'"],
    ["gone from the table", "DELETE FROM recording WHERE id = 'changed'"],
  ])("are withheld once a session they cite is %s", async (_, change) => {
    const s = setup();
    await s.ask("both", { cited: ["shown", "changed"] });
    s.database.exec(change);
    const [question, answer] = (await getChatMessages(s.db, ASKER.id, "both", MEMBER)) ?? [];
    expect(question?.content).toBe("Question both");
    expect(answer?.content).toBe(WITHHELD_ANSWER);
    expect(answer?.citations).toEqual([citation("shown")]);
    expect((await listChatSessions(s.db, ASKER.id, MEMBER))[0]?.latestMessage).toBe(WITHHELD_ANSWER);
  });

  it("are withheld when a session the tools read but didn't cite is gone", async () => {
    const s = setup();
    await s.ask("traced", { read: ["changed"] });
    s.database.exec("UPDATE recording SET hiddenAt = 1 WHERE id = 'changed'");
    const [, answer] = (await getChatMessages(s.db, ASKER.id, "traced", MEMBER)) ?? [];
    expect(answer).toMatchObject({ content: WITHHELD_ANSWER, citations: [] });
  });

  it("show a hidden session's answer to the cohort's hosts and admins, who may still read it", async () => {
    const s = setup();
    await s.ask("hidden", { cited: ["changed"] });
    s.database.exec("UPDATE recording SET hiddenAt = 1 WHERE id = 'changed'");
    for (const viewer of [HOST, ADMIN]) {
      const [, answer] = (await getChatMessages(s.db, ASKER.id, "hidden", viewer)) ?? [];
      expect(answer?.content).toBe(`${WORDS} (hidden)`);
    }
  });

  it("preview only what the owner may still read: the latest message, withheld like the message itself", async () => {
    const s = setup();
    await s.ask("older", { cited: ["shown"] });
    await s.ask("newer", { cited: ["changed"], at: 10 });
    s.database.exec("UPDATE recording SET hiddenAt = 1 WHERE id = 'changed'");
    const previews = Object.fromEntries((await listChatSessions(s.db, ASKER.id, MEMBER)).map(({ id, latestMessage }) => [id, latestMessage]));
    expect(previews).toEqual({ older: `${WORDS} (older)`, newer: WITHHELD_ANSWER });
  });

  it("check the conversation from before conversations were saved separately too", async () => {
    const s = setup();
    s.database.prepare(`INSERT INTO chat_message(id,sessionId,userId,role,content,citations) VALUES ('legacy-answer',NULL,?,'assistant',?,?)`)
      .run(ASKER.id, WORDS, JSON.stringify([citation("changed")]));
    s.database.exec("UPDATE recording SET deletedAt = 1 WHERE id = 'changed'");
    expect((await getChatMessages(s.db, ASKER.id, "legacy", MEMBER))?.map(({ content }) => content)).toEqual([WITHHELD_ANSWER]);
    expect((await listChatSessions(s.db, ASKER.id, MEMBER)).find(({ id }) => id === "legacy")?.latestMessage).toBe(WITHHELD_ANSWER);
  });
});
