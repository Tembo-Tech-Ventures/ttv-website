import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * /admin/applications/[id] on the style guide: the page's markup, its answers as questions and its
 * status changes, with the database and the mutation mocked. Accepting an application while its
 * applicant edits it, end to end, is e2e/platform-application.spec.ts.
 */
const store = vi.hoisted(() => ({ find: vi.fn(), mutate: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1" } }));
vi.mock("drizzle-orm/d1", () => ({ drizzle: () => ({ query: { programApplication: { findFirst: store.find } } }) }));
vi.mock("@/layouts/AdminLayout.astro", () => import("@/test/StubLayout.astro"));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: async () => null }));
vi.mock("@/lib/attention/mutations", () => ({ applyApplicationMutationWithAttention: store.mutate }));

const { default: Page } = await import("../applications/[id].astro");

const PATH = "/admin/applications/app-1";
const QUESTIONS = {
  version: 1,
  submission: [
    { name: "project", type: "textarea", label: "What would you like to build?", options: [], value: "A matatu fare tracker.\nWeekly summaries." },
    { name: "laptop", type: "requiredBoolean", label: "Do you have a laptop?", options: [], value: true },
    { name: "github", type: "string", label: "Your GitHub username", options: [], value: "" },
  ],
};
function application(status: string, answers: unknown = QUESTIONS, completedAt: Date | null = null) {
  return {
    id: "app-1", userId: "wanjiku", programId: "cohort-05", status, application: JSON.stringify(answers), completedAt,
    createdAt: new Date(Date.UTC(2026, 9, 6, 9)), updatedAt: new Date(Date.UTC(2026, 9, 6, 9)),
    user: { id: "wanjiku", name: "Wanjiku Mwangi", email: "wanjiku@example.test" },
    program: { id: "cohort-05", name: "Cohort 05" },
  };
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
beforeEach(() => {
  store.find.mockReset().mockImplementation(async (query: { columns?: unknown }) =>
    query.columns ? { status: "PENDING" } : application("PENDING"));
  store.mutate.mockReset().mockResolvedValue(undefined);
});

/** The Set-Cookie lines of a response, read the way the adapter writes them. */
const setCookies = (response: Response): string[] => {
  const cookies = Reflect.get(response, Symbol.for("astro.cookies")) as { consume(): Iterable<string> } | undefined;
  return [...response.headers.getSetCookie(), ...(cookies ? cookies.consume() : [])];
};
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };
async function visit({ query = "", form }: { query?: string; form?: Record<string, string> } = {}) {
  const response = await container.renderToResponse(Page, {
    request: new Request(`https://ttv.invalid${PATH}${query}`, form ? { method: "POST", body: new URLSearchParams(form), headers: FORM } : undefined),
    params: { id: "app-1" },
    locals: { user: { id: "synthetic-admin" }, isAdmin: true } as unknown as App.Locals,
  });
  return { response, status: response.status, location: response.headers.get("location"), body: await response.text() };
}
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;
const section = (body: string, marker: string) => new RegExp(`<div class="grid gap-4" ${marker}>([\\s\\S]*?)</div></div>(?=<div data-card|</div></main>)`).exec(body)?.[1] ?? "";

