import { describe, expect, it, vi } from "vitest";
import {
  ADMIN,
  JPEG_BYTES,
  OTHER_STUDENT,
  PNG_BYTES,
  STUDENT,
  createFeedbackTestDb,
  createMemoryBucket,
  imageFile,
} from "@/test/feedback-db";
import { readMigration } from "@/test/sqlite-d1";
import { FeedbackValidationError, MAX_FEEDBACK_PER_DAY } from "./model";
import {
  countFeedbackByStatus,
  getFeedback,
  getFeedbackAttachmentObject,
  listFeedback,
  listFeedbackForUser,
  updateFeedback,
} from "./store";
import { FeedbackRateLimitError, submitFeedback } from "./submit";

const REQUEST_URL = "https://tembotechventures.com/api/feedback";
const NOW = new Date("2026-10-20T12:00:00.000Z");

function sequentialIds() {
  let next = 0;
  return () => `id-${(next += 1)}`;
}

function form(fields: Record<string, string>, files: File[] = [], sources: string[] = []) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  for (const file of files) formData.append("attachments", file);
  for (const source of sources) formData.append("attachmentSources", source);
  return formData;
}

async function submit(
  setup: ReturnType<typeof createFeedbackTestDb>,
  bucket: ReturnType<typeof createMemoryBucket>,
  formData: FormData,
  { userId = STUDENT.id, now = NOW, newId = sequentialIds() } = {}
) {
  return submitFeedback(
    { formData, userId, requestUrl: REQUEST_URL, appVersion: "abc1234" },
    { db: setup.db, bucket, now, newId }
  );
}

