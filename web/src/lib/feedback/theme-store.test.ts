import { describe, expect, it } from "vitest";
import { ADMIN, OTHER_STUDENT, STUDENT, createFeedbackTestDb } from "@/test/feedback-db";
import { getFeedback, listFeedback, listFeedbackForUser, updateFeedback } from "./store";
import { createTheme, getTheme, listThemeNoteIds, listThemes, updateTheme } from "./theme-store";

const NOW = new Date("2026-10-21T12:00:00.000Z");
const DAY = 24 * 60 * 60;
const nowSeconds = Math.floor(NOW.getTime() / 1_000);

function setup() {
  const test = createFeedbackTestDb();
  const insert = test.database.prepare(
    `INSERT INTO "feedback" ("id", "userId", "kind", "message", "pageUrl", "createdAt", "updatedAt")
     VALUES (?, ?, 'IDEA', ?, 'https://tembotechventures.com/dashboard', ?, ?)`
  );
  const note = (id: string, userId: string, ageDays = 0) => {
    const at = nowSeconds - ageDays * DAY;
    insert.run(id, userId, `note ${id}`, at, at);
  };
  let next = 0;
  const newId = () => `theme-${(next += 1)}`;
  const attach = (noteId: string, themeId: string | null) =>
    updateFeedback(test.db, noteId, { themeId }, { actorId: ADMIN.id, now: NOW });
  return { ...test, note, newId, attach };
}

describe("theme stats", () => {
  it("counts each student once, inside and outside the agreement window", async () => {
    const t = setup();
    const theme = await createTheme(
      t.db,
      { title: "Show watched sessions", summary: "", kind: "IDEA" },
      { now: NOW, newId: t.newId }
    );
    t.note("a", STUDENT.id, 1);
    t.note("b", STUDENT.id, 2);
    t.note("c", OTHER_STUDENT.id, 70);
    for (const id of ["a", "b", "c"]) await t.attach(id, theme.id);

    expect((await getTheme(t.db, theme.id, NOW))?.stats).toEqual({
      notes: 3,
      students: 2,
      recentStudents: 1,
      lastReportAt: new Date((nowSeconds - DAY) * 1_000),
    });
    expect(await listThemeNoteIds(t.db, theme.id)).toEqual(["c", "b", "a"]);
  });

  it("lists themes with the most recent agreement first", async () => {
    const t = setup();
    const quiet = await createTheme(t.db, { title: "Quiet", summary: "", kind: "IDEA" }, { now: NOW, newId: t.newId });
    const busy = await createTheme(t.db, { title: "Busy", summary: "", kind: "IDEA" }, { now: NOW, newId: t.newId });
    t.note("a", STUDENT.id);
    t.note("b", OTHER_STUDENT.id);
    t.note("c", ADMIN.id, 100);
    await t.attach("a", busy.id);
    await t.attach("b", busy.id);
    await t.attach("c", quiet.id);

    const themes = await listThemes(t.db, { statuses: ["COLLECTING"], now: NOW });
    expect(themes.map((theme) => theme.title)).toEqual(["Busy", "Quiet"]);
    expect(await listThemes(t.db, { statuses: [] })).toEqual([]);
  });
});

