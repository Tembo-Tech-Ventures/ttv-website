import { readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import {
  TITLE_MAX,
  detailsFromForm,
  detailsUpdate,
  readRecordingDetail,
  recordedAtField,
  transcribeAgain,
  transcriptFromForm,
} from "./recording-detail";

const databases: { close(): void }[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

/** Every migration, two cohorts, and one recording in Cohort 07 with two transcript segments, failed once. */
function seeded() {
  const { database, db } = createSqliteD1();
  databases.push(database);
  for (const file of readdirSync(new URL("../db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId,startDate,endDate) VALUES
      ('cohort-08','Cohort 08','Test','curriculum',0,4102444800),('cohort-07','Cohort 07','Test','curriculum',0,4102444800);
    INSERT INTO recording(id,programId,title,processingStatus,processingError) VALUES ('recording','cohort-07','Week 4: SQL joins','failed','Transcription timed out');
    INSERT INTO transcript_segment(id,recordingId,startTime,endTime,speaker,text) VALUES
      ('segment-1','recording',0,4,'Mentor','Karibu.'),('segment-2','recording',4,9,'Mentor','Joins next.');`);
  return drizzle(db, { schema });
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

const statusOf = async (db: ReturnType<typeof seeded>) =>
  (await db.query.recording.findFirst({ where: eq(schema.recording.id, "recording"), columns: { processingStatus: true, processingError: true } }))!;

describe("reading one recording for the admin, on the real schema", () => {
  it("reads the recording, counts its segments in SQL and lists the cohorts by name", async () => {
    const detail = await readRecordingDetail(seeded(), "recording");
    expect(detail?.recording).toMatchObject({ title: "Week 4: SQL joins", programId: "cohort-07", processingStatus: "failed" });
    expect(detail?.segments).toBe(2);
    expect(detail?.programs).toEqual([{ id: "cohort-07", name: "Cohort 07" }, { id: "cohort-08", name: "Cohort 08" }]);
  });

  it("reads nothing for a recording that isn't there", async () => {
    expect(await readRecordingDetail(seeded(), "missing")).toBeNull();
  });
});

describe("the details form", () => {
  const programs = ["cohort-07"];

  it("takes a trimmed title, a listed cohort or none, a real day and a description", () => {
    const { values, errors } = detailsFromForm(form({ title: "  Week 4  ", programId: "", recordedAt: "2026-11-03", description: " Joins. " }), programs);
    expect(errors).toEqual({});
    expect(values).toEqual({ title: "Week 4", programId: "", recordedAt: "2026-11-03", description: "Joins." });
    expect(detailsFromForm(form({ title: "Week 4", programId: "cohort-07" }), programs).errors).toEqual({});
  });

  it("says what is wrong with each field in words", () => {
    expect(detailsFromForm(form({ title: "   " }), programs).errors).toEqual({ title: "Give the recording a title." });
    expect(detailsFromForm(form({ title: "x".repeat(TITLE_MAX + 1) }), programs).errors.title).toBe(`Keep the title to ${TITLE_MAX} characters.`);
    expect(detailsFromForm(form({ title: "Week 4", programId: "cohort-99" }), programs).errors).toEqual({ programId: "Choose a cohort from the list, or no cohort." });
    for (const day of ["2026-02-30", "3 Nov", "2026-1-3"]) {
      expect(detailsFromForm(form({ title: "Week 4", recordedAt: day }), programs).errors).toEqual({ recordedAt: "Write the date as a day, month and year." });
    }
  });

  it("keeps the recorded moment when the day is left as the page showed it, and writes a new day at midnight UTC", () => {
    // 22:30 UTC on 2 Nov is 3 Nov in Nairobi, the day the page shows.
    const moment = new Date(Date.UTC(2026, 10, 2, 22, 30));
    expect(recordedAtField(moment)).toBe("2026-11-03");
    expect(recordedAtField(null)).toBe("");
    const values = { title: "Week 4", programId: "", recordedAt: "2026-11-03", description: "" };
    expect(detailsUpdate(values, { recordedAt: moment })).toEqual({ title: "Week 4", description: null, programId: null, recordedAt: moment });
    expect(detailsUpdate({ ...values, recordedAt: "2026-11-04" }, { recordedAt: moment }).recordedAt).toEqual(new Date(Date.UTC(2026, 10, 4)));
    expect(detailsUpdate({ ...values, recordedAt: "" }, { recordedAt: moment }).recordedAt).toBeNull();
  });
});

describe("the transcript form", () => {
  it("takes any text, and captions that are WebVTT or empty", () => {
    for (const transcriptVtt of ["", "  ", "WEBVTT\n\n00:00.000 --> 00:04.000\nKaribu.", "﻿WEBVTT - Week 4\n", "WEBVTT"]) {
      expect(transcriptFromForm(form({ transcriptText: "Karibu.", transcriptVtt })).errors).toEqual({});
    }
  });

  it("refuses captions that aren't WebVTT, keeping what was written", () => {
    const { values, errors } = transcriptFromForm(form({ transcriptText: "Karibu.", transcriptVtt: "1\n00:00:00,000 --> 00:00:04,000\nKaribu." }));
    expect(values.transcriptVtt).toBe("1\n00:00:00,000 --> 00:00:04,000\nKaribu.");
    expect(errors.transcriptVtt).toMatch(/^Captions in WebVTT start with the line WEBVTT\./);
    expect(transcriptFromForm(form({ transcriptVtt: "WEBVTTX" })).errors.transcriptVtt).toBeDefined();
  });
});

describe("transcribing a recording again, on the real schema", () => {
  it("queues it from the status the page showed, clearing the last error", async () => {
    const db = seeded();
    const queue = { send: vi.fn().mockResolvedValue(undefined) };
    expect(await transcribeAgain(db, queue, "recording", "failed")).toEqual({ ok: true });
    expect(queue.send).toHaveBeenCalledWith({ type: "process_recording", recordingId: "recording" });
    expect(await statusOf(db)).toEqual({ processingStatus: "queued", processingError: null });
  });

  it("refuses a status that moved since the page was drawn, before any write or message", async () => {
    const db = seeded();
    const queue = { send: vi.fn() };
    expect(await transcribeAgain(db, queue, "recording", "complete")).toEqual({ ok: false, reason: "changed" });
    expect(await transcribeAgain(db, queue, "missing", "failed")).toEqual({ ok: false, reason: "missing" });
    expect(queue.send).not.toHaveBeenCalled();
    expect(await statusOf(db)).toEqual({ processingStatus: "failed", processingError: "Transcription timed out" });
  });

  it("puts the status and error back when the queue refuses the message", async () => {
    const db = seeded();
    const queue = { send: vi.fn().mockRejectedValue(new Error("queue down")) };
    await expect(transcribeAgain(db, queue, "recording", "failed")).rejects.toThrow("queue down");
    expect(await statusOf(db)).toEqual({ processingStatus: "failed", processingError: "Transcription timed out" });
  });
});
