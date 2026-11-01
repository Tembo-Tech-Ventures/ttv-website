import { mkdirSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { personaSession, signIn, type PersonaSession } from "./platform-personas";

/**
 * U-O.3: the admin access-request queue (onboarding SPEC S6, screens/06) and the mentor and
 * institution controls on /admin/users/[id], as staff and the people asking meet them:
 * - the queue as the prototype lays it out, with axe A/AA, at 1440 and 390;
 * - a note holding HTML is shown as the text that was typed;
 * - approving gives the person their new space tab, and the user page can take it away again;
 * - declining with a message: the person reads the message, never who wrote it, and a second
 *   administrator deciding from a stale page is told it was already decided (409);
 * - members who are not administrators reach none of it.
 *
 * Local seed only (platform-personas.local.sql): previews seed other people, and their staff
 * session is an agent session, which the queue refuses. Run astro dev with
 * PLATFORM_FLAGS_OVERRIDE=all and set PLATFORM_PERSONAS_LOCAL_SECRET. Deciding changes the seed,
 * so only the desktop project writes; re-seed to run again.
 * - Otieno asks to mentor and is approved, then has the access removed and given back;
 * - Njambi (organisation access) and Peter (asking again after a decline) stay pending;
 * - Wairimu asks during the run, with HTML in her note, and is declined with a message.
 */

const EVIDENCE_DIR = "test-results/evidence/platform-access-requests";
mkdirSync(EVIDENCE_DIR, { recursive: true });

const QUEUE = "/admin/access-requests";
const OTIENO_REQUEST = "ttv-local-access-otieno";
const NJAMBI_REQUEST = "ttv-local-access-njambi";
const PETER_REQUEST = "ttv-local-access-peter";
const OTIENO = "ttv-local-persona-mentor-request";
const HTML_NOTE = 'I review <b>Kotlin</b> & sync code. <img src="/x" onerror="window.__noteRan=1"><script>window.__noteRan=2</script>';
const DECLINE_MESSAGE = "Thanks, Wairimu. Tell us about work you have reviewed, then send a new request.";

/** A member of the local seed, signed in the way the community persona is. */
function localMember(user: string): PersonaSession | string {
  if (process.env.PLAYWRIGHT_BASE_URL) return "These people are seeded locally only (platform-personas.local.sql).";
  const community = personaSession("community");
  return typeof community === "string" ? community : { ...community, token: `ttv-local-persona-${user}-token` };
}

const staff = localMember("staff");
const otieno = localMember("mentor-request");
const wairimu = localMember("note-request");

test.use({ reducedMotion: "reduce" });
// Serial: each decision changes what the next test sees. Journeys visit several pages as two people.
test.describe.configure({ mode: "serial", timeout: 90_000 });
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(typeof staff === "string", typeof staff === "string" ? staff : "");
  if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 390, height: 844 });
  else await page.setViewportSize({ width: 1440, height: 900 });
});

function writesOnce() {
  test.skip(test.info().project.name !== "chromium", "Deciding changes the seed; one project writes.");
}

async function as(context: BrowserContext, baseURL: string | undefined, session: PersonaSession | string) {
  if (typeof session === "string") throw new Error(session);
  await signIn(context, baseURL!, session);
}

async function open(page: Page, path: string, status = 200) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(status);
  // astro dev's toolbar sits over the page in local evidence.
  if (!process.env.PLAYWRIGHT_BASE_URL) {
    await page.waitForLoadState("load");
    await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
  }
  await page.evaluate(() => document.fonts.ready);
  return response;
}

