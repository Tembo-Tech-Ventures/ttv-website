import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { personaSession, signIn, type PersonaKey } from "./platform-personas";

/**
 * T02 and T14: admin inside the spaces shell. Every admin page renders in the Admin space, with
 * the space tabs, search and the bell, and the admin navigation as the space's sidebar, so moving
 * between a channel and Moderation keeps them. With `spaces` off for the admin, every one keeps the
 * existing admin shell. The middleware's ADMIN guard is unchanged: nobody else reaches them.
 *
 * Desktop at 1440x900 (chromium), phones at 390x844 (mobile-chromium). Local seed only
 * (`platform-personas.local.sql`, astro dev with PLATFORM_FLAGS_OVERRIDE=all and
 * PLATFORM_PERSONAS_LOCAL_SECRET).
 */

const EVIDENCE_DIR = "test-results/evidence/platform-admin-space";
mkdirSync(EVIDENCE_DIR, { recursive: true });

test.use({ reducedMotion: "reduce" });

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The personas are checked against the local seed only.");
  test.skip(typeof personaSession("staff") === "string", "Set PLATFORM_PERSONAS_LOCAL_SECRET and apply platform-personas.local.sql.");
  if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 390, height: 844 });
  else await page.setViewportSize({ width: 1440, height: 900 });
});

function wide(page: Page) {
  return (page.viewportSize()?.width ?? 0) >= 1024;
}

