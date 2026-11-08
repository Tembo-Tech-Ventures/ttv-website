import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * /admin/settings/integrations on the style guide: the page's markup with and
 * without a credential, every change a 303 with a flash, refusals kept on the
 * page, and removal behind a confirm step, with the credential store mocked.
 * Its read runs on the real schema in integrations.test.ts.
 */
const store = vi.hoisted(() => ({
  env: { DB: "synthetic-d1", CREDENTIALS_ENCRYPTION_KEY: "synthetic-key" } as Record<string, string | undefined>,
  read: vi.fn(),
  save: vi.fn(),
  credentials: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  recordTest: vi.fn(),
  test: vi.fn(),
  sources: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: store.env }));
vi.mock("drizzle-orm/d1", () => ({ drizzle: () => ({ query: { recordingImportSource: { findMany: store.sources } } }) }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));
vi.mock("@/lib/credentials/crypto", () => ({ createCredentialCipher: () => ({}) }));
vi.mock("@/lib/recordings/google-drive", () => ({ testGoogleDriveConnection: store.test }));
vi.mock("@/lib/admin/integrations", async (actual) => ({ ...(await actual<typeof import("@/lib/admin/integrations")>()), readIntegrationsPage: store.read }));
vi.mock("@/lib/credentials/google-drive", async (actual) => ({
  ...(await actual<typeof import("@/lib/credentials/google-drive")>()),
  saveGoogleDriveCredential: store.save,
  getGoogleDriveCredentials: store.credentials,
}));
vi.mock("@/lib/credentials/store", async (actual) => ({
  ...(await actual<typeof import("@/lib/credentials/store")>()),
  updateIntegrationCredentialConfig: store.update,
  deleteIntegrationCredential: store.remove,
  recordCredentialTest: store.recordTest,
}));

const { ServiceAccountInputError } = await import("@/lib/credentials/google-drive");
const { MissingCredentialError } = await import("@/lib/credentials/store");
const { default: Page } = await import("../settings/integrations.astro");

const PATH = "/admin/settings/integrations";
const AT = new Date(Date.UTC(2026, 9, 6, 11, 5));
const CONFIGURED = {
  credential: {
    facts: { clientEmail: "importer@ttv.iam.gserviceaccount.com", projectId: "ttv-recordings", privateKeyIdFingerprint: "0a1b2c3d" },
    impersonatedUser: "sessions@ttv.example",
    updatedAt: AT,
    updatedByName: "Amina Hassan",
  },
  activity: [
    { id: "audit-2", action: "test", outcome: "Pass: API: ok", by: "Brian Otieno", createdAt: AT },
    { id: "audit-1", action: "set", outcome: "Credential saved.", by: "Amina Hassan", createdAt: AT },
  ],
};

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
beforeEach(() => {
  store.env.CREDENTIALS_ENCRYPTION_KEY = "synthetic-key";
  store.read.mockReset().mockResolvedValue(CONFIGURED);
  for (const mock of [store.save, store.update, store.remove, store.recordTest]) mock.mockReset().mockResolvedValue(undefined);
  store.credentials.mockReset().mockResolvedValue({ clientEmail: "importer@ttv.iam.gserviceaccount.com", privateKey: "key" });
  store.sources.mockReset().mockResolvedValue([{ driveFolderId: "folder-1" }]);
  store.test.mockReset().mockResolvedValue([{ folderId: "", ok: true }, { folderId: "folder-1", ok: true }]);
});

const setCookies = (response: Response): string[] => {
  const cookies = Reflect.get(response, Symbol.for("astro.cookies")) as { consume(): Iterable<string> } | undefined;
  return [...response.headers.getSetCookie(), ...(cookies ? cookies.consume() : [])];
};
async function visit({ query = "", form }: { query?: string; form?: Record<string, string> } = {}) {
  const init = form ? { method: "POST", body: new URLSearchParams(form), headers: { "Content-Type": "application/x-www-form-urlencoded" } } : {};
  const response = await container.renderToResponse(Page, {
    request: new Request(`https://ttv.invalid${PATH}${query}`, init),
    locals: { user: { id: "synthetic-admin" }, isAdmin: true } as unknown as App.Locals,
  });
  const flash = setCookies(response).join("\n");
  return { response, status: response.status, location: response.headers.get("location"), flash: decodeURIComponent(flash), body: await response.text() };
}
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;
const JSON_KEY = '{"type":"service_account","client_email":"importer@ttv.iam.gserviceaccount.com","private_key":"key"}';

