import { readdirSync } from "node:fs";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

/*
 * /admin/recordings/upload on the style guide: its markup, and an upload against the real schema
 * in SQLite, with the video store and the processing queue mocked.
 */
type Env = { DB?: unknown; BUCKET?: { put: typeof put; delete: typeof remove }; RECORDING_QUEUE?: { send: typeof send } };
const mocks = vi.hoisted(() => ({ env: {} as Env }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));

const { default: Page } = await import("../recordings/upload.astro");

const PATH = "/admin/recordings/upload";
const put = vi.fn();
const remove = vi.fn();
const send = vi.fn();
const databases: { close(): void }[] = [];
let sqlite: ReturnType<typeof createSqliteD1>["database"];

beforeEach(() => {
  const { database, db } = createSqliteD1();
  databases.push(database);
  for (const file of readdirSync(new URL("../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId,startDate,endDate) VALUES ('cohort-07','Cohort 07','Test','curriculum',0,4102444800);`);
  sqlite = database;
  put.mockReset().mockResolvedValue({});
  remove.mockReset().mockResolvedValue(undefined);
  send.mockReset().mockResolvedValue(undefined);
  Object.assign(mocks.env, { DB: db, BUCKET: { put, delete: remove }, RECORDING_QUEUE: { send } });
});
afterEach(() => databases.splice(0).forEach((database) => database.close()));

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

const recordings = () => sqlite.prepare("SELECT id, title, programId, recordedAt, description, r2VideoKey, fileSizeBytes, processingStatus FROM recording").all() as Record<string, unknown>[];
const setCookies = (response: Response): string[] => {
  const cookies = Reflect.get(response, Symbol.for("astro.cookies")) as { consume(): Iterable<string> } | undefined;
  return [...response.headers.getSetCookie(), ...(cookies ? cookies.consume() : [])];
};
const VIDEO = () => new File([new Uint8Array(16)], "week-4.mp4", { type: "video/mp4" });
async function visit(fields?: Record<string, string | File>) {
  let body: FormData | undefined;
  if (fields) {
    body = new FormData();
    for (const [name, value] of Object.entries(fields)) body.set(name, value);
  }
  const response = await container.renderToResponse(Page, {
    request: new Request(`https://ttv.invalid${PATH}`, body ? { method: "POST", body } : undefined),
    locals: { user: { id: "synthetic-admin" }, isAdmin: true } as unknown as App.Locals,
  });
  return { response, status: response.status, location: response.headers.get("location"), body: await response.text() };
}
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;
const UPLOAD = { title: "Week 4: SQL joins", programId: "cohort-07", recordedAt: "2026-11-04", description: "Joins." };

describe("uploading a recording on the style guide", () => {
  it("is one form of kit fields with a kit file field and one primary", async () => {
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(body).toMatch(/<a href="\/admin\/recordings" data-back-link[^>]*>[\s\S]*?<span>Recordings<\/span><\/a>[\s\S]*?<h1 [^>]*>Upload recording<\/h1>/);
    expect(body).toMatch(/<form method="POST" action="\/admin\/recordings\/upload" enctype="multipart\/form-data"/);
    expect(body).toMatch(/<input (?=[^>]*name="video")(?=[^>]*type="file")(?=[^>]*accept="video\/\*")(?=[^>]*required="")[^>]*>/);
    expect(body).toMatch(/<option value="" selected="">No cohort<\/option><option value="cohort-07">Cohort 07<\/option>/);
    expect(count(body, /data-variant="primary"/g)).toBe(1);
    expect(body).toMatch(/data-variant="primary"[^>]*>Upload and process<\/button>/);
    expect(body).not.toMatch(/text-white|\btext-primary\b|bg-red-|form-control|file:bg-primary|Title \*|Recorded Date|Video File|Upload and Process|R2/);
  });

  it("stores the video, makes the recording, queues it and answers with a 303 and a flash on its page", async () => {
    const { status, location, response } = await visit({ ...UPLOAD, video: VIDEO() });
    expect(status).toBe(303);
    const [row] = recordings();
    expect(location).toBe(`/admin/recordings/${row.id}`);
    expect(row).toMatchObject({ title: "Week 4: SQL joins", programId: "cohort-07", recordedAt: Date.UTC(2026, 10, 4) / 1000, description: "Joins.", r2VideoKey: `recordings/${row.id}/source.mp4`, fileSizeBytes: 16, processingStatus: "queued" });
    expect(put).toHaveBeenCalledWith(`recordings/${row.id}/source.mp4`, expect.anything(), { httpMetadata: { contentType: "video/mp4" } });
    expect(send).toHaveBeenCalledWith({ type: "process_recording", recordingId: row.id });
    expect(decodeURIComponent(setCookies(response)[0])).toContain('"title":"Recording uploaded"');
  });

  it("refuses a bad form with a 400, keeping what was written, an error under each field and a focused danger Notice", async () => {
    const { status, body } = await visit({ title: " ", programId: "cohort-99", recordedAt: "2026-02-30", description: "Kept.", video: new File(["%PDF"], "notes.pdf", { type: "application/pdf" }) });
    expect(status).toBe(400);
    expect(body).toMatch(/data-title-prefix="Error: "/);
    expect(body).toMatch(/<div (?=[^>]*autofocus="")(?=[^>]*role="alert")[^>]*data-notice="danger"[\s\S]*?The recording wasn(?:&#39;|&#x27;|')t uploaded/);
    for (const error of ["Give the recording a title.", "Choose a cohort from the list, or no cohort.", "Write the date as a day, month and year.", "notes.pdf isn(?:&#39;|&#x27;|')t a video."]) {
      expect(body).toMatch(new RegExp(error));
    }
    expect(body).toContain("Kept.</textarea>");
    expect(body).toMatch(/<input (?=[^>]*name="recordedAt")[^>]*value="2026-02-30"/);
    expect(put).not.toHaveBeenCalled();
    expect(recordings()).toEqual([]);

    const noFile = await visit(UPLOAD);
    expect(noFile.status).toBe(400);
    expect(noFile.body).toContain("Choose the video file to upload.");
    expect(noFile.body).toMatch(/<input (?=[^>]*name="title")[^>]*value="Week 4: SQL joins"/);
  });

  it("answers 503 in words when the store or the database fails, leaving no file behind", async () => {
    put.mockRejectedValueOnce(new Error("R2 down"));
    const store = await visit({ ...UPLOAD, video: VIDEO() });
    expect(store.status).toBe(503);
    expect(store.body).toMatch(/The video store didn(?:&#39;|&#x27;|')t answer, so nothing was uploaded\./);
    expect(recordings()).toEqual([]);

    sqlite.exec("CREATE TRIGGER no_writes BEFORE INSERT ON recording BEGIN SELECT RAISE(ABORT, 'D1 down'); END;");
    const database = await visit({ ...UPLOAD, video: VIDEO() });
    expect(database.status).toBe(503);
    expect(database.body).toMatch(/The database didn(?:&#39;|&#x27;|')t answer, so no recording was made\./);
    expect(remove).toHaveBeenCalledWith(put.mock.calls[1][0]);
    expect(database.body).toMatch(/<input (?=[^>]*name="title")[^>]*value="Week 4: SQL joins"/);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps an upload the queue refused, waiting to be started from its page, and says so", async () => {
    send.mockRejectedValue(new Error("queue down"));
    const { status, location, response } = await visit({ ...UPLOAD, video: VIDEO() });
    const [row] = recordings();
    expect({ status, location }).toEqual({ status: 303, location: `/admin/recordings/${row.id}` });
    expect(row.processingStatus).toBe("pending");
    const flash = decodeURIComponent(setCookies(response)[0]);
    expect(flash).toContain('"tone":"warning"');
    expect(flash).toContain("Uploaded, but not queued");
  });
});
