import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * /admin/recordings on the style guide, with the read mocked. Its SQL runs in
 * round-trips.render.test.ts and recordings.test.ts.
 */
const store = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1" } }));
vi.mock("drizzle-orm/d1", () => ({ drizzle: () => ({}) }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));
vi.mock("@/lib/admin/recordings", async (actual) => ({ ...(await actual<typeof import("@/lib/admin/recordings")>()), readRecordingsPage: store.read }));

const { default: Page } = await import("../recordings/index.astro");

const AT = new Date(Date.UTC(2026, 9, 6, 9));
const recording = (overrides: Record<string, unknown> = {}) => ({
  id: "recording-1", title: "Week 3: Testing a service", cohort: "Cohort 07", recordedAt: AT, durationSeconds: 3725,
  processingStatus: "complete", ...overrides,
});

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
beforeEach(() => {
  store.read.mockReset().mockResolvedValue({ rows: [recording()], total: 1 });
});

async function visit(path = "/admin/recordings") {
  const response = await container.renderToResponse(Page, {
    request: new Request(`https://ttv.invalid${path}`),
    locals: { user: { id: "synthetic-admin" }, isAdmin: true } as unknown as App.Locals,
  });
  return { status: response.status, body: await response.text() };
}

describe("the recordings list on the style guide", () => {
  it("is one title with one primary, and a kit table whose titles link to each recording", async () => {
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(body.match(/<h1\b/g)).toHaveLength(1);
    expect(body.match(/data-variant="primary"/g)).toHaveLength(1);
    expect(body).toMatch(/<a href="\/admin\/recordings\/upload"[^>]*data-variant="primary"[^>]*>Upload recording/);
    expect(body).toMatch(/<a href="\/admin\/recordings\/import"[^>]*data-variant="quiet"[^>]*>Import from Drive/);
    expect(body).toMatch(/<th[^>]*>Recording<\/th>[\s\S]*?<th[^>]*>Cohort<\/th>[\s\S]*?<th[^>]*>Recorded<\/th>[\s\S]*?<th[^>]*>Length<\/th>[\s\S]*?<th[^>]*>Status<\/th>/);
    expect(body).toMatch(/<a href="\/admin\/recordings\/recording-1" class="[^"]*underline[^"]*">Week 3: Testing a service<\/a>/);
    expect(body).toContain(">Cohort 07<");
    expect(body).toContain(">6 Oct 2026<");
    expect(body).toContain(">1:02:05<");
    expect(body).toMatch(/data-status="complete">Ready</);
    expect(body).not.toMatch(/text-white|\btext-primary\b|bg-teal|uppercase|data-badge|>View<|—/);
  });

  it("says what it doesn't know in words, and a status in the kit's chip", async () => {
    store.read.mockResolvedValue({
      rows: [recording({ cohort: null, recordedAt: null, durationSeconds: null, processingStatus: "transcribing" })],
      total: 1,
    });
    const { body } = await visit();
    expect(body).toContain(">No cohort<");
    expect(body).toContain(">No date<");
    expect(body).toContain(">Not known yet<");
    expect(body).toMatch(/data-status="transcribing">Transcribing</);
    expect(body).not.toContain(">--<");
  });

  it("pages through the list 50 at a time, and says an empty list and a page past the end", async () => {
    store.read.mockResolvedValue({ rows: [recording()], total: 120 });
    const second = await visit("/admin/recordings?page=2");
    expect(store.read).toHaveBeenCalledWith(expect.anything(), { page: 2 });
    expect(second.body).toContain('data-title="Recordings, page 2"');
    expect(second.body).toMatch(/<nav aria-label="Recording pages"[\s\S]*?rel="prev" href="\/admin\/recordings"[\s\S]*?rel="next" href="\/admin\/recordings\?page=3"/);
    expect(second.body).toContain("51–51 of 120");

    store.read.mockResolvedValue({ rows: [], total: 0 });
    const empty = await visit();
    expect(empty.body).toContain("No recordings yet");
    expect(empty.body).not.toContain('aria-label="Recording pages"');

    store.read.mockResolvedValue({ rows: [], total: 4 });
    expect((await visit("/admin/recordings?page=7")).body).toMatch(/No recordings on this page[\s\S]*?href="\/admin\/recordings"[^>]*>Back to the first page/);
  });
});