function evidence(name: string) {
  return `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;
}

async function as(page: Page, baseURL: string, who: PersonaKey) {
  const session = personaSession(who);
  if (typeof session === "string") throw new Error(session);
  await signIn(page.context(), baseURL, session);
}

async function open(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(200);
  // A cold dev server compiles each island on first use.
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0, { timeout: 30_000 });
  await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
  await page.evaluate(() => document.fonts.ready);
}

/** The space tabs at this width: the card-file tabs on desktop, the bottom bar on phones. */
const tabs = (page: Page) => page.locator(wide(page) ? ".space-file__nav" : ".spaces-bottom");

/** In the Admin space: its tab current, search and the bell in the top bar, its sidebar current entry, one display heading. */
async function expectAdminSpace(page: Page, heading: string, current: string | null) {
  await expect(page.locator(".spaces-shell")).toHaveAttribute("data-space", "admin");
  await expect(tabs(page).locator("[aria-current='page']")).toContainText("Admin");
  await expect(page.getByRole("button", { name: /^Search/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Attention/ })).toBeVisible();
  await expect(page.locator("#spaces-main h1")).toHaveText(heading);
  const marked = page.locator("#space-sidebar a[aria-current='page']");
  if (current === null) await expect(marked).toHaveCount(0);
  else await expect(marked).toHaveText(new RegExp(`^${current}`));
  const overflow = await page.evaluate(() => [document.documentElement, document.querySelector(".spaces-shell__main")]
    .filter((element): element is Element => element !== null)
    .map((element) => element.scrollWidth - element.clientWidth));
  for (const extra of overflow) expect(extra).toBeLessThanOrEqual(0);
}

test("an admin moves from a channel to Moderation and back without leaving the spaces shell", async ({ page, baseURL }) => {
  await as(page, baseURL!, "staff");
  await open(page, "/dashboard/community/c/help");
  await expect(page.locator(".spaces-shell")).toHaveAttribute("data-space", "community");

  await tabs(page).getByRole("link", { name: /Admin/ }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expectAdminSpace(page, "Admin home", "Admin home");
  await page.screenshot({ path: evidence("admin-home") });
  await runAxe(page, test.info(), "admin home in the Admin space");

  await open(page, "/admin/moderation");
  await expectAdminSpace(page, "Moderation", "Moderation");
  await expect(page.getByText("Contact details are hidden from other members until you decide; everything else stays visible.")).toBeVisible();
  await page.screenshot({ path: evidence("moderation") });
  await runAxe(page, test.info(), "moderation in the Admin space");

  await tabs(page).getByRole("link", { name: /Community/ }).click();
  await expect(page.locator(".spaces-shell")).toHaveAttribute("data-space", "community");
});

test("the Admin space's sidebar is the admin navigation, and its Moderation count follows the queue", async ({ page, baseURL }) => {
  test.skip(!wide(page), "The sidebar is a drawer on phones; its links are the same.");
  await as(page, baseURL!, "staff");
  await open(page, "/admin/moderation");
  const sidebar = page.locator("#space-sidebar");
  for (const [name, href] of [["Access requests", "/admin/access-requests"], ["Users", "/admin/users"], ["Feature flags", "/admin/platform-flags"]]) {
    await expect(sidebar.getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute("href", href);
  }
  await expect(sidebar.getByRole("link", { name: "Back to dashboard" })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "Logout" })).toHaveCount(0);

  // A decision swapped in place reports the queue's new count (enhance.ts); the badge follows it.
  const badge = sidebar.getByRole("link", { name: /^Moderation/ }).locator("[data-count-badge]");
  await expect(badge).toBeVisible();
  const notes = Number(await page.locator("[data-admin-space]").getAttribute("data-request-notes"));
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("ttv:moderation-pending", { detail: 2 })));
  await expect(badge).toContainText(`${2 + notes} waiting`);
  if (notes === 0) {
    await page.evaluate(() => document.dispatchEvent(new CustomEvent("ttv:moderation-pending", { detail: 0 })));
    await expect(badge).toBeHidden();
  }
});

interface AdminPage {
  path: string;
  /** The h1 in the spaces shell. */
  heading: string;
  /** The sidebar entry marked current. Agent access is listed only where agent auth is enabled. */
  current: string;
  /** The title the existing admin shell shows, as an h2, or null where it drew none. */
  legacy?: string | null;
  /** On the style guide, with its flag-off path retired (D1): the same h1 in either frame. */
  retired?: true;
}

/** Every admin page T14 moved, with a seeded record behind each detail page (platform-personas.local.sql). */
const MOVED: readonly AdminPage[] = [
  { path: "/admin/access-requests", heading: "Access requests", current: "Access requests", retired: true },
  { path: "/admin/users", heading: "Users", current: "Users", retired: true },
  { path: "/admin/users/ttv-local-persona-student", heading: "Wanjiku Mwangi", current: "Users", retired: true },
  { path: "/admin/applications", heading: "Applications", current: "Applications", retired: true },
  { path: "/admin/applications/ttv-local-persona-app-student", heading: "Application from Wanjiku Mwangi", current: "Applications", retired: true },
  { path: "/admin/profiles", heading: "Profiles", current: "Profiles", retired: true },
  { path: "/admin/profiles/ttv-local-persona-profile-alumna", heading: "Achieng Otieno", current: "Profiles", retired: true },
  { path: "/admin/feedback", heading: "Feedback", current: "Feedback", retired: true },
  { path: "/admin/feedback/ttv-local-persona-feedback", heading: "Feedback from Wanjiku Mwangi", current: "Feedback", retired: true },
  { path: "/admin/feedback/themes", heading: "Themes", current: "Feedback", retired: true },
  { path: "/admin/feedback/themes/ttv-local-persona-theme", heading: "Session links are hard to find", current: "Feedback", retired: true },
  { path: "/admin/projects", heading: "Client projects", current: "Client projects", retired: true },
  { path: "/admin/projects/ttv-local-persona-project", heading: "Member savings tracker", current: "Client projects", retired: true },
  { path: "/admin/curricula", heading: "Curricula", current: "Curricula", retired: true },
  { path: "/admin/curricula/new", heading: "New curriculum", current: "Curricula", retired: true },
  { path: "/admin/curricula/ttv-local-persona-curriculum", heading: "Full-stack foundations", current: "Curricula", retired: true },
  { path: "/admin/programs", heading: "Cohorts", current: "Cohorts", retired: true },
  { path: "/admin/programs/new", heading: "Create Cohort", current: "Cohorts" },
  { path: "/admin/programs/ttv-local-persona-cohort-05", heading: "Cohort 05", current: "Cohorts", legacy: null },
  { path: "/admin/recordings", heading: "Recordings", current: "Recordings", retired: true },
  { path: "/admin/recordings/ttv-local-persona-recording-05", heading: "Week 4: SQL joins and indexes", current: "Recordings", retired: true },
  { path: "/admin/recordings/upload", heading: "Upload recording", current: "Recordings" },
  { path: "/admin/recordings/import", heading: "Import Session Recordings", current: "Recordings" },
  { path: "/admin/settings/integrations", heading: "Integrations", current: "Integrations", retired: true },
  { path: "/admin/platform-flags", heading: "Feature flags", current: "Feature flags", retired: true },
  { path: "/admin/personal-access-tokens", heading: "Personal access tokens", current: "Personal access tokens", retired: true },
  { path: "/admin/data-migration", heading: "Data migration", current: "Data migration", legacy: "Data Migration" },
  { path: "/admin/agent-access", heading: "Agent access", current: "Agent access", retired: true },
];

/** Whether `spaces` is on for the signed-in person: /api/platform/me exists only while it is. */
async function spacesOn(page: Page): Promise<boolean> {
  return (await page.request.get("/api/platform/me")).ok();
}

test.describe("every admin page", () => {
  test("renders in the Admin space with its h1 and its sidebar entry current, and fits the screen", async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    await as(page, baseURL!, "staff");
    test.skip(!(await spacesOn(page)), "Spaces is off for the admin here; the next test covers that.");
    for (const moved of MOVED) {
      await test.step(moved.path, async () => {
        await open(page, moved.path);
        // The optional tools are listed only where they are enabled (admin-nav-server.ts).
        const listed = await page.locator("#space-sidebar a").filter({ hasText: new RegExp(`^${moved.current}`) }).count();
        await expectAdminSpace(page, moved.heading, listed > 0 ? moved.current : null);
      });
    }
  });

  test("keeps the existing admin shell, with the title it always had, while spaces is off for the admin", async ({ page, baseURL }) => {
    test.skip(!wide(page), "One width is enough for the unchanged shell.");
    test.setTimeout(240_000);
    await as(page, baseURL!, "staff");
    test.skip(await spacesOn(page), "Spaces is on for the admin here; run against a server without PLATFORM_FLAGS_OVERRIDE.");
    for (const moved of MOVED) {
      await test.step(moved.path, async () => {
        await open(page, moved.path);
        await expect(page.locator(".spaces-shell")).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Back to dashboard" })).toBeVisible();
        if (moved.retired) {
          await expect(page.getByRole("heading", { level: 1, name: moved.heading, exact: true })).toBeVisible();
          return;
        }
        await expect(page.locator("main h1")).toHaveCount(0);
        const legacy = moved.legacy === undefined ? moved.heading : moved.legacy;
        if (legacy !== null) await expect(page.getByRole("heading", { level: 2, name: legacy, exact: true })).toBeVisible();
      });
    }
  });

  test("the page title never covers a link, tab or field beside it", async ({ page, baseURL }) => {
    // Mattone's text overhangs a tight line box, and a browser hit-tests the overhang: a 60px title
    // once took the click meant for the "Back to Curricula" link just above it.
    test.setTimeout(120_000);
    await as(page, baseURL!, "staff");
    test.skip(!(await spacesOn(page)), "Spaces is off for the admin here.");
    for (const path of ["/admin/curricula/ttv-local-persona-curriculum", "/admin/curricula/new", "/admin/programs/new", "/admin/applications", "/admin/projects", "/admin/feedback/themes", "/admin/recordings/upload"]) {
      await test.step(path, async () => {
        await open(page, path);
        const covered = await page.evaluate(() => {
          const title = document.querySelector("#spaces-main h1")!;
          title.scrollIntoView({ block: "center" });
          return Array.from(document.querySelectorAll("#spaces-main :is(a, button, input, select, textarea, summary)"))
            .filter((control) => !title.contains(control))
            .filter((control) => {
              const box = control.getBoundingClientRect();
              if (box.width === 0 || box.height === 0) return false;
              // Its centre and the corners nearest a title above or below it.
              return [[box.x + box.width / 2, box.y + box.height / 2], [box.x + 2, box.top + 1], [box.x + 2, box.bottom - 1]]
                .some(([x, y]) => title.contains(document.elementFromPoint(x, y)));
            })
            .map((control) => control.textContent?.trim().slice(0, 40) ?? control.tagName);
        });
        expect(covered).toEqual([]);
      });
    }
  });

  test("the users list: each name opens the person, roles read as words, and a page past the end says so", async ({ page, baseURL }) => {
    await as(page, baseURL!, "staff");
    test.skip(!(await spacesOn(page)), "Spaces is off for the admin here.");
    await open(page, "/admin/users");
    const table = page.getByRole("table", { name: "Users" });
    await expect(table.getByRole("columnheader")).toHaveText(["Name", "Email", "Roles", "Joined"]);
    const david = table.getByRole("row").filter({ hasText: "David Kamau" });
    await expect(david.getByRole("cell").nth(2)).toHaveText("Mentor");
    await expect(david.getByRole("cell").nth(3)).toHaveText(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
    expect(await page.locator("#spaces-main").evaluate((main) => main.scrollWidth <= main.clientWidth)).toBe(true);
    await david.getByRole("link", { name: "David Kamau" }).click();
    await expect(page).toHaveURL(/\/admin\/users\/ttv-local-persona-mentor$/);

    await open(page, "/admin/users?page=40");
    await expect(page.getByRole("heading", { level: 2, name: "No one on this page" })).toBeVisible();
    await page.getByRole("link", { name: "Back to the first page" }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.getByRole("navigation", { name: "Users pages" })).toHaveCount(0);
  });

  test("applications: the status filter is a link with an address, and each applicant opens their application", async ({ page, baseURL }) => {
    await as(page, baseURL!, "staff");
    test.skip(!(await spacesOn(page)), "Spaces is off for the admin here.");
    await open(page, "/admin/applications");
    const table = page.getByRole("table", { name: "Applications" });
    await expect(table.getByRole("columnheader")).toHaveText(["Applicant", "Cohort", "Status", "Applied"]);

    const filters = page.getByRole("navigation", { name: "Application status" });
    await expect(filters.getByRole("link", { name: "All", exact: true })).toHaveAttribute("aria-current", "page");
    await filters.getByRole("link", { name: /^In review/ }).click();
    await expect(page).toHaveURL(/\/admin\/applications\?status=PENDING$/);
    await expect(filters.getByRole("link", { name: /^In review/ })).toHaveAttribute("aria-current", "page");
    const inReview = page.getByRole("table", { name: "Applications, in review" });
    const statuses = inReview.locator("td[data-label='Status']");
    expect(await statuses.count()).toBeGreaterThan(0);
    for (const status of await statuses.allTextContents()) expect(status.trim()).toBe("In review");
    expect(await page.locator("#spaces-main").evaluate((main) => main.scrollWidth <= main.clientWidth)).toBe(true);

    await inReview.locator("td[data-primary] a").first().click();
    await expect(page).toHaveURL(/\/admin\/applications\/[^/?]+$/);
  });

  test("cohorts: New cohort is the page's one primary, and each cohort's name opens it", async ({ page, baseURL }) => {
    await as(page, baseURL!, "staff");
    test.skip(!(await spacesOn(page)), "Spaces is off for the admin here.");
    await open(page, "/admin/programs");
    const table = page.getByRole("table", { name: "Cohorts" });
    await expect(table.getByRole("columnheader")).toHaveText(["Cohort", "Curriculum", "Starts", "Ends", "Applications"]);
    await expect(table.getByRole("row").filter({ hasText: "Cohort 06" }).getByRole("cell").nth(4)).toHaveText("Open");
    const main = page.locator("#spaces-main");
    await expect(main.getByRole("link", { name: "New cohort", exact: true })).toHaveAttribute("href", "/admin/programs/new");
    expect(await main.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await table.getByRole("link", { name: "Cohort 05", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/programs\/ttv-local-persona-cohort-05$/);
  });

  test("profiles: the status filter is a link with an address, and each builder's name opens their profile", async ({ page, baseURL }) => {
    await as(page, baseURL!, "staff");
    test.skip(!(await spacesOn(page)), "Spaces is off for the admin here.");
    await open(page, "/admin/profiles");
    await expect(page.getByRole("heading", { level: 2, name: "Held by the content check" })).toBeVisible();
    const table = page.getByRole("table", { name: "Profiles" });
    await expect(table.getByRole("columnheader")).toHaveText(["Builder", "Handle", "Status", "Updated", "Published"]);

    const filters = page.getByRole("navigation", { name: "Profile status" });
    await filters.getByRole("link", { name: "Draft", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/profiles\?status=DRAFT$/);
    await expect(filters.getByRole("link", { name: "Draft", exact: true })).toHaveAttribute("aria-current", "page");
    const drafts = page.getByRole("table", { name: "Profiles, draft" });
    for (const status of await drafts.locator("td[data-label='Status']").allTextContents()) expect(status.trim()).toBe("Draft");
    expect(await page.locator("#spaces-main").evaluate((main) => main.scrollWidth <= main.clientWidth)).toBe(true);

    await filters.getByRole("link", { name: "Published", exact: true }).click();
    await page.getByRole("table", { name: "Profiles, published" }).getByRole("link", { name: "Achieng Otieno" }).click();
    await expect(page).toHaveURL(/\/admin\/profiles\/ttv-local-persona-profile-alumna$/);
  });

  test("client projects: the status filter is a link with an address, and each title opens its project", async ({ page, baseURL }) => {
    await as(page, baseURL!, "staff");
    test.skip(!(await spacesOn(page)), "Spaces is off for the admin here.");
    await open(page, "/admin/projects");
    const table = page.getByRole("table", { name: "Client projects" });
    await expect(table.getByRole("columnheader")).toHaveText(["Project", "Budget", "Timeline", "Status", "Interested", "Submitted"]);
    const filters = page.getByRole("navigation", { name: "Project status" });
    await expect(filters.getByRole("link")).toHaveText([/^All/, /^In review/, /^Accepted/, /^Matched/, /^Declined/, /^Closed/]);
    expect(await page.locator("#spaces-main").evaluate((main) => main.scrollWidth <= main.clientWidth)).toBe(true);
    await table.getByRole("link", { name: "Member savings tracker" }).click();
    await expect(page).toHaveURL(/\/admin\/projects\/ttv-local-persona-project$/);

    await open(page, "/admin/projects?status=CLOSED");
    await expect(filters.getByRole("link", { name: /^Closed/ })).toHaveAttribute("aria-current", "page");
    for (const status of await page.locator("td[data-label='Status']").allTextContents()) expect(status.trim()).toBe("Closed");
  });

  test("recordings: one primary to upload, and each title opens its recording", async ({ page, baseURL }) => {
    await as(page, baseURL!, "staff");
    test.skip(!(await spacesOn(page)), "Spaces is off for the admin here.");
    await open(page, "/admin/recordings");
    const main = page.locator("main");
    await expect(main.locator('[data-variant="primary"]')).toHaveText(["Upload recording"]);
    await expect(main.getByRole("link", { name: "Import from Drive", exact: true })).toHaveAttribute("href", "/admin/recordings/import");
    const table = page.getByRole("table", { name: "Recordings" });
    await expect(table.getByRole("columnheader")).toHaveText(["Recording", "Cohort", "Recorded", "Length", "Status"]);
    expect(await page.locator("#spaces-main").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await table.getByRole("link", { name: "Week 4: SQL joins and indexes" }).click();
    await expect(page).toHaveURL(/\/admin\/recordings\/ttv-local-persona-recording-05$/);
  });

  test("personal access tokens: a new token shown once without JavaScript, and revoked after a confirm step", async ({ browser, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Making a token writes to the seed; one project is enough.");
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await as(page, baseURL!, "staff");
    const label = `e2e check ${Date.now().toString(36)}`;
    await page.goto("/admin/personal-access-tokens");
    const form = page.getByRole("region", { name: "Create a token" });
    await form.getByRole("textbox", { name: "Label" }).fill(label);
    await form.getByRole("combobox", { name: "Access" }).selectOption("channels-read");
    await form.getByRole("button", { name: "Create token" }).click();

    const secret = page.getByRole("region", { name: `Your new token: ${label}` });
    await expect(secret.locator("code#personal-access-token")).toHaveText(/^\S{20,}$/);
    await expect(form.getByRole("textbox", { name: "Label" })).toHaveValue("");

    const tokens = page.getByRole("table", { name: "Your tokens" });
    const row = tokens.getByRole("row").filter({ hasText: label });
    await expect(row).toContainText("Channels, read only");
    await expect(row).toContainText("Active");
    await row.getByRole("link", { name: `Revoke ${label}` }).click();
    await expect(page.getByRole("region", { name: `Revoke “${label}”?` })).toBeVisible();
    await expect(page).toHaveURL(/\?confirm=revoke-[^#]+$/);
    await page.getByRole("button", { name: "Revoke token" }).click();
    await expect(page).toHaveURL(/\/admin\/personal-access-tokens$/);
    await expect(page.getByRole("status").filter({ hasText: "Token revoked" })).toBeVisible();
    await expect(tokens.getByRole("row").filter({ hasText: label })).toContainText("Revoked");
    await expect(page.getByRole("region", { name: `Your new token: ${label}` })).toHaveCount(0);
    await context.close();
  });

  test("agent access: a session's token shown once without JavaScript, and revoked after a confirm step", async ({ browser, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Making a session writes to the seed; one project is enough.");
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await as(page, baseURL!, "staff");
    await page.goto("/admin/agent-access");
    const off = await page.getByText("Agent access is off here", { exact: true }).count();
    test.skip(off > 0, "Agent sessions are off on this server; set AGENT_AUTH_ENABLED=true (web/.env.local) to run this.");
    const label = `e2e check ${Date.now().toString(36)}`;
    const form = page.getByRole("region", { name: "Create a session" });
    await form.getByRole("textbox", { name: "Label" }).fill(label);
    await form.getByRole("combobox", { name: "Lasts for" }).selectOption("1");
    await form.getByRole("button", { name: "Create session" }).click();

    await expect(page.getByRole("region", { name: `Your new session: ${label}` }).locator("code#agent-token")).toHaveText(/^[0-9a-f]{64}$/);
    const sessions = page.getByRole("table", { name: "Your sessions" });
    const row = sessions.getByRole("row").filter({ hasText: label });
    await expect(row).toContainText("Active");
    await row.getByRole("link", { name: `Revoke ${label}` }).click();
    await expect(page.getByRole("region", { name: `Revoke “${label}”?` })).toBeVisible();
    await page.getByRole("button", { name: "Revoke session" }).click();
    await expect(page).toHaveURL(/\/admin\/agent-access$/);
    await expect(page.getByRole("status").filter({ hasText: "Session revoked" })).toBeVisible();
    await expect(sessions.getByRole("row").filter({ hasText: label })).toHaveCount(0);
    await context.close();
  });

  test("admin access: given at once, removed after a confirm step on the page, each change said once", async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Changing a role changes the seed; one project writes, and puts it back.");
    await as(page, baseURL!, "staff");
    test.skip(!(await spacesOn(page)), "Spaces is off for the admin here.");
    const person = "/admin/users/ttv-local-persona-newcomer";
    const notice = () => page.getByRole("status").filter({ hasText: /\S/ });
    await open(page, person);
    const access = page.getByRole("region", { name: "Admin access" });
    await expect(access).toContainText("No admin access.");

    await access.getByRole("button", { name: "Give admin access" }).click();
    await expect(notice()).toHaveText("Done: Admin access was given.");
    await expect(access).toContainText("Has admin access");

    await access.getByRole("link", { name: "Remove admin access" }).click();
    const ask = page.getByRole("region", { name: "Remove admin access from Brian Kiprono?" });
    await expect(ask).toBeFocused();
    await runAxe(page, testInfo, "admin-user-confirm");
    await access.getByRole("link", { name: "Cancel" }).click();
    await expect(ask).toHaveCount(0);
    await expect(access).toContainText("Has admin access");

    await access.getByRole("link", { name: "Remove admin access" }).click();
    await access.getByRole("button", { name: "Remove admin access" }).click();
    await expect(notice()).toHaveText("Done: Admin access was removed.");
    await expect(access).toContainText("No admin access.");
    await page.reload();
    await expect(notice()).toHaveCount(0);
  });

  test("a cohort asks before enrolling anyone as completed, without JavaScript, and Cancel changes nothing", async ({ browser, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "One width is enough for a server-side step.");
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await as(page, baseURL!, "staff");
    await page.goto("/admin/programs/ttv-local-persona-cohort-05");
    const roster = page.locator("#roster");
    const before = await roster.getByRole("row").count();
    await roster.getByRole("combobox", { name: "Person" }).selectOption({ label: "Lucy Chebet (lucy@invalid.ttv)" });
    await roster.getByRole("combobox", { name: "Status" }).selectOption("COMPLETED");
    await roster.getByRole("button", { name: "Enroll", exact: true }).click();
    const ask = page.getByRole("region", { name: "Enroll Lucy Chebet as a past learner?" });
    await expect(ask).toBeVisible();
    // The question takes focus, so a keyboard or screen-reader user lands on it after the POST.
    await expect(ask).toBeFocused();
    await expect(roster.getByRole("button", { name: "Enroll as completed" })).toBeVisible();
    await roster.getByRole("link", { name: "Cancel" }).click();
    await expect(ask).toHaveCount(0);
    await expect(roster.getByRole("row")).toHaveCount(before);
    await context.close();
  });

  test("a table page and a form page are clean under axe in the Admin space", async ({ page, baseURL }) => {
    await as(page, baseURL!, "staff");
    test.skip(!(await spacesOn(page)), "Spaces is off for the admin here.");
    for (const [path, name] of [["/admin/users", "users"], ["/admin/applications", "applications"], ["/admin/programs/new", "programs-new"]]) {
      await open(page, path);
      await page.screenshot({ path: evidence(name), fullPage: true });
      await runAxe(page, test.info(), `${path} in the Admin space`);
    }
  });
});

test.describe("staff only", () => {
  for (const who of ["student", "alumna", "mentor", "community", "institution"] as const) {
    test(`${who}: no admin page opens, and there is no Admin tab`, async ({ page, baseURL }) => {
      test.skip(!wide(page), "Access is the same at every width.");
      await as(page, baseURL!, who);
      for (const path of ["/admin", "/admin/moderation", "/admin/users", "/admin/platform-flags"]) {
        const response = await page.request.get(path, { maxRedirects: 0 });
        expect([302, 303], `${who} ${path}`).toContain(response.status());
        expect(new URL(response.headers().location!, baseURL).pathname, `${who} ${path}`).toBe("/dashboard");
      }
      await open(page, "/dashboard/community");
      await expect(tabs(page).getByRole("link", { name: /Admin/ })).toHaveCount(0);
    });
  }

  test("signed out: every admin page sends you to sign in", async ({ page }) => {
    test.skip(!wide(page), "Access is the same at every width.");
    for (const path of ["/admin", "/admin/moderation", "/admin/users", "/admin/platform-flags"]) {
      const response = await page.request.get(path, { maxRedirects: 0 });
      expect([302, 303], path).toContain(response.status());
      expect(response.headers().location, path).toMatch(/\/auth\/login/);
    }
  });
});