describe("theme membership", () => {
  it("shows students their theme, and how many others raised it", async () => {
    const t = setup();
    const theme = await createTheme(t.db, { title: "Dark mode", summary: "", kind: "IDEA" }, { now: NOW, newId: t.newId });
    t.note("a", STUDENT.id);
    t.note("b", OTHER_STUDENT.id);
    await t.attach("a", theme.id);
    await t.attach("b", theme.id);

    const [mine] = await listFeedbackForUser(t.db, STUDENT.id);
    expect(mine.theme).toEqual({
      id: theme.id,
      title: "Dark mode",
      status: "COLLECTING",
      issueUrl: null,
      students: 2,
    });
    // Attaching sorts a note without promising work on it.
    expect(mine.status).toBe("NEW");
  });

  it("separates untriaged notes from sorted and sensitive ones", async () => {
    const t = setup();
    const theme = await createTheme(t.db, { title: "T", summary: "", kind: "IDEA" }, { now: NOW, newId: t.newId });
    t.note("themed", STUDENT.id);
    t.note("sensitive", STUDENT.id);
    t.note("fresh", STUDENT.id);
    await t.attach("themed", theme.id);
    await updateFeedback(t.db, "sensitive", { sensitive: true }, { actorId: ADMIN.id });

    const untriaged = await listFeedback(t.db, { statuses: ["NEW"], untriaged: true });
    expect(untriaged.map((note) => note.id)).toEqual(["fresh"]);
    const onTheme = await listFeedback(t.db, { statuses: ["NEW"], themeId: theme.id });
    expect(onTheme.map((note) => note.id)).toEqual(["themed"]);
  });

  it("keeps sensitive notes off themes and out of theme counts", async () => {
    const t = setup();
    const theme = await createTheme(t.db, { title: "T", summary: "", kind: "IDEA" }, { now: NOW, newId: t.newId });
    t.note("a", STUDENT.id);
    await t.attach("a", theme.id);

    // Marking sensitive takes it off the theme in the same write.
    await updateFeedback(t.db, "a", { sensitive: true }, { actorId: ADMIN.id });
    expect(await getFeedback(t.db, "a")).toMatchObject({ sensitive: true, theme: null });
    expect((await getTheme(t.db, theme.id))?.stats.notes).toBe(0);

    expect(await t.attach("a", theme.id)).toEqual({
      outcome: "invalid",
      message: "A sensitive note cannot be attached to a theme.",
    });
    expect(
      await updateFeedback(t.db, "a", { themeId: theme.id, sensitive: true }, { actorId: ADMIN.id })
    ).toMatchObject({ outcome: "invalid" });
    // Clearing the flag and attaching in one update is allowed.
    expect(
      (await updateFeedback(t.db, "a", { themeId: theme.id, sensitive: false }, { actorId: ADMIN.id }))
        .outcome
    ).toBe("updated");
  });

  it("rejects unknown themes and allows detaching", async () => {
    const t = setup();
    t.note("a", STUDENT.id);
    expect(await t.attach("a", "missing")).toEqual({
      outcome: "invalid",
      message: "That theme does not exist.",
    });
    expect((await t.attach("a", null)).outcome).toBe("updated");
  });

  it("detaches notes if a theme row is ever deleted", async () => {
    const t = setup();
    const theme = await createTheme(t.db, { title: "T", summary: "", kind: "IDEA" }, { now: NOW, newId: t.newId });
    t.note("a", STUDENT.id);
    await t.attach("a", theme.id);
    t.database.exec(`DELETE FROM "feedback_theme" WHERE "id" = '${theme.id}'`);
    expect((await getFeedback(t.db, "a"))?.theme).toBeNull();
  });
});

