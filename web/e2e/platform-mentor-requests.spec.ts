import { expect, test, type Browser, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { localPersonaSession, personaSession, signIn, type PersonaKey } from "./platform-personas";

/**
 * U-4.1/S-4.1: mentor connections against the real backend (B-4.1), as the
 * people who use them. Wanjiku, from a cohort, asks David for time; David accepts
 * and their private conversation opens with the note as its first message.
 * Then the other ways a request ends: withdrawn, not this month, a suggestion
 * of Samuel (who has one spot a month), and Samuel full once someone waits.
 * Last, an organisation account asks as itself (owner decision 2026-11-02).
 *
 * Local seed only (`platform-personas.local.sql`, which also clears every
 * earlier request): agent previews have no browser mentor yet. The desktop
 * and phone projects share one local database, so this runs on desktop only,
 * in order. Re-seed before running it again.
 */

test.use({ reducedMotion: "reduce" });
test.describe.configure({ mode: "serial" });

const DIRECTORY = "/dashboard/community/mentors";
const REQUESTS = "/dashboard/mentoring/requests";

async function as(browser: Browser, baseURL: string, who: PersonaKey | "mentor-two"): Promise<Page> {
  const session = who === "mentor-two" ? localPersonaSession(who) : personaSession(who);
  if (typeof session === "string") throw new Error(session);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signIn(context, baseURL, session);
  return context.newPage();
}

/** Opens a page and waits for its islands: before that, "Ask for time" and the answers have nothing behind them. */
async function visit(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
}

const card = (page: Page, name: string) => page.locator("[data-mentor-card]").filter({ has: page.getByRole("heading", { name }) });
const ownRow = (page: Page, name: string) => page.locator("[data-own-request]").filter({ hasText: name }).first();
const queueCard = (page: Page, name: string) => page.locator("[data-mentor-request]").filter({ has: page.getByRole("heading", { name }) }).first();

/**
 * Asks a mentor for time from the directory. Someone who has not agreed to the habits reads them before Send,
 * and the one press agrees and sends (QA4-05); if the server still asks, agreeing there sends too.
 */
async function ask(page: Page, mentor: string, note: string) {
  await visit(page, DIRECTORY);
  await card(page, mentor).getByRole("link", { name: "Ask for time" }).click();
  const drawer = page.getByRole("dialog", { name: `Ask ${mentor.split(" ")[0]} for time` });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("textbox", { name: "What would you like help with?" })).toBeFocused();
  await drawer.getByRole("textbox", { name: "What would you like help with?" }).fill(note);
  // "Send request", or "Agree and send request" before the person has agreed to the habits.
  await drawer.getByRole("button", { name: /send request$/i }).click();
  const conduct = drawer.getByRole("heading", { name: "First, how we talk to each other" });
  const sent = drawer.getByRole("heading", { name: "Request sent" });
  await expect(conduct.or(sent)).toBeVisible();
  if (await conduct.isVisible()) await drawer.getByRole("button", { name: "I agree, send my request" }).click();
  await expect(sent).toBeVisible();
  await drawer.getByRole("button", { name: "Done" }).click();
  await expect(ownRow(page, mentor)).toContainText(`Waiting for ${mentor.split(" ")[0]}`);
}

test.beforeEach(({ baseURL }, testInfo) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "Mentors are checked against the local seed only.");
  test.skip(typeof personaSession("mentor") === "string", "Set PLATFORM_PERSONAS_LOCAL_SECRET and apply platform-personas.local.sql.");
  test.skip(testInfo.project.name !== "chromium", "One project at a time: both share the local database.");
  expect(baseURL).toBeTruthy();
  test.setTimeout(150_000);
});