describe("feedback migration", () => {
  it("is safe to apply twice and enforces its vocabulary", () => {
    const setup = createFeedbackTestDb();
    expect(() => setup.database.exec(readMigration("0015_student_feedback.sql"))).not.toThrow();

    const insert = setup.database.prepare(
      `INSERT INTO "feedback" ("id", "userId", "kind", "message", "pageUrl", "status")
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    insert.run("ok", STUDENT.id, "BUG", "hi", "https://x/", "NEW");
    expect(() => insert.run("bad-kind", STUDENT.id, "RANT", "hi", "https://x/", "NEW")).toThrow(
      /CHECK constraint failed/
    );
    expect(() =>
      insert.run("bad-status", STUDENT.id, "BUG", "hi", "https://x/", "DONE")
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      insert.run("long", STUDENT.id, "BUG", "x".repeat(5_001), "https://x/", "NEW")
    ).toThrow(/CHECK constraint failed/);
  });
});

describe("submitFeedback", () => {
  it("stores the note, its context and its images", async () => {
    const setup = createFeedbackTestDb();
    const bucket = createMemoryBucket();

    const { id } = await submit(
      setup,
      bucket,
      form(
        {
          kind: "BUG",
          message: "  The apply button does nothing  ",
          pageUrl: "https://tembotechventures.com/dashboard/apply#form",
          pageTitle: "Apply | TTV",
          context: JSON.stringify({ viewport: { width: 390, height: 844 }, secret: "x" }),
        },
        [imageFile(PNG_BYTES), imageFile(JPEG_BYTES, "photo.jpg", "image/png")],
        ["CAPTURE", "UPLOAD"]
      )
    );

    expect(id).toBe("id-1");
    expect([...bucket.objects.keys()]).toEqual([
      "feedback/id-1/id-2.png",
      // The claimed image/png is ignored: the bytes say JPEG.
      "feedback/id-1/id-3.jpg",
    ]);
    expect(bucket.put).toHaveBeenCalledWith("feedback/id-1/id-3.jpg", JPEG_BYTES, {
      httpMetadata: { contentType: "image/jpeg" },
      customMetadata: { feedbackId: "id-1", userId: STUDENT.id },
    });

    const stored = await getFeedback(setup.db, id);
    expect(stored).toMatchObject({
      kind: "BUG",
      status: "NEW",
      message: "The apply button does nothing",
      pageUrl: "https://tembotechventures.com/dashboard/apply",
      pageTitle: "Apply | TTV",
      appVersion: "abc1234",
      context: { viewport: { width: 390, height: 844 }, errors: [] },
      user: STUDENT,
      handledBy: null,
      resolvedAt: null,
      createdAt: NOW,
    });
    expect(stored?.attachments).toEqual([
      { id: "id-2", contentType: "image/png", size: PNG_BYTES.byteLength, source: "CAPTURE", position: 0 },
      { id: "id-3", contentType: "image/jpeg", size: JPEG_BYTES.byteLength, source: "UPLOAD", position: 1 },
    ]);
  });

  it("accepts a screenshot with no text, and text with no screenshot", async () => {
    const setup = createFeedbackTestDb();
    const bucket = createMemoryBucket();
    const newId = sequentialIds();

    await submit(setup, bucket, form({ message: "" }, [imageFile(PNG_BYTES)]), { newId });
    await submit(setup, bucket, form({ message: "Love the new dashboard" }), { newId });

    const items = await listFeedbackForUser(setup.db, STUDENT.id);
    expect(items.map((item) => [item.kind, item.message, item.attachments.length])).toEqual([
      ["OTHER", "Love the new dashboard", 0],
      ["OTHER", "", 1],
    ]);
  });

  it("asks for something when the note is empty", async () => {
    const setup = createFeedbackTestDb();
    await expect(
      submit(setup, createMemoryBucket(), form({ message: "   " }))
    ).rejects.toThrow("Tell us a little about it, or add a screenshot.");
  });

  it("rejects non-images before uploading anything", async () => {
    const setup = createFeedbackTestDb();
    const bucket = createMemoryBucket();
    const html = new File(["<html><script>alert(1)</script>"], "x.png", { type: "image/png" });

    await expect(
      submit(setup, bucket, form({ message: "hi" }, [imageFile(PNG_BYTES), html]))
    ).rejects.toThrow(/PNG, JPG, WebP or GIF/);
    expect(bucket.put).not.toHaveBeenCalled();
    expect(await countFeedbackByStatus(setup.db)).toMatchObject({ NEW: 0 });
  });

  it("limits the number and size of images", async () => {
    const setup = createFeedbackTestDb();
    const six = Array.from({ length: 6 }, () => imageFile(PNG_BYTES));
    await expect(
      submit(setup, createMemoryBucket(), form({ message: "hi" }, six))
    ).rejects.toThrow("Attach up to 5 images.");

    const huge = imageFile(new Uint8Array(5 * 1024 * 1024 + 1));
    await expect(
      submit(setup, createMemoryBucket(), form({ message: "hi" }, [huge]))
    ).rejects.toThrow("Each image must be 5 MB or smaller.");
  });

  it("rejects pages from another site", async () => {
    const setup = createFeedbackTestDb();
    await expect(
      submit(
        setup,
        createMemoryBucket(),
        form({ message: "hi", pageUrl: "https://evil.example/" })
      )
    ).rejects.toBeInstanceOf(FeedbackValidationError);
  });

  it("caps notes per student per day", async () => {
    const setup = createFeedbackTestDb();
    const bucket = createMemoryBucket();
    const newId = sequentialIds();
    const earlier = new Date(NOW.getTime() - 25 * 60 * 60 * 1_000);

    await submit(setup, bucket, form({ message: "yesterday" }), { newId, now: earlier });
    for (let index = 0; index < MAX_FEEDBACK_PER_DAY; index += 1) {
      await submit(setup, bucket, form({ message: `note ${index}` }), { newId });
    }
    await expect(
      submit(setup, bucket, form({ message: "one more" }), { newId })
    ).rejects.toBeInstanceOf(FeedbackRateLimitError);
    // Another student is unaffected.
    await expect(
      submit(setup, bucket, form({ message: "mine" }), { newId, userId: OTHER_STUDENT.id })
    ).resolves.toBeDefined();
  });

  it("removes uploaded images when the database write fails", async () => {
    const setup = createFeedbackTestDb();
    const bucket = createMemoryBucket();

    await expect(
      submit(setup, bucket, form({ message: "hi" }, [imageFile(PNG_BYTES)]), {
        userId: "deleted-user",
      })
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    expect(bucket.delete).toHaveBeenCalledWith(["feedback/id-1/id-2.png"]);
    expect(bucket.objects.size).toBe(0);
  });
});

describe("listing and updating", () => {
  async function seeded() {
    const setup = createFeedbackTestDb();
    const bucket = createMemoryBucket();
    const newId = sequentialIds();
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
    await submit(setup, bucket, form({ kind: "BUG", message: "first" }, [imageFile(PNG_BYTES)]), {
      newId,
      now: at(0),
    });
    await submit(setup, bucket, form({ kind: "IDEA", message: "second" }), {
      newId,
      now: at(1),
      userId: OTHER_STUDENT.id,
    });
    await submit(setup, bucket, form({ kind: "BUG", message: "third" }), { newId, now: at(2) });
    return setup;
  }

  it("lists newest first, filtered by status and kind", async () => {
    const setup = await seeded();
    const all = await listFeedback(setup.db, { statuses: ["NEW"] });
    expect(all.map((item) => item.message)).toEqual(["third", "second", "first"]);
    expect(all[2].attachments).toHaveLength(1);

    const bugs = await listFeedback(setup.db, { statuses: ["NEW"], kind: "BUG", limit: 1 });
    expect(bugs.map((item) => item.message)).toEqual(["third"]);
    expect(await listFeedback(setup.db, { statuses: [] })).toEqual([]);
    expect(await listFeedback(setup.db, { statuses: ["RESOLVED"] })).toEqual([]);
  });

  it("shows a student only their own feedback", async () => {
    const setup = await seeded();
    const mine = await listFeedbackForUser(setup.db, OTHER_STUDENT.id);
    expect(mine.map((item) => item.message)).toEqual(["second"]);
  });

  it("records who handled an item and when it closed", async () => {
    const setup = await seeded();
    const later = new Date(NOW.getTime() + 60 * 60_000);

    const resolved = await updateFeedback(
      setup.db,
      "id-1",
      {
        status: "RESOLVED",
        response: "Fixed, thanks!",
        resolutionUrl: "https://github.com/o/r/pull/9",
        adminNote: "Root cause: stale form token",
      },
      { actorId: ADMIN.id, now: later }
    );
    expect(resolved).toMatchObject({
      outcome: "updated",
      feedback: {
        status: "RESOLVED",
        response: "Fixed, thanks!",
        resolutionUrl: "https://github.com/o/r/pull/9",
        adminNote: "Root cause: stale form token",
        handledBy: { id: ADMIN.id, name: ADMIN.name },
        resolvedAt: later,
        updatedAt: later,
      },
    });

    // Editing the reply on a closed item keeps the original close time.
    const edited = await updateFeedback(
      setup.db,
      "id-1",
      { status: "DECLINED", response: null },
      { actorId: ADMIN.id, now: new Date(later.getTime() + 60_000) }
    );
    expect(edited).toMatchObject({
      feedback: { status: "DECLINED", response: null, resolvedAt: later },
    });

    // Reopening clears it.
    const reopened = await updateFeedback(
      setup.db,
      "id-1",
      { status: "IN_PROGRESS" },
      { actorId: ADMIN.id }
    );
    expect(reopened).toMatchObject({
      feedback: { status: "IN_PROGRESS", resolvedAt: null, adminNote: "Root cause: stale form token" },
    });
  });

  it("lets only one agent claim an item", async () => {
    const setup = await seeded();
    const claim = () =>
      updateFeedback(
        setup.db,
        "id-1",
        { status: "IN_PROGRESS" },
        { actorId: ADMIN.id, expectedStatus: "NEW" }
      );

    expect((await claim()).outcome).toBe("updated");
    expect(await claim()).toMatchObject({
      outcome: "conflict",
      feedback: { status: "IN_PROGRESS" },
    });
    expect(
      (await updateFeedback(setup.db, "missing", { status: "NEW" }, { actorId: ADMIN.id }))
        .outcome
    ).toBe("not-found");
  });

  it("counts by status", async () => {
    const setup = await seeded();
    await updateFeedback(setup.db, "id-1", { status: "RESOLVED" }, { actorId: ADMIN.id });
    expect(await countFeedbackByStatus(setup.db)).toEqual({
      NEW: 2,
      IN_PROGRESS: 0,
      RESOLVED: 1,
      DECLINED: 0,
    });
  });

  it("resolves an attachment to its object and owner", async () => {
    const setup = await seeded();
    expect(await getFeedbackAttachmentObject(setup.db, "id-2")).toEqual({
      objectKey: "feedback/id-1/id-2.png",
      contentType: "image/png",
      ownerId: STUDENT.id,
    });
    expect(await getFeedbackAttachmentObject(setup.db, "")).toBeNull();
    expect(await getFeedbackAttachmentObject(setup.db, "nope")).toBeNull();
  });

  it("deletes a student's feedback with their account and keeps it when a handler leaves", async () => {
    const setup = await seeded();
    await updateFeedback(setup.db, "id-4", { status: "RESOLVED" }, { actorId: ADMIN.id });

    setup.database.exec(`DELETE FROM "user" WHERE "id" = '${ADMIN.id}'`);
    expect((await getFeedback(setup.db, "id-4"))?.handledBy).toBeNull();

    setup.database.exec(`DELETE FROM "user" WHERE "id" = '${STUDENT.id}'`);
    expect(await getFeedback(setup.db, "id-1")).toBeNull();
    const remaining = setup.database
      .prepare(`SELECT COUNT(*) AS "count" FROM "feedback_attachment"`)
      .get() as { count: number };
    expect(remaining.count).toBe(0);
  });

  it("splits large attachment lookups to stay under D1's parameter limit", async () => {
    const setup = createFeedbackTestDb();
    const insert = setup.database.prepare(
      `INSERT INTO "feedback" ("id", "userId", "kind", "message", "pageUrl", "createdAt")
       VALUES (?, ?, 'OTHER', 'n', 'https://x/', ?)`
    );
    for (let index = 0; index < 120; index += 1) insert.run(`bulk-${index}`, STUDENT.id, index);
    const prepare = vi.spyOn(setup.db, "prepare");
    const items = await listFeedback(setup.db, { statuses: ["NEW"], limit: 200 });
    expect(items).toHaveLength(120);
    const attachmentQueries = prepare.mock.calls.filter(([sql]) =>
      sql.includes(`FROM "feedback_attachment"`)
    );
    expect(attachmentQueries).toHaveLength(2);
  });
});

describe("dropped D1 connections", () => {
  const lost = () => new Error("D1_ERROR: Network connection lost.");

  /** Makes the first batch or UPDATE fail, optionally after it committed. */
  function dropOnce(
    db: D1Database,
    target: "batch" | "update",
    { afterCommit }: { afterCommit: boolean }
  ) {
    let dropped = false;
    const fail = async <T>(run: () => Promise<T>) => {
      if (dropped) return run();
      dropped = true;
      if (afterCommit) await run();
      throw lost();
    };
    const mutable = db as unknown as Record<string, unknown>;
    if (target === "batch") {
      const batch = db.batch.bind(db);
      mutable.batch = (statements: D1PreparedStatement[]) => fail(() => batch(statements));
      return;
    }
    const prepare = db.prepare.bind(db);
    mutable.prepare = (sql: string) => {
      const statement = prepare(sql);
      if (!sql.startsWith("UPDATE")) return statement;
      const bind = statement.bind.bind(statement);
      return Object.assign(statement, {
        bind: (...values: unknown[]) => {
          const bound = bind(...values);
          const run = bound.run.bind(bound);
          return Object.assign(bound, { run: () => fail(run) });
        },
      });
    };
  }

  for (const afterCommit of [false, true]) {
    it(`stores feedback once when the insert drops ${afterCommit ? "after" : "before"} committing`, async () => {
      const setup = createFeedbackTestDb();
      const bucket = createMemoryBucket();
      dropOnce(setup.db, "batch", { afterCommit });

      await submit(setup, bucket, form({ message: "hi" }, [imageFile(PNG_BYTES)]));

      expect(await countFeedbackByStatus(setup.db)).toMatchObject({ NEW: 1 });
      expect((await getFeedback(setup.db, "id-1"))?.attachments).toHaveLength(1);
      expect(bucket.delete).not.toHaveBeenCalled();
    });
  }

  it("reports a claim whose first attempt landed as claimed, not as taken", async () => {
    const setup = createFeedbackTestDb();
    await submit(setup, createMemoryBucket(), form({ message: "hi" }));
    dropOnce(setup.db, "update", { afterCommit: true });

    const result = await updateFeedback(
      setup.db,
      "id-1",
      { status: "IN_PROGRESS" },
      { actorId: ADMIN.id, expectedStatus: "NEW", now: NOW }
    );
    expect(result).toMatchObject({ outcome: "updated", feedback: { status: "IN_PROGRESS" } });

    // Someone else's claim is still a conflict.
    expect(
      (
        await updateFeedback(
          setup.db,
          "id-1",
          { status: "IN_PROGRESS" },
          { actorId: OTHER_STUDENT.id, expectedStatus: "NEW" }
        )
      ).outcome
    ).toBe("conflict");
  });
});