describe("updateTheme", () => {
  async function themed() {
    const t = setup();
    const theme = await createTheme(
      t.db,
      { title: "Sessions page shows what I watched", summary: "", kind: "IDEA", change: "ADD" },
      { now: NOW, newId: t.newId }
    );
    t.note("open-1", STUDENT.id);
    t.note("open-2", OTHER_STUDENT.id);
    t.note("answered", STUDENT.id);
    t.note("private", OTHER_STUDENT.id);
    for (const id of ["open-1", "open-2", "answered", "private"]) await t.attach(id, theme.id);
    await updateFeedback(
      t.db,
      "answered",
      { status: "RESOLVED", response: "Answered by hand" },
      { actorId: ADMIN.id, now: NOW }
    );
    // A note marked sensitive after attaching is detached, so it can never be
    // swept up by the theme.
    await updateFeedback(t.db, "private", { sensitive: true }, { actorId: ADMIN.id });
    return { t, theme };
  }

  it("moves through planning without touching the notes", async () => {
    const { t, theme } = await themed();
    const planned = await updateTheme(
      t.db,
      theme.id,
      { status: "PLANNED", issueUrl: "https://github.com/o/r/issues/1" },
      { actorId: ADMIN.id, now: NOW }
    );
    expect(planned).toMatchObject({ status: "PLANNED", closedAt: null });
    expect((await getFeedback(t.db, "open-1"))?.status).toBe("NEW");
    expect((await getFeedback(t.db, "open-1"))?.theme?.issueUrl).toBe("https://github.com/o/r/issues/1");
  });

  it("answers every open note when it ships, and leaves the rest alone", async () => {
    const { t, theme } = await themed();
    const later = new Date(NOW.getTime() + 60_000);
    await updateTheme(
      t.db,
      theme.id,
      { status: "IN_PROGRESS", issueUrl: "https://github.com/o/r/issues/1" },
      { actorId: ADMIN.id, now: NOW }
    );
    const shipped = await updateTheme(
      t.db,
      theme.id,
      { status: "SHIPPED", prUrl: "https://github.com/o/r/pull/2" },
      { actorId: ADMIN.id, studentMessage: "Sessions now show a tick once watched.", now: later }
    );

    expect(shipped).toMatchObject({ status: "SHIPPED", closedAt: later });
    for (const id of ["open-1", "open-2"]) {
      expect(await getFeedback(t.db, id)).toMatchObject({
        status: "RESOLVED",
        response: "Sessions now show a tick once watched.",
        resolutionUrl: "https://github.com/o/r/pull/2",
        resolvedAt: later,
        handledBy: { id: ADMIN.id },
      });
    }
    expect(await getFeedback(t.db, "answered")).toMatchObject({
      status: "RESOLVED",
      response: "Answered by hand",
    });
    expect(await getFeedback(t.db, "private")).toMatchObject({ status: "NEW", response: null });
  });

  it("answers open notes when declined, linking the issue if there is no PR", async () => {
    const { t, theme } = await themed();
    await updateTheme(
      t.db,
      theme.id,
      { status: "DECLINED", issueUrl: "https://github.com/o/r/issues/1" },
      { actorId: ADMIN.id, studentMessage: "Not now: it adds a page we would have to maintain." }
    );
    expect(await getFeedback(t.db, "open-1")).toMatchObject({
      status: "DECLINED",
      resolutionUrl: "https://github.com/o/r/issues/1",
      response: "Not now: it adds a page we would have to maintain.",
    });
  });

  it("does not re-answer notes when a closed theme is edited, and reopening clears closedAt", async () => {
    const { t, theme } = await themed();
    await updateTheme(t.db, theme.id, { status: "SHIPPED" }, { actorId: ADMIN.id, studentMessage: "First" });
    await updateTheme(t.db, theme.id, { status: "DECLINED" }, { actorId: ADMIN.id, studentMessage: "Second" });
    expect((await getFeedback(t.db, "open-1"))?.response).toBe("First");

    const reopened = await updateTheme(t.db, theme.id, { status: "COLLECTING" }, { actorId: ADMIN.id });
    expect(reopened).toMatchObject({ status: "COLLECTING", closedAt: null });
  });

  it("returns null for an unknown theme", async () => {
    const t = setup();
    expect(await updateTheme(t.db, "missing", { status: "PLANNED" }, { actorId: ADMIN.id })).toBeNull();
    expect(await getTheme(t.db, "")).toBeNull();
  });

  it("enforces the vocabulary in the database too", async () => {
    const t = setup();
    expect(() =>
      t.database.exec(
        `INSERT INTO "feedback_theme" ("id", "title", "kind", "status") VALUES ('x', 't', 'IDEA', 'DONE')`
      )
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      t.database.exec(`INSERT INTO "feedback_theme" ("id", "title", "kind") VALUES ('y', '', 'IDEA')`)
    ).toThrow(/CHECK constraint failed/);
  });
});