describe("integrations on the style guide", () => {
  it("with a credential: one title, its facts in a kit list, quiet actions, a danger link to remove, and recent activity in a kit table", async () => {
    const { status, body, response } = await visit();
    expect(status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(body).toMatch(/<dl data-description-list[\s\S]*?importer@ttv\.iam\.gserviceaccount\.com[\s\S]*?ttv-recordings[\s\S]*?0a1b2c3d[\s\S]*?sessions@ttv\.example[\s\S]*?6 Oct 2026, 14:05[\s\S]*?by Amina Hassan/);
    expect(body).toMatch(/<summary class="[^"]*border-hairline[^"]*">Replace credential<\/summary>/);
    expect(body).toMatch(/<summary class="[^"]*">Change impersonated user<\/summary>/);
    expect(body).toMatch(/<button [^>]*data-variant="quiet"[^>]*>Test connection<\/button>/);
    expect(body).toMatch(/<a href="\/admin\/settings\/integrations\?confirm=remove" data-variant="danger"[^>]*>Remove credential<\/a>/);
    // The one primary is inside the closed "Replace credential" disclosure.
    expect(count(body, /data-variant="primary"/g)).toBe(1);
    expect(body).toMatch(/<th[^>]*>What happened<\/th>[\s\S]*?<th[^>]*>Result<\/th>[\s\S]*?<th[^>]*>By<\/th>[\s\S]*?<th[^>]*>When<\/th>/);
    expect(body).toMatch(/data-chip="neutral"[^>]*>[\s\S]*?Tested/);
    expect(body).toContain(">Brian Otieno<");
    expect(body).not.toMatch(/form-control|text-white|amber-|emerald-|red-\d|bg-black|\btext-primary\b|bg-teal|border-teal|shadow-lg|uppercase|confirm\(|—/);
  });

  it("without a credential: the help open, a form of kit fields with one primary to save, and no activity", async () => {
    store.read.mockResolvedValue({ credential: null, activity: [] });
    const { body } = await visit();
    expect(body).toMatch(/<details open[^>]*><summary[^>]*>Where to get this credential<\/summary>/);
    expect(body).toMatch(/<label for="serviceAccountJson"[^>]*>Service account JSON<\/label>/);
    expect(body).toMatch(/<label for="impersonatedUser"[^>]*>Impersonated user[\s\S]*?optional/);
    expect(count(body, /data-variant="primary"/g)).toBe(1);
    expect(body).toMatch(/<button [^>]*data-variant="primary"[^>]*>Save credential<\/button>/);
    expect(body).not.toContain("Recent activity");
    expect(body).not.toContain("confirm=remove");
  });

  it("answers every change with a 303 back here and a flash", async () => {
    const saved = await visit({ form: { action: "save", serviceAccountJson: JSON_KEY, impersonatedUser: "" } });
    expect(store.save).toHaveBeenCalledWith(expect.anything(), expect.anything(), { serviceAccountJson: JSON_KEY, impersonatedUser: undefined, actorUserId: "synthetic-admin" });
    expect([saved.status, saved.location]).toEqual([303, PATH]);
    expect(saved.flash).toContain("Google Drive credential saved");

    expect((await visit({ form: { action: "replace", serviceAccountJson: JSON_KEY } })).flash).toContain("Google Drive credential replaced");

    const changed = await visit({ form: { action: "update-config", impersonatedUser: " ops@ttv.example " } });
    expect(store.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ config: '{"impersonatedUser":"ops@ttv.example"}' }));
    expect(changed.status).toBe(303);
    expect(changed.flash).toContain("Impersonated user changed");
    expect((await visit({ form: { action: "update-config", impersonatedUser: "" } })).flash).toContain("Impersonated user cleared");

    const removed = await visit({ form: { action: "remove" } });
    expect(store.remove).toHaveBeenCalled();
    expect([removed.status, removed.flash.includes("Google Drive credential removed")]).toEqual([303, true]);
  });

  it("tests the connection and says the result in the flash, recording it either way", async () => {
    const passed = await visit({ form: { action: "test" } });
    expect(store.test).toHaveBeenCalledWith({ credentials: expect.anything(), folderIds: ["folder-1"] });
    expect(store.recordTest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ok: true, detail: "API: ok; folder-1: ok" }));
    expect([passed.status, passed.flash.includes("Connection test passed")]).toEqual([303, true]);

    store.test.mockResolvedValue([{ folderId: "folder-1", ok: false, errorCode: "not_found" }]);
    const failed = await visit({ form: { action: "test" } });
    expect(failed.flash).toMatch(/"tone":"warning"[\s\S]*Connection test failed[\s\S]*folder-1: not_found/);

    store.credentials.mockResolvedValue(null);
    expect((await visit({ form: { action: "test" } })).flash).toContain("There's no credential to test");

    store.credentials.mockRejectedValue(new Error("D1_ERROR"));
    const down = await visit({ form: { action: "test" } });
    expect(down.status).toBe(503);
    expect(down.body).toContain("so nothing was recorded");
  });

  it("refuses a bad paste 400 under its field, opens the form it came from, keeps the user typed, and never echoes the secret", async () => {
    store.save.mockRejectedValue(new ServiceAccountInputError('Invalid service account: "type" must be "service_account".'));
    const { status, body } = await visit({ form: { action: "replace", serviceAccountJson: '{"type":"user","private_key":"SECRET-KEY"}', impersonatedUser: "ops@ttv.example" } });
    expect(status).toBe(400);
    expect(body).toMatch(/<div autofocus="" tabindex="-1"[^>]*data-notice="danger"/);
    expect(body).toMatch(/<details open[^>]*><summary[^>]*>Replace credential<\/summary>/);
    expect(body).toMatch(/<textarea [^>]*aria-invalid="true"/);
    expect(body).toContain("must be &quot;service_account&quot;. Paste the whole key file again.");
    expect(body).toMatch(/id="replace-impersonated-user"[^>]*value="ops@ttv\.example"/);
    expect(body).not.toContain("SECRET-KEY");

    store.read.mockResolvedValue({ credential: null, activity: [] });
    const empty = await visit({ form: { action: "save", serviceAccountJson: "  " } });
    expect(empty.status).toBe(400);
    expect(empty.body).toContain("Paste the service account");
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it("answers a database failure 503, never the error page, and a change to a credential removed meanwhile with a flash", async () => {
    store.save.mockRejectedValue(new Error("D1_ERROR: database is locked"));
    const down = await visit({ form: { action: "save", serviceAccountJson: JSON_KEY } });
    expect(down.status).toBe(503);
    expect(down.body).not.toContain("D1_ERROR");

    store.update.mockRejectedValue(new MissingCredentialError("google-drive"));
    const gone = await visit({ form: { action: "update-config", impersonatedUser: "ops@ttv.example" } });
    expect(gone.status).toBe(303);
    expect(gone.flash).toContain("There's no credential to change");

    store.remove.mockRejectedValue(new Error("D1_ERROR"));
    expect((await visit({ form: { action: "remove" } })).status).toBe(503);
    expect((await visit({ form: { action: "unknown" } })).status).toBe(400);
  });

  it("asks at ?confirm=remove: a focused warning saying what stops, a danger button posting the removal, and Cancel back", async () => {
    const { body } = await visit({ query: "?confirm=remove" });
    const step = /<div data-confirm-step[\s\S]*?<\/form><\/div>/.exec(body)?.[0] ?? "";
    expect(step).toMatch(/aria-label="Remove the Google Drive credential\?" data-notice="warning"/);
    expect(step).toContain("recording imports from Google Drive stop");
    expect(step).toMatch(/<form method="post" action="\/admin\/settings\/integrations"[^>]*><input type="hidden" name="action" value="remove"\/>/);
    expect(step).toMatch(/<button [^>]*data-variant="danger"[^>]*>Remove credential<\/button>/);
    expect(step).toMatch(/<a href="\/admin\/settings\/integrations" data-variant="ghost"[^>]*>Cancel<\/a>/);
    expect(body).not.toContain("Replace credential");

    store.read.mockResolvedValue({ credential: null, activity: [] });
    expect((await visit({ query: "?confirm=remove" })).body).not.toContain("data-confirm-step");
  });

  it("without the encryption key: a warning, no forms, and a change refused 403", async () => {
    store.env.CREDENTIALS_ENCRYPTION_KEY = undefined;
    const { body } = await visit();
    expect(body).toMatch(/data-notice="warning"[\s\S]*?Credential storage isn(?:'|&#39;|&#x27;)t set up here[\s\S]*?CREDENTIALS_ENCRYPTION_KEY/);
    expect(body).not.toContain("<form");
    expect(store.read).not.toHaveBeenCalled();
    expect((await visit({ form: { action: "save", serviceAccountJson: JSON_KEY } })).status).toBe(403);
    expect(store.save).not.toHaveBeenCalled();
  });
});
