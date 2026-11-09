import { readdirSync } from "node:fs";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

/*
 * /admin/recordings/import on the style guide: its markup, and each change against the real schema
 * in SQLite. The Drive scans (lib/recordings/importer.ts, tested there) and the stored credential
 * are mocked.
 */
const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  credentials: vi.fn(),
  preview: vi.fn(),
  sync: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));
vi.mock("@/lib/credentials/crypto", () => ({ createCredentialCipher: () => ({}) }));
vi.mock("@/lib/credentials/google-drive", () => ({ getGoogleDriveCredentials: mocks.credentials }));
vi.mock("@/lib/recordings/importer", async (actual) => ({
  ...(await actual<typeof import("@/lib/recordings/importer")>()),
  previewRecordingImportSource: mocks.preview,
  syncRecordingImportSource: mocks.sync,
}));

const { RecordingImportPreviewChangedError } = await import("@/lib/recordings/importer");
const { default: Page } = await import("../recordings/import.astro");

const PATH = "/admin/recordings/import";
const FOLDER = "1AbCdEfGhIjKlMnOp";
const databases: { close(): void }[] = [];
let sqlite: ReturnType<typeof createSqliteD1>["database"];

beforeEach(() => {
  const { database, db } = createSqliteD1();
  databases.push(database);
  for (const file of readdirSync(new URL("../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId,startDate,endDate) VALUES ('cohort-05','Cohort 05','Test','curriculum',0,4102444800);
    INSERT INTO recording_import_source(id,programId,name,driveFolderId,filenameContains,enabled,lastError) VALUES
      ('source','cohort-05','Cohort 05 sessions','${FOLDER}','Cohort 05',0,'Drive said the folder is not shared');`);
  sqlite = database;
  Object.assign(mocks.env, { DB: db, CREDENTIALS_ENCRYPTION_KEY: "synthetic-key" });
  mocks.credentials.mockReset().mockResolvedValue({ clientEmail: "importer@ttv-synthetic.iam.gserviceaccount.com", impersonatedUser: undefined });
  mocks.preview.mockReset().mockResolvedValue({ discovered: 12, importable: 9, new: 7, pending: 2, skipped: 3, driveItemsScanned: 40, visibleVideos: 14, downloadBlockedVideos: 2 });
  mocks.sync.mockReset().mockResolvedValue({ discovered: 12, created: 7, queued: 9, skipped: 3 });
});
afterEach(() => databases.splice(0).forEach((database) => database.close()));

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

const setCookies = (response: Response): string[] => {
  const cookies = Reflect.get(response, Symbol.for("astro.cookies")) as { consume(): Iterable<string> } | undefined;
  return [...response.headers.getSetCookie(), ...(cookies ? cookies.consume() : [])];
};
const flashOf = (response: Response) => decodeURIComponent(setCookies(response)[0] ?? "");
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };
async function visit({ query = "", form, locals = {} }: { query?: string; form?: Record<string, string>; locals?: Record<string, unknown> } = {}) {
  const response = await container.renderToResponse(Page, {
    request: new Request(`https://ttv.invalid${PATH}${query}`, form ? { method: "POST", body: new URLSearchParams(form), headers: FORM } : undefined),
    locals: { user: { id: "synthetic-admin" }, isAdmin: true, personalAccessToken: null, ...locals } as unknown as App.Locals,
  });
  return { response, status: response.status, location: response.headers.get("location"), body: await response.text() };
}
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;
const sources = () => sqlite.prepare("SELECT id, name, programId, driveFolderId, filenameContains, enabled FROM recording_import_source ORDER BY name").all() as Record<string, unknown>[];
const APOSTROPHE = "(?:&#39;|&#x27;|')";

describe("the import page on the style guide", () => {
  it("has one display title, the connection as facts, and the add form's save as its one primary", async () => {
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(body).toMatch(/<a href="\/admin\/recordings" data-back-link[^>]*>[\s\S]*?<h1 [^>]*>Import session recordings<\/h1>/);
    expect(body).toMatch(/<dt[^>]*>Share each folder, as a Viewer, with<\/dt><dd[^>]*><span class="break-all">importer@ttv-synthetic\.iam\.gserviceaccount\.com<\/span>/);
    expect(count(body, /data-variant="primary"/g)).toBe(1);
    expect(body).toMatch(/data-variant="primary"[^>]*>Save import source<\/button>/);
    expect(body).not.toMatch(/text-white|\btext-primary\b|bg-(red|emerald|amber|black)|text-(emerald|amber|red)-|form-control|uppercase|Import Session Recordings|Save Import Source|Source name \*/);
  });

  it("lists each source on hairlines with its state as a chip, its last error, and quiet actions named for it", async () => {
    const list = /data-sources>([\s\S]*?)<\/section>/.exec((await visit()).body)?.[1] ?? "";
    expect(list).toMatch(/<h3 class="[^"]*">Cohort 05 sessions<\/h3><span data-chip="neutral"[^>]*>[\s\S]*?Paused/);
    expect(list).toMatch(/<dt[^>]*>Filename contains<\/dt><dd[^>]*>Cohort 05<\/dd>/);
    expect(list).toMatch(/<dt[^>]*>Last scan<\/dt><dd[^>]*>Not yet<\/dd>/);
    expect(list).toMatch(/data-notice="danger"[\s\S]*?The last scan failed[\s\S]*?Drive said the folder is not shared/);
    expect(list).toMatch(/<input type="hidden" name="expectedEnabled" value="false"\/?><button [^>]*data-variant="quiet"[^>]*>Turn on<span class="sr-only"> Cohort 05 sessions<\/span><\/button>/);
    expect(list).toMatch(/<a href="\/admin\/recordings\/import\?confirm=remove-source" data-variant="quiet"[^>]*>Remove<span class="sr-only"> Cohort 05 sessions<\/span><\/a>/);
    expect(list).toMatch(/Review historical import<span class="sr-only"> for Cohort 05 sessions<\/span>/);
    expect(list).not.toMatch(/data-variant="(primary|danger)"|data-card/);
  });

  it("says Drive isn't connected, with the way to fix it, and offers no review", async () => {
    mocks.credentials.mockResolvedValue(null);
    const { body } = await visit();
    expect(body).toMatch(new RegExp(`data-testid="drive-not-configured"><div[^>]*data-notice="warning"[\\s\\S]*?Google Drive isn${APOSTROPHE}t connected yet[\\s\\S]*?<a href="/admin/settings/integrations"[^>]*>Integrations</a>`));
    expect(body).not.toContain("Review historical import");

    const refused = await visit({ form: { action: "preview", sourceId: "source" } });
    expect(refused.status).toBe(400);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
});

describe("adding a source", () => {
  it("saves it paused, with a 303 and a flash", async () => {
    const { status, location, response } = await visit({ form: { action: "create", name: "Cohort 05 extra", programId: "cohort-05", driveFolder: `https://drive.google.com/drive/folders/${FOLDER}`, filenameContains: "" } });
    expect({ status, location }).toEqual({ status: 303, location: PATH });
    expect(flashOf(response)).toContain('"title":"Import source saved, paused"');
    expect(sources()[1]).toMatchObject({ name: "Cohort 05 sessions" });
    expect(sources()[0]).toMatchObject({ name: "Cohort 05 extra", programId: "cohort-05", driveFolderId: FOLDER, filenameContains: null, enabled: 0 });
  });

  it("refuses a bad source with a 400 that keeps every value, an error under each field and a focused Notice in the form", async () => {
    const { status, body } = await visit({ form: { action: "create", name: "Kept name", programId: "", driveFolder: "not a folder", filenameContains: "Kept filter" } });
    expect(status).toBe(400);
    expect(body).toMatch(/data-title-prefix="Error: "/);
    const create = /data-create>([\s\S]*?)<\/form>/.exec(body)?.[1] ?? "";
    expect(create).toMatch(new RegExp(`autofocus=""[^>]*role="alert"[\\s\\S]*?The source wasn${APOSTROPHE}t saved`));
    expect(create).toContain("Choose the cohort its recordings belong to.");
    expect(create).toMatch(new RegExp(`That isn${APOSTROPHE}t a Drive folder${APOSTROPHE}s address or ID`));
    expect(create).toMatch(/<input (?=[^>]*name="name")[^>]*value="Kept name"/);
    expect(create).toMatch(/<input (?=[^>]*name="driveFolder")[^>]*value="not a folder"/);
    expect(create).toMatch(/<input (?=[^>]*name="filenameContains")[^>]*value="Kept filter"/);
    expect(sources()).toHaveLength(1);
  });
});

describe("reviewing and adding a historical import", () => {
  it("shows what the review found, with nothing added, and the add as the view's one primary", async () => {
    const { status, body } = await visit({ form: { action: "preview", sourceId: "source" } });
    expect(status).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith(mocks.env, "source");
    const review = /data-testid="historical-import-preview">([\s\S]*?)<\/section>/.exec(body)?.[1] ?? "";
    expect(review).toMatch(/<h2 [^>]*>Historical import: Cohort 05 sessions<\/h2>/);
    expect(review).toContain("Nothing has been added yet.");
    for (const [term, value] of [["Drive items scanned", "40"], ["Videos Google shows", "14"], ["Videos that can be imported", "12"], ["Download blocked by Drive", "2"], ["New videos", "7"], ["Waiting to retry", "2"], ["Already in TTV", "3"]]) {
      expect(review).toMatch(new RegExp(`<dt[^>]*>${term}</dt><dd[^>]*>${value}</dd>`));
    }
    expect(review).toMatch(new RegExp(`data-notice="warning"[\\s\\S]*?2 videos can${APOSTROPHE}t be downloaded`));
    expect(review).toMatch(/<input type="hidden" name="action" value="confirm"\/?><input type="hidden" name="sourceId" value="source"\/?><input type="hidden" name="expectedImportable" value="9"\/?><button [^>]*data-variant="primary"[^>]*>Add 9 to the queue<\/button>/);
    expect(review).toMatch(/If the count has changed, you(?:&#39;|&#x27;|')ll be asked to review it again\./);
    expect(count(body, /data-variant="primary"/g)).toBe(1);
    expect(body).toMatch(/data-variant="quiet"[^>]*>Save import source<\/button>/);
  });

  it("adds the reviewed count with a 303 and a flash, and refuses a count that changed or never was reviewed", async () => {
    const added = await visit({ form: { action: "confirm", sourceId: "source", expectedImportable: "9" } });
    expect({ status: added.status, location: added.location }).toEqual({ status: 303, location: PATH });
    expect(mocks.sync).toHaveBeenCalledWith(mocks.env, "source", { expectedImportable: 9 });
    expect(flashOf(added.response)).toContain("7 new, 9 queued to transcribe, 3 already in TTV.");

    mocks.sync.mockClear().mockRejectedValue(new RecordingImportPreviewChangedError(9, 11));
    const changed = await visit({ form: { action: "confirm", sourceId: "source", expectedImportable: "9" } });
    expect(changed.status).toBe(400);
    expect(changed.body).toContain("The folder changed after it was reviewed");

    mocks.sync.mockClear();
    const unreviewed = await visit({ form: { action: "confirm", sourceId: "source", expectedImportable: "lots" } });
    expect(unreviewed.status).toBe(400);
    expect(unreviewed.body).toContain("Review the historical import first");
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("answers 503 in words when Drive fails, and adds nothing", async () => {
    mocks.preview.mockRejectedValue(new Error("Google Drive returned 503."));
    const failed = await visit({ form: { action: "preview", sourceId: "source" } });
    expect(failed.status).toBe(503);
    expect(failed.body).toMatch(new RegExp(`role="alert"[^>]*data-notice="danger"[\\s\\S]*?The folder wasn${APOSTROPHE}t scanned[\\s\\S]*?Google Drive returned 503\\. Nothing was added\\.`));
    expect(failed.body).not.toContain("historical-import-preview");
  });
});

describe("pausing, turning on and removing a source", () => {
  it("turns it on from the state the page showed, with a 303 and a flash, and refuses a stale one", async () => {
    const on = await visit({ form: { action: "toggle", sourceId: "source", expectedEnabled: "false" } });
    expect(on.status).toBe(303);
    expect(flashOf(on.response)).toContain('"title":"Automatic scans on for Cohort 05 sessions"');
    expect(sources()[0].enabled).toBe(1);

    const stale = await visit({ form: { action: "toggle", sourceId: "source", expectedEnabled: "false" } });
    expect(stale.status).toBe(400);
    expect(stale.body).toContain("Someone changed this source while you were looking at it.");
    expect(sources()[0].enabled).toBe(1);
  });

  it("asks before removing, then removes with a 303 and a flash", async () => {
    const step = (await visit({ query: "?confirm=remove-source" })).body;
    expect(step).toMatch(/role="region" aria-label="Remove Cohort 05 sessions\?" data-notice="warning"/);
    expect(step).toContain("The recordings it already imported stay.");
    expect(step).toMatch(/<form method="post" action="\/admin\/recordings\/import"[^>]*><input type="hidden" name="action" value="remove"\/><input type="hidden" name="sourceId" value="source"\/><button [^>]*data-variant="danger"[^>]*>Remove source<\/button><a href="\/admin\/recordings\/import" data-variant="ghost"/);

    const removed = await visit({ form: { action: "remove", sourceId: "source" } });
    expect({ status: removed.status, location: removed.location }).toEqual({ status: 303, location: PATH });
    expect(flashOf(removed.response)).toContain('"title":"Cohort 05 sessions removed"');
    expect(sources()).toEqual([]);

    const gone = await visit({ form: { action: "remove", sourceId: "source" } });
    expect(gone.status).toBe(400);
    expect(gone.body).toContain("That source was removed, perhaps by another admin.");
  });

  it("answers 503 when the database fails, 400 for an unknown action, and 403 to a personal access token", async () => {
    sqlite.exec("CREATE TRIGGER no_writes BEFORE UPDATE ON recording_import_source BEGIN SELECT RAISE(ABORT, 'D1 down'); END;");
    const down = await visit({ form: { action: "toggle", sourceId: "source", expectedEnabled: "false" } });
    expect(down.status).toBe(503);
    expect(down.body).toMatch(new RegExp(`The database didn${APOSTROPHE}t answer, so nothing changed\\.`));

    expect((await visit({ form: { action: "sync", sourceId: "source" } })).status).toBe(400);

    const token = await visit({ form: { action: "confirm", sourceId: "source", expectedImportable: "9" }, locals: { personalAccessToken: { id: "pat" } } });
    expect(token.status).toBe(403);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
