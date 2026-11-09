import { readdirSync } from "node:fs";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

/*
 * /admin/recordings/[id] on the style guide: its markup, and each of its changes against the real
 * schema in SQLite, with the processing queue mocked. Opening it from the list is
 * e2e/platform-admin-space.spec.ts.
 */
const mocks = vi.hoisted(() => ({ env: {} as { DB?: unknown; RECORDING_QUEUE?: { send: (message: unknown) => Promise<unknown> } } }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));

const { default: Page } = await import("../recordings/[id].astro");

const PATH = "/admin/recordings/recording";
const send = vi.fn();
const databases: { close(): void }[] = [];
let sqlite: ReturnType<typeof createSqliteD1>["database"];

function seed(status = "complete", error: string | null = null, segments = 2) {
  const { database, db } = createSqliteD1();
  databases.push(database);
  for (const file of readdirSync(new URL("../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId,startDate,endDate) VALUES ('cohort-07','Cohort 07','Test','curriculum',0,4102444800);`);
  database.prepare(`INSERT INTO recording(id,programId,title,description,processingStatus,processingError,durationSeconds,recordedAt,r2VideoKey,transcriptText,transcriptVtt)
    VALUES ('recording','cohort-07','Week 4: SQL joins','Joins and indexes.',?,?,3725,1793750400,'videos/recording.mp4','Karibu. Joins next.','WEBVTT')`).run(status, error);
  for (let index = 1; index <= segments; index += 1) {
    database.prepare(`INSERT INTO transcript_segment(id,recordingId,startTime,endTime,speaker,text) VALUES (?,?,?,?,'Mentor','Karibu.')`).run(`segment-${index}`, "recording", index * 4, index * 4 + 4);
  }
  sqlite = database;
  mocks.env.DB = db;
}
const row = () => sqlite.prepare("SELECT title, programId, recordedAt, description, processingStatus, processingError, transcriptText, transcriptVtt FROM recording WHERE id = 'recording'").get() as Record<string, unknown>;

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
beforeEach(() => {
  send.mockReset().mockResolvedValue(undefined);
  mocks.env.RECORDING_QUEUE = { send };
  seed();
});
afterEach(() => databases.splice(0).forEach((database) => database.close()));

const setCookies = (response: Response): string[] => {
  const cookies = Reflect.get(response, Symbol.for("astro.cookies")) as { consume(): Iterable<string> } | undefined;
  return [...response.headers.getSetCookie(), ...(cookies ? cookies.consume() : [])];
};
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };
async function visit({ query = "", form }: { query?: string; form?: Record<string, string> } = {}) {
  const response = await container.renderToResponse(Page, {
    request: new Request(`https://ttv.invalid${PATH}${query}`, form ? { method: "POST", body: new URLSearchParams(form), headers: FORM } : undefined),
    params: { id: "recording" },
    locals: { user: { id: "synthetic-admin" }, isAdmin: true } as unknown as App.Locals,
  });
  return { response, status: response.status, location: response.headers.get("location"), body: await response.text() };
}
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;
const part = (body: string, name: string) => new RegExp(`data-${name}>([\\s\\S]*?)</(?:form|section)>`).exec(body)?.[1] ?? "";
const DETAILS = { action: "update", title: "Week 4: SQL joins", programId: "cohort-07", recordedAt: "2026-11-04", description: "Joins and indexes." };

describe("a recording on the style guide", () => {
  it("names the recording in the one display title, with its status as a shared chip and one primary", async () => {
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(body).toMatch(/<a href="\/admin\/recordings" data-back-link[^>]*>[\s\S]*?<span>Recordings<\/span><\/a>[\s\S]*?<h1 [^>]*>Week 4: SQL joins<\/h1>/);
    expect(body).toMatch(/data-chip="success"[^>]*><span[^>]*><span data-status="complete">Ready<\/span>/);
    expect(body).toContain("Cohort 07 · recorded 4 Nov 2026");
    expect(count(body, /data-variant="primary"/g)).toBe(1);
    expect(body).toMatch(/data-variant="primary"[^>]*>Save details<\/button>/);
    expect(body).toMatch(/<h2 id="details-heading" class="text-lg text-ink-primary">Recording details<\/h2>/);
    expect(body).toMatch(/<video src="\/api\/recordings\/recording\/video" controls preload="metadata" aria-labelledby="preview-heading" class="[^"]*bg-ground/);
    expect(body).not.toMatch(/text-white|\btext-primary\b|bg-black|bg-red-|form-control|data-badge|Recording Details|Save Details|Save Transcript|Title \*|Recorded Date/);
  });

  it("fills the kit fields from the recording, with the date on the day the page shows", async () => {
    const details = part((await visit()).body, "details");
    expect(details).toMatch(/<input[^>]*id="title"[^>]*name="title"[^>]*value="Week 4: SQL joins"/);
    expect(details).toMatch(/<option value="cohort-07" selected="">Cohort 07<\/option>/);
    expect(details).toMatch(/<option value="">No cohort<\/option>/);
    expect(details).toMatch(/<input id="recordedAt" name="recordedAt" type="date" [^>]*value="2026-11-04"/);
    expect(details).toContain("Joins and indexes.</textarea>");
    const transcript = part((await visit()).body, "transcript");
    expect(transcript).toContain("Karibu. Joins next.</textarea>");
    expect(transcript).toMatch(/data-variant="quiet"[^>]*>Save transcript<\/button>/);
  });

  it("lists processing as facts, with quiet actions and a confirm step before transcribing again", async () => {
    seed("failed", "Transcription timed out");
    const processing = part((await visit()).body, "processing");
    expect(processing).toMatch(/<dt[^>]*>Length<\/dt><dd[^>]*>1:02:05<\/dd>/);
    expect(processing).toMatch(/<dt[^>]*>Transcript segments<\/dt><dd[^>]*>2<\/dd>/);
    expect(processing).toMatch(/data-notice="danger"[\s\S]*?Processing failed[\s\S]*?Transcription timed out/);
    expect(processing).toMatch(/<a href="\/admin\/recordings\/recording\?confirm=reprocess" data-variant="quiet"[^>]*>Transcribe again<\/a>/);
    expect(processing).toMatch(/<input type="hidden" name="action" value="reindex"\/?><button (?=[^>]*data-variant="quiet")(?=[^>]*aria-describedby="reindex-hint")[^>]*>Rebuild search index<\/button>/);
    expect(processing).not.toMatch(/action="\/api\/|#/);

    const step = part((await visit({ query: "?confirm=reprocess" })).body, "processing");
    expect(step).toMatch(/role="region" aria-label="Transcribe Week 4: SQL joins again\?" data-notice="warning"/);
    expect(step).toContain("including any edits saved below");
    expect(step).toMatch(/<form method="post" action="\/admin\/recordings\/recording"[^>]*><input type="hidden" name="action" value="reprocess"\/><input type="hidden" name="expectedStatus" value="failed"\/><button [^>]*data-variant="danger"[^>]*>Transcribe again<\/button><a href="\/admin\/recordings\/recording" data-variant="ghost"[^>]*>Cancel<\/a>/);
  });

  it("says a job in progress starts over, and offers no index to rebuild without segments", async () => {
    seed("transcribing", null, 0);
    const step = part((await visit({ query: "?confirm=reprocess" })).body, "processing");
    expect(step).toMatch(/It(?:&#39;|&#x27;|')s transcribing now, and this starts over from the video\./);
    expect(part((await visit()).body, "processing")).not.toContain("Rebuild search index");
  });
});

describe("changing a recording", () => {
  it("saves the details with a 303 and a flash", async () => {
    const { status, location, response } = await visit({ form: { ...DETAILS, title: "  Week 4: joins  ", programId: "", recordedAt: "2026-11-05", description: "" } });
    expect(status).toBe(303);
    expect(location).toBe(PATH);
    expect(decodeURIComponent(setCookies(response)[0])).toContain('"title":"Details saved"');
    expect(row()).toMatchObject({ title: "Week 4: joins", programId: null, recordedAt: Date.UTC(2026, 10, 5) / 1000, description: null });
  });

  it("refuses bad details with a 400, keeping every value, an error under each field and a focused danger Notice", async () => {
    const { status, body } = await visit({ form: { ...DETAILS, title: " ", programId: "cohort-99", recordedAt: "2026-02-30", description: "Kept." } });
    expect(status).toBe(400);
    expect(body).toMatch(/data-title-prefix="Error: "/);
    const details = part(body, "details");
    expect(details).toMatch(/<div (?=[^>]*autofocus="")(?=[^>]*role="alert")[^>]*data-notice="danger"[\s\S]*?The details weren(?:&#39;|&#x27;|')t saved/);
    expect(details).toContain("Give the recording a title.");
    expect(details).toContain("Choose a cohort from the list, or no cohort.");
    expect(details).toContain("Write the date as a day, month and year.");
    expect(details).toMatch(/<input (?=[^>]*name="recordedAt")(?=[^>]*aria-invalid="true")[^>]*value="2026-02-30"/);
    expect(details).toContain("Kept.</textarea>");
    expect(row().title).toBe("Week 4: SQL joins");
  });

  it("saves the transcript, and refuses captions that aren't WebVTT with a 400 that keeps them", async () => {
    const saved = await visit({ form: { action: "save-transcript", transcriptText: "Edited.", transcriptVtt: "" } });
    expect(saved.status).toBe(303);
    expect(decodeURIComponent(setCookies(saved.response)[0])).toContain('"title":"Transcript saved"');
    expect(row()).toMatchObject({ transcriptText: "Edited.", transcriptVtt: "" });

    const refused = await visit({ form: { action: "save-transcript", transcriptText: "Kept text.", transcriptVtt: "1\n00:00:00,000 --> 00:00:04,000" } });
    expect(refused.status).toBe(400);
    const transcript = part(refused.body, "transcript");
    expect(transcript).toMatch(/autofocus=""[^>]*role="alert"[\s\S]*?The transcript wasn(?:&#39;|&#x27;|')t saved/);
    expect(transcript).toContain("Captions in WebVTT start with the line WEBVTT.");
    expect(transcript).toContain("Kept text.</textarea>");
    expect(row().transcriptText).toBe("Edited.");
  });

  it("queues a transcription from the status the page showed, and refuses a stale one before any write", async () => {
    seed("failed", "Transcription timed out");
    const stale = await visit({ form: { action: "reprocess", expectedStatus: "complete" } });
    expect(stale.status).toBe(400);
    expect(part(stale.body, "processing")).toContain("Someone changed this recording");
    expect(send).not.toHaveBeenCalled();
    expect(row().processingStatus).toBe("failed");

    const queued = await visit({ form: { action: "reprocess", expectedStatus: "failed" } });
    expect(queued.status).toBe(303);
    expect(queued.location).toBe(PATH);
    expect(decodeURIComponent(setCookies(queued.response)[0])).toContain('"title":"Queued to transcribe again"');
    expect(send).toHaveBeenCalledWith({ type: "process_recording", recordingId: "recording" });
    expect(row()).toMatchObject({ processingStatus: "queued", processingError: null });
  });

  it("queues a rebuild of the search entries, and refuses one with no segments", async () => {
    const queued = await visit({ form: { action: "reindex" } });
    expect(queued.status).toBe(303);
    expect(send).toHaveBeenCalledWith({ type: "reindex_recording", recordingId: "recording" });

    seed("complete", null, 0);
    send.mockClear();
    const refused = await visit({ form: { action: "reindex" } });
    expect(refused.status).toBe(400);
    expect(part(refused.body, "processing")).toContain("this recording has none");
    expect(send).not.toHaveBeenCalled();
  });

  it("answers 503 in words when the database or the queue is down, and 400 for an unknown action", async () => {
    send.mockRejectedValue(new Error("queue down"));
    const queue = await visit({ form: { action: "reprocess", expectedStatus: "complete" } });
    expect(queue.status).toBe(503);
    expect(part(queue.body, "processing")).toMatch(/The database or the processing queue didn(?:&#39;|&#x27;|')t answer, so nothing changed\./);
    expect(row().processingStatus).toBe("complete");

    sqlite.exec("CREATE TRIGGER no_writes BEFORE UPDATE ON recording BEGIN SELECT RAISE(ABORT, 'D1 down'); END;");
    const down = await visit({ form: DETAILS });
    expect(down.status).toBe(503);
    expect(part(down.body, "details")).toMatch(/The database didn(?:&#39;|&#x27;|')t answer, so nothing changed\./);

    const unknown = await visit({ form: { action: "delete" } });
    expect(unknown.status).toBe(400);
    expect(unknown.body).toContain("Choose one of the actions on this page.");
  });

  it("goes back to the list with a 303 when the recording is gone", async () => {
    sqlite.exec("DELETE FROM recording");
    const { status, location } = await visit({ form: DETAILS });
    expect({ status, location }).toEqual({ status: 303, location: "/admin/recordings" });
  });
});