describe("an application on the style guide", () => {
  it("names the applicant in the one display title, with the status in its shared name and tone", async () => {
    const { status, body } = await visit();
    expect(status).toBe(200);
    expect(count(body, /<h1\b/g)).toBe(1);
    expect(body).toMatch(/<a href="\/admin\/applications" data-back-link[^>]*>[\s\S]*?<span>Applications<\/span><\/a>[\s\S]*?<h1 [^>]*>Application from Wanjiku Mwangi<\/h1>/);
    expect(body).toMatch(/data-chip="peach"[^>]*><span[^>]*><span data-status="PENDING">In review<\/span>/);
    expect(body).toContain("Cohort 05 · applied 6 Oct 2026");
    expect(body).toMatch(/<h2 class="text-lg text-ink-primary">Details<\/h2>[\s\S]*?<dl data-description-list/);
    expect(body).toMatch(/<a href="\/admin\/users\/wanjiku" class="[^"]*underline[^"]*">Wanjiku Mwangi<\/a>/);
    expect(body).toMatch(/<a href="\/admin\/programs\/cohort-05" class="[^"]*underline[^"]*">Cohort 05<\/a>/);
    expect(body).not.toMatch(/text-white|\btext-primary\b|bg-(green|red|blue|purple)-|confirm\(|data-badge|Application Data|Change Status|View Profile/);
  });

  it("reads the answers as questions and answers, never as JSON", async () => {
    const answers = section((await visit()).body, "data-application-answers");
    expect(answers).toMatch(/<h2[^>]*>Answers<\/h2><dl data-description-list/);
    expect(answers).toMatch(/<dt[^>]*>What would you like to build\?<\/dt><dd[^>]*><span class="whitespace-pre-line">A matatu fare tracker\.\nWeekly summaries\.<\/span><\/dd>/);
    expect(answers).toMatch(/<dt[^>]*>Do you have a laptop\?<\/dt><dd[^>]*><span class="whitespace-pre-line">Yes<\/span>/);
    expect(answers).toMatch(/<dt[^>]*>Your GitHub username<\/dt><dd[^>]*><span class="whitespace-pre-line text-ink-muted">Not answered<\/span>/);
    expect(answers).not.toMatch(/\{"|":|requiredBoolean|"textarea"/);
  });

  it("says in words what was recorded when nothing was asked", async () => {
    store.find.mockResolvedValue(application("APPROVED", { enrollment: { source: "ADMIN", schemaVersion: 1 } }));
    expect((await visit()).body).toContain("An admin added them to the cohort directly, so nothing was asked.");
    store.find.mockResolvedValue(application("PENDING", {}));
    expect((await visit()).body).toContain("No answers were recorded with this application.");
  });

  it("offers each change as a quiet action named for what it does: no peach, no green, red or blue", async () => {
    const actions = section((await visit()).body, "data-status-actions");
    expect(actions).toContain("It's in review now. They see each change on their application page.");
    expect(actions).toMatch(/<form method="POST" action="\/admin\/applications\/app-1"><input type="hidden" name="expectedStatus" value="PENDING"><input type="hidden" name="status" value="APPROVED"><button [^>]*data-variant="quiet"[^>]*>Accept<\/button><\/form>/);
    expect(actions).toMatch(/<input type="hidden" name="status" value="AUDIT"><button [^>]*data-variant="quiet"[^>]*>Move to audit<\/button>/);
    // Declining is final, so it asks first, on the page.
    expect(actions).toMatch(/<a href="\/admin\/applications\/app-1\?confirm=decline" data-variant="quiet"[^>]*>Decline<\/a>/);
    expect(actions).not.toMatch(/data-variant="(primary|danger)"|value="REJECTED"/);
  });

  it("asks before declining: a focused warning naming the applicant, then the danger button that posts it", async () => {
    const actions = section((await visit({ query: "?confirm=decline" })).body, "data-status-actions");
    expect(actions).toMatch(/<div autofocus="" tabindex="-1" role="region" aria-label="Decline Wanjiku Mwangi&#x27;s application\?" data-notice="warning"/);
    expect(actions).toMatch(/<input type="hidden" name="expectedStatus" value="PENDING"\/><input type="hidden" name="status" value="REJECTED"\/><button [^>]*data-variant="danger"[^>]*>Decline application<\/button><a href="\/admin\/applications\/app-1" data-variant="ghost"[^>]*>Cancel<\/a>/);
    expect(actions).not.toContain(">Accept<");
  });

  it("asks before completing with the date chosen, and keeps an unusable date in the field with its error", async () => {
    store.find.mockResolvedValue(application("APPROVED"));
    const offer = section((await visit()).body, "data-status-actions");
    expect(offer).toMatch(/<form method="GET" action="\/admin\/applications\/app-1" class="[^"]*" data-complete-form><input type="hidden" name="confirm" value="complete">[\s\S]*?<label for="completionDate"[^>]*>Completion date<\/label><input max="\d{4}-\d{2}-\d{2}" required="" id="completionDate" name="completionDate" type="date"[^>]*value="\d{4}-\d{2}-\d{2}"\/>[\s\S]*?data-variant="quiet"[^>]*>Mark completed<\/button>/);

    const step = section((await visit({ query: "?confirm=complete&completionDate=2026-10-30" })).body, "data-status-actions");
    expect(step).toMatch(/aria-label="Mark Wanjiku Mwangi completed on 30 Oct 2026\?"/);
    expect(step).toContain("Their certificate and builder portfolio unlock at once. This can't be undone.");
    expect(step).toMatch(/<input type="hidden" name="status" value="COMPLETED"\/><input type="hidden" name="completionDate" value="2026-10-30"\/><button [^>]*data-variant="danger"[^>]*>Mark completed<\/button>/);

    const future = section((await visit({ query: "?confirm=complete&completionDate=2999-01-01" })).body, "data-status-actions");
    expect(future).not.toContain("data-confirm-step");
    expect(future).toMatch(/aria-invalid="true"[^>]*value="2999-01-01"/);
    expect(future).toContain("Completion date cannot be in the future.");
  });

  it("answers a change with a 303 to the page and a flash, and tells the applicant through attention", async () => {
    const { status, location, response } = await visit({ form: { expectedStatus: "PENDING", status: "APPROVED" } });
    expect(status).toBe(303);
    expect(location).toBe(PATH);
    expect(store.mutate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ applicationIds: ["app-1"], status: "APPROVED", actorId: "synthetic-admin" }));
    const [line] = setCookies(response);
    expect(decodeURIComponent(line)).toContain('"title":"Application accepted"');
    expect(line).toContain(`Path=${PATH}`);
  });

  it("says a stale or impossible change in words, not stored values, in a focused danger Notice with a 400", async () => {
    store.find.mockImplementation(async (query: { columns?: unknown }) => (query.columns ? { status: "APPROVED" } : application("APPROVED")));
    const stale = await visit({ form: { expectedStatus: "PENDING", status: "AUDIT" } });
    expect(stale.status).toBe(400);
    expect(stale.body).toMatch(/data-title-prefix="Error: "/);
    expect(stale.body).toMatch(/<div (?=[^>]*autofocus="")(?=[^>]*role="alert")[^>]*data-notice="danger"[\s\S]*?The status didn&#x27;t change[\s\S]*?Someone changed this application while you were looking at it\./);
    expect(stale.body).not.toMatch(/PENDING to|APPROVED to/);

    const impossible = await visit({ form: { expectedStatus: "APPROVED", status: "AUDIT" } });
    expect(impossible.body).toContain("An application that is accepted can&#39;t be changed to audit.");
    expect(store.mutate).not.toHaveBeenCalled();
  });

  it("says a database failure in the same Notice with a 503, rather than an error page", async () => {
    store.mutate.mockRejectedValue(new Error("D1 down"));
    const { status, body } = await visit({ form: { expectedStatus: "PENDING", status: "APPROVED" } });
    expect(status).toBe(503);
    expect(body).toMatch(/data-notice="danger"[\s\S]*?The database didn(?:&#39;|&#x27;)t answer, so nothing changed\. Try again in a moment\./);
  });

  it("keeps a rejected completion date in its field", async () => {
    store.find.mockImplementation(async (query: { columns?: unknown }) => (query.columns ? { status: "APPROVED" } : application("APPROVED")));
    const { status, body } = await visit({ form: { expectedStatus: "APPROVED", status: "COMPLETED", completionDate: "2999-01-01" } });
    expect(status).toBe(400);
    expect(body).toMatch(/aria-invalid="true"[^>]*value="2999-01-01"/);
  });

  it("shows a completed application's dates and certificate, with nothing left to change", async () => {
    store.find.mockResolvedValue(application("COMPLETED", QUESTIONS, new Date(Date.UTC(2026, 9, 30))));
    const { body } = await visit();
    expect(body).toMatch(/data-chip="success"[^>]*><span[^>]*><span data-status="COMPLETED">Completed<\/span>/);
    expect(body).toMatch(/<dt[^>]*>Completed<\/dt><dd[^>]*>30 Oct 2026<\/dd>/);
    expect(body).toMatch(/<a href="\/certificate\/app-1" class="[^"]*underline[^"]*">View certificate<\/a>/);
    expect(body).not.toContain("data-status-actions");
  });
});