test("a member asks for time, the mentor accepts, and their conversation opens with the note", async ({ browser, baseURL }, testInfo) => {
  const member = await as(browser, baseURL!, "student");
  const mentor = await as(browser, baseURL!, "mentor");
  const note = `Could you look at how my savings app retries a failed M-Pesa callback? (${Date.now()})`;

  await visit(member, DIRECTORY);
  await expect(member.getByRole("heading", { level: 1, name: "Mentors" })).toBeVisible();
  await expect(card(member, "David Kamau")).toContainText("3 spots open in");
  await runAxe(member, testInfo, "directory");
  await ask(member, "David Kamau", note);

  await visit(mentor, REQUESTS);
  const request = queueCard(mentor, "Wanjiku Mwangi");
  await expect(request).toContainText(note);
  await runAxe(mentor, testInfo, "requests");
  await request.getByRole("button", { name: "Accept" }).click();
  const open = request.getByRole("link", { name: /Open conversation with Wanjiku/ });
  await expect(open).toBeVisible();
  await open.click();
  // A first visit compiles the conversation page on a cold dev server.
  await mentor.waitForURL(/\/dashboard\/community\/dm\//, { timeout: 60_000 });
  // A first visit to any channel shows the habits first.
  const agree = mentor.getByRole("button", { name: "I’ll keep to this" });
  if (await agree.isVisible().catch(() => false)) await agree.click();
  await expect(mentor.getByRole("heading", { level: 1, name: "Wanjiku Mwangi" })).toBeVisible();
  await expect(mentor.locator("[data-conversation-context]")).toContainText("You accepted Wanjiku's request for a written review");
  await expect(mentor.getByRole("region", { name: /^Messages in / }).getByText(note)).toBeVisible();

  // The member sees the acceptance, the conversation in Community, and the same first message.
  await visit(member, DIRECTORY);
  await expect(ownRow(member, "David Kamau")).toContainText("Accepted");
  await expect(member.locator("#space-sidebar").getByRole("link", { name: /David Kamau/ })).toBeVisible();
  await ownRow(member, "David Kamau").getByRole("link", { name: "Open conversation" }).click();
  const memberAgree = member.getByRole("button", { name: "I’ll keep to this" });
  if (await memberAgree.isVisible().catch(() => false)) await memberAgree.click();
  await expect(member.getByRole("region", { name: /^Messages in / }).getByText(note)).toBeVisible();
  await runAxe(member, testInfo, "conversation");
});

test("the member withdraws a waiting request, and the mentor sees it withdrawn", async ({ browser, baseURL }) => {
  const member = await as(browser, baseURL!, "student");
  const mentor = await as(browser, baseURL!, "mentor");
  await ask(member, "David Kamau", "Would you review my API error messages?");
  await ownRow(member, "David Kamau").getByRole("button", { name: "Withdraw" }).click();
  await expect(ownRow(member, "David Kamau")).toContainText("Withdrawn");
  await visit(mentor, REQUESTS);
  await expect(mentor.locator("[data-mentor-request][data-status='WITHDRAWN']").first()).toContainText("Withdrawn");
});

test("not this month carries an optional kind word, and reads as the mentor's time, not a verdict", async ({ browser, baseURL }) => {
  const member = await as(browser, baseURL!, "student");
  const mentor = await as(browser, baseURL!, "mentor");
  await ask(member, "David Kamau", "Could we talk about database indexes?");
  await visit(mentor, REQUESTS);
  const request = queueCard(mentor, "Wanjiku Mwangi");
  await request.getByRole("button", { name: "Not this month" }).click();
  await request.getByRole("textbox", { name: /A note for Wanjiku/ }).fill("I'm travelling this month. Try me in December?");
  await request.getByRole("button", { name: "Send: not this month" }).click();
  await expect(request).toHaveAttribute("data-status", "DECLINED");
  await visit(member, DIRECTORY);
  const row = ownRow(member, "David Kamau");
  await expect(row).toContainText("Not this month");
  await expect(row).toContainText("you're welcome to ask again or ask someone else");
  await expect(row).toContainText("I'm travelling this month. Try me in December?");
  await expect(row).not.toContainText(/reject|declined/i);
});

test("the mentor suggests Samuel, and the member can ask him straight away", async ({ browser, baseURL }) => {
  const member = await as(browser, baseURL!, "student");
  const mentor = await as(browser, baseURL!, "mentor");
  await ask(member, "David Kamau", "How do I test an offline-first Android app?");
  await visit(mentor, REQUESTS);
  const request = queueCard(mentor, "Wanjiku Mwangi");
  await request.getByRole("button", { name: "Suggest another mentor" }).click();
  await request.getByRole("radio", { name: "Samuel Otieno" }).check();
  await request.getByRole("textbox", { name: /A note for Wanjiku/ }).fill("Samuel ships Android apps for low-end phones.");
  await request.getByRole("button", { name: "Send suggestion" }).click();
  await expect(request).toContainText("Suggested Samuel Otieno");

  await visit(member, DIRECTORY);
  const row = ownRow(member, "David Kamau");
  await expect(row).toContainText("David suggested Samuel Otieno");
  await expect(row).toContainText("Samuel ships Android apps for low-end phones.");
  await row.getByRole("button", { name: "Ask Samuel Otieno" }).click();
  await expect(member.getByRole("dialog", { name: "Ask Samuel for time" })).toBeVisible();
});

test("a full mentor stays listed with no request button, and the directory can show only open spots", async ({ browser, baseURL }) => {
  const student = await as(browser, baseURL!, "student");
  const member = await as(browser, baseURL!, "alumna");
  const samuel = await as(browser, baseURL!, "mentor-two");
  await ask(student, "Samuel Otieno", "Could you look at my Kotlin sync code?");

  await visit(member, DIRECTORY);
  const full = card(member, "Samuel Otieno");
  await expect(full).toContainText("Full this month");
  await expect(full.getByRole("link", { name: "Ask for time" })).toHaveCount(0);
  await member.getByRole("link", { name: "Has open spots" }).click();
  await expect(member).toHaveURL(/available=true/);
  await expect(card(member, "Samuel Otieno")).toHaveCount(0);
  await expect(card(member, "David Kamau")).toBeVisible();

  // Samuel sees his month as full.
  await visit(samuel, REQUESTS);
  await expect(samuel.locator("[data-spots-used]")).toHaveText("1 of 1");
});

// Owner decision 2026-11-02 ("Mentor requests are personal"): an organisation account asks as itself (QA4-09).
test("an organisation account is told it can ask as itself, and its request comes from the person", async ({ browser, baseURL }, testInfo) => {
  const institution = await as(browser, baseURL!, "institution");
  await visit(institution, DIRECTORY);
  await expect(institution.getByRole("heading", { level: 1, name: "Mentors" })).toBeVisible();
  await expect(institution.locator("[data-mentors-as-yourself]")).toHaveText(
    "You can ask a mentor for time as yourself. Requests come from you, not from your organisation.",
  );
  await runAxe(institution, testInfo, "directory-institution");
  await ask(institution, "David Kamau", "Could we talk about hiring junior developers?");
  // Leave the shared seed as it was.
  await ownRow(institution, "David Kamau").getByRole("button", { name: "Withdraw" }).click();
  await expect(ownRow(institution, "David Kamau")).toContainText("Withdrawn");
});