function evidence(name: string) {
  return `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;
}

function row(page: Page, id: string) {
  return page.locator(`[data-access-request="${id}"]`);
}

/** The space tabs a person sees at this width. */
async function tabLabels(page: Page) {
  await page.goto("/dashboard/community");
  const wide = (page.viewportSize()?.width ?? 0) >= 1024;
  return page.locator(wide ? ".space-file__nav .space-tab__label" : ".spaces-bottom .spaces-bottom__label").allTextContents();
}

/** Same-origin JSON, as the welcome step sends it. */
async function postJson(page: Page, baseURL: string | undefined, path: string, data: unknown) {
  return page.request.post(path, { data, headers: { Origin: new URL(baseURL!).origin } });
}

test("lays the pending queue out as screens/06 does, clean under axe", async ({ context, page, baseURL }, testInfo) => {
  await as(context, baseURL, staff);
  await open(page, QUEUE);

  await expect(page.getByRole("heading", { level: 2, name: "Access requests" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Pending\s+\d+ waiting$/ })).toHaveAttribute("aria-current", "page");
  // The sidebar entry counts what is waiting, and says what it counts. Phones open it as a drawer.
  if (test.info().project.name === "chromium") {
    await expect(page.locator(`aside a[href="${QUEUE}"]`)).toHaveAccessibleName(/^Access requests\s+\d+ pending$/);
    await expect(page.locator(`aside a[href="${QUEUE}"]`)).toHaveAttribute("aria-current", "page");
  }

  const njambi = row(page, NJAMBI_REQUEST);
  await expect(njambi.getByRole("link", { name: "Njambi Karanja" })).toHaveAttribute("href", "/admin/users/ttv-local-persona-org-request");
  await expect(njambi.locator("[data-role-badge='INSTITUTION']")).toHaveText("Institution");
  await expect(njambi).toContainText("Mto Labs · Engineering lead");
  await expect(njambi).toContainText("No website given");
  await expect(njambi.getByRole("textbox", { name: "Message to Njambi (optional)" })).toHaveAccessibleDescription("Sent only if you decline.");

  const peter = row(page, PETER_REQUEST);
  await expect(peter.locator("[data-role-badge='MENTOR']")).toHaveText("Mentor");
  await expect(peter).toContainText(/Earlier request declined 12 Sept? 2026/);
  await expect(peter.getByRole("link", { name: "pnjoroge (opens in a new tab)" })).toHaveAttribute("href", "https://github.com/pnjoroge");
  await expect(peter.getByRole("button", { name: "Approve" })).toBeVisible();
  await expect(peter.getByRole("button", { name: "Decline" })).toBeVisible();
  await expect(page.getByText("The person sees your message, not your name.")).toBeVisible();

  // Every control is at least 44px tall, and nothing scrolls sideways at 390.
  for (const control of await peter.locator("button, textarea").all()) {
    expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);

  // Keyboard order within a request: the message, then Approve, then Decline.
  await peter.getByRole("textbox").focus();
  await page.keyboard.press("Tab");
  await expect(peter.getByRole("button", { name: "Approve" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(peter.getByRole("button", { name: "Decline" })).toBeFocused();

  await runAxe(page, testInfo, "access-requests-pending");
  await page.screenshot({ path: evidence("pending"), fullPage: true });
});

test("shows an HTML note as the text that was typed", async ({ browser, context, page, baseURL }) => {
  writesOnce();
  const requester = await browser.newContext();
  const asked = await requester.newPage();
  await as(requester, baseURL, wairimu);
  const created = await postJson(asked, baseURL, "/api/platform/access-requests", { role: "MENTOR", note: HTML_NOTE, link: null });
  expect(created.status(), await created.text()).toBe(201);
  await requester.close();

  await as(context, baseURL, staff);
  await open(page, QUEUE);
  const note = page.locator("[data-access-request]", { hasText: "Wairimu Kamau" }).locator("[data-access-request-note]");
  await expect(note).toHaveText(HTML_NOTE);
  await expect(note.locator("b, img, script")).toHaveCount(0);
  expect(await page.evaluate(() => (window as { __noteRan?: number }).__noteRan)).toBeUndefined();
});

test("declines with a message the person reads without the administrator's name, and a stale page gets a 409", async ({ browser, context, page, baseURL }, testInfo) => {
  writesOnce();
  await as(context, baseURL, staff);
  // A second administrator's tab, opened before the decision.
  const stale = await context.newPage();
  await stale.setViewportSize(page.viewportSize()!);
  await open(stale, QUEUE);
  await open(page, QUEUE);

  const request = page.locator("[data-access-request]", { hasText: "Wairimu Kamau" });
  const id = await request.getAttribute("data-access-request");
  await request.getByRole("textbox", { name: "Message to Wairimu (optional)" }).fill(DECLINE_MESSAGE);
  await request.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByRole("status")).toHaveText("Declined. Wairimu will see your message, not your name.");
  await expect(row(page, id!)).toHaveCount(0);

  await page.getByRole("link", { name: "Decided" }).click();
  const decided = row(page, id!);
  await expect(decided).toContainText(/Declined \d+ \w+ 2026 by Amina Hassan/);
  await expect(decided).toContainText(DECLINE_MESSAGE);
  await runAxe(page, testInfo, "access-requests-decided");
  await page.screenshot({ path: evidence("decided"), fullPage: true });

  // The stale tab still offers Approve. Pressing it changes nothing, and says why.
  const conflict = stale.waitForResponse((response) => response.request().method() === "POST");
  await row(stale, id!).getByRole("button", { name: "Approve" }).click();
  expect((await conflict).status()).toBe(409);
  await expect(stale.getByRole("alert")).toHaveText(/^Someone already decided this request, or the person withdrew it, so nothing changed\./);
  if (!process.env.PLAYWRIGHT_BASE_URL) await stale.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
  await runAxe(stale, testInfo, "access-requests-conflict");
  await stale.screenshot({ path: evidence("conflict"), fullPage: true });

  // Sending the same decline again (a double-click) is this administrator's own decision: it reads as done.
  const repeat = await page.request.post(QUEUE, {
    form: { id: id!, decision: "decline", message: DECLINE_MESSAGE }, headers: { Origin: new URL(baseURL!).origin }, maxRedirects: 0,
  });
  expect(repeat.status()).toBe(303);
  expect(repeat.headers().location).toBe(`${QUEUE}?decided=${id}`);

  // Wairimu reads the decision and its message; who decided never reaches her.
  const requester = await browser.newContext();
  const her = await requester.newPage();
  await as(requester, baseURL, wairimu);
  const state = await (await her.request.get("/api/platform/onboarding")).json() as {
    roles: string[]; requests: Record<string, unknown>[];
  };
  expect(state.roles).toEqual([]);
  expect(state.requests).toEqual([expect.objectContaining({ id, role: "MENTOR", status: "DECLINED", decisionMessage: DECLINE_MESSAGE })]);
  expect(JSON.stringify(state)).not.toMatch(/decidedBy|Amina|ttv-local-persona-staff/);
  await open(her, "/dashboard/attention");
  const item = her.getByRole("link", { name: /Mentor access wasn't approved this time\./ });
  await expect(item).toBeVisible();
  await expect(item).not.toContainText("Amina");
  await requester.close();
});

test("approving gives the person their new space, and the user page can take it away and give it back", async ({ browser, context, page, baseURL }) => {
  writesOnce();
  const requester = await browser.newContext();
  const his = await requester.newPage();
  await his.setViewportSize({ width: 1440, height: 900 });
  await as(requester, baseURL, otieno);
  expect(await tabLabels(his)).not.toContain("Mentoring");

  await as(context, baseURL, staff);
  await open(page, QUEUE);
  await row(page, OTIENO_REQUEST).getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("status")).toHaveText("Approved. Otieno Ouma now has mentor access.");
  await expect(row(page, OTIENO_REQUEST)).toHaveCount(0);
  expect(await tabLabels(his)).toContain("Mentoring");

  // The user page shows the role, and can remove it: the tab goes with it.
  await open(page, `/admin/users/${OTIENO}`);
  const mentor = page.locator("[data-community-role='MENTOR']");
  await expect(mentor).toContainText("Has mentor access.");
  page.once("dialog", (dialog) => dialog.accept());
  await mentor.getByRole("button", { name: "Remove mentor access" }).click();
  await expect(page.getByRole("status")).toHaveText("Mentor access was removed.");
  await expect(mentor).toContainText("No mentor access.");
  expect(await tabLabels(his)).not.toContain("Mentoring");

  await mentor.getByRole("button", { name: "Give mentor access" }).click();
  await expect(page.getByRole("status")).toHaveText("Mentor access was given.");
  expect(await tabLabels(his)).toContain("Mentoring");
  await page.screenshot({ path: evidence("user-access"), fullPage: true });
  await requester.close();
});

test("keeps the queue, its decisions and the role controls from members who are not administrators", async ({ context, page, baseURL }) => {
  await as(context, baseURL, otieno);
  const origin = { Origin: new URL(baseURL!).origin };

  // Pages send a member back to their dashboard; the APIs refuse them outright.
  await page.goto(QUEUE);
  await expect(page).toHaveURL(/\/dashboard(\/|$)/);
  await page.goto(`/admin/users/${OTIENO}`);
  await expect(page).toHaveURL(/\/dashboard(\/|$)/);
  expect((await page.request.get("/api/admin/access-requests")).status()).toBe(403);

  // Posting the forms by hand changes nothing.
  const decide = await page.request.post(QUEUE, { form: { id: PETER_REQUEST, decision: "approve" }, headers: origin, maxRedirects: 0 });
  expect(decide.status()).toBe(302);
  expect(decide.headers().location).toMatch(/^\/dashboard/);
  const api = await page.request.post(`/api/admin/access-requests/${PETER_REQUEST}/decision`, { data: { decision: "approve" }, headers: origin });
  expect(api.status()).toBe(403);
  const grant = await page.request.post(`/admin/users/${OTIENO}`, { form: { action: "grant-INSTITUTION" }, headers: origin, maxRedirects: 0 });
  expect(grant.status()).toBe(302);

  await as(context, baseURL, staff);
  await open(page, QUEUE);
  await expect(row(page, PETER_REQUEST).getByRole("button", { name: "Approve" })).toBeVisible();
  await open(page, `/admin/users/${OTIENO}`);
  await expect(page.locator("[data-community-role='INSTITUTION']")).toContainText("No institution access.");
});
