import { expect, test, type Browser, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { personaSession, signIn, type PersonaKey } from "./platform-personas";

/**
 * Checks on mentor request notes (U-4.1 on B-4.1's checks), against the real backend, as the people
 * involved see them:
 * - Achieng's request that Tembo's check held (seeded: Clef doesn't run locally) waits for a check,
 *   unseen by David; an admin removes it from Request notes, and Achieng reads that it wasn't sent.
 * - David reports Wanjiku's note; she reads only that TTV is checking it; an admin keeps it, and it is
 *   back with David to answer.
 * - David reports another; an admin removes it; Wanjiku reads that it was closed.
 *
 * Local seed only (`platform-personas.local.sql`), desktop project only, in order. Re-seed before
 * running it again.
 */

test.use({ reducedMotion: "reduce" });
test.describe.configure({ mode: "serial" });

const DIRECTORY = "/dashboard/community/mentors";
const REQUESTS = "/dashboard/mentoring/requests";
const NOTES = "/admin/moderation?tab=request-notes";
const EVIDENCE = "test-results/evidence/platform-mentor-request-notes";
const HELD = "ttv-local-mentor-held";

async function as(browser: Browser, baseURL: string, who: PersonaKey, width = 1440): Promise<Page> {
  const session = personaSession(who);
  if (typeof session === "string") throw new Error(session);
  const context = await browser.newContext({ viewport: { width, height: width > 500 ? 900 : 844 } });
  await signIn(context, baseURL, session);
  const page = await context.newPage();
  // astro dev's toolbar sits over the bottom bar in local evidence.
  await page.addInitScript({
    content: `document.addEventListener("DOMContentLoaded", () => {
      document.head.insertAdjacentHTML("beforeend", "<style>astro-dev-toolbar { display: none !important; }</style>");
    });`,
  });
  return page;
}

async function visit(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(200);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
}

const ownRow = (page: Page, name: string) => page.locator("[data-own-request]").filter({ hasText: name }).first();
const noteCase = (page: Page, asker: string) => page.locator("[data-request-note]").filter({ has: page.getByRole("heading", { name: new RegExp(`^${asker} asked`) }) });

test.beforeEach(({ baseURL }, testInfo) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "Checks are exercised against the local seed only.");
  test.skip(typeof personaSession("staff") === "string", "Set PLATFORM_PERSONAS_LOCAL_SECRET and apply platform-personas.local.sql.");
  test.skip(testInfo.project.name !== "chromium", "One project at a time: both share the local database.");
  expect(baseURL).toBeTruthy();
  test.setTimeout(150_000);
});

test("a note Tembo's check held waits, unseen by its mentor, until an admin removes it", async ({ browser, baseURL }, testInfo) => {
  const achieng = await as(browser, baseURL!, "alumna", 390);
  await visit(achieng, DIRECTORY);
  const row = ownRow(achieng, "David Kamau");
  await expect(row).toContainText("Waiting for a check");
  await expect(row).toContainText("Waiting for a check before it's sent.");
  await expect(row).not.toContainText(/declin|Tembo|Harassment|Waiting for David/i);
  await expect(row.getByRole("button", { name: "Withdraw" })).toBeVisible();
  await achieng.screenshot({ path: `${EVIDENCE}/requester-waiting-390.png`, fullPage: true });

  const david = await as(browser, baseURL!, "mentor");
  await visit(david, REQUESTS);
  await expect(david.locator(`[data-mentor-request="${HELD}"]`)).toHaveCount(0);

  const admin = await as(browser, baseURL!, "staff");
  await visit(admin, "/admin/moderation");
  await admin.getByRole("link", { name: "Request notes" }).click();
  await expect(admin).toHaveURL(/tab=request-notes/);
  const held = noteCase(admin, "Achieng Otieno");
  await expect(held).toContainText("Held by Tembo's check");
  await expect(held).toContainText("Tembo's check held it before David saw it: Harassment.");
  await expect(held).toContainText("could we talk about my ledger's reconciliation job?");
  await runAxe(admin, testInfo, "request-notes");
  await admin.screenshot({ path: `${EVIDENCE}/admin-request-notes-1440.png`, fullPage: true });
  await admin.setViewportSize({ width: 390, height: 844 });
  expect(await admin.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await admin.screenshot({ path: `${EVIDENCE}/admin-request-notes-390.png`, fullPage: true });
  await admin.setViewportSize({ width: 1440, height: 900 });

  // A reason is needed, for the record: the browser asks for it before anything is sent (the server refuses too).
  await held.getByRole("button", { name: /^Remove: close it, Achieng Otieno's request/ }).click();
  await expect(held.getByRole("textbox", { name: "Reason" })).toHaveJSProperty("validity.valueMissing", true);
  await expect(admin.locator("#request-notes-notice")).toHaveCount(0);
  await noteCase(admin, "Achieng Otieno").getByRole("textbox", { name: "Reason" }).fill("The note isn't how we talk to each other.");
  await noteCase(admin, "Achieng Otieno").getByRole("button", { name: /^Remove: close it, Achieng Otieno's request/ }).click();
  await expect(admin.locator("#request-notes-notice")).toContainText("Removed.");
  await expect(noteCase(admin, "Achieng Otieno")).toHaveCount(0);
  await admin.getByRole("link", { name: "Decided requests" }).click();
  await expect(noteCase(admin, "Achieng Otieno").locator("[data-request-note-decision=remove]")).toContainText("Removed by Amina Hassan");
  await expect(noteCase(admin, "Achieng Otieno").locator("[data-request-note-status]")).toHaveText("Removed: not sent");

  await visit(achieng, DIRECTORY);
  await expect(ownRow(achieng, "David Kamau")).toContainText("This request wasn't sent.");
  await expect(ownRow(achieng, "David Kamau")).not.toContainText(/withdrawn|declin/i);
  await expect(ownRow(achieng, "David Kamau").getByRole("button", { name: "Withdraw" })).toHaveCount(0);
});

test("a mentor reports a note; the person asking sees only that it's being checked; an admin keeps it", async ({ browser, baseURL }, testInfo) => {
  const wanjiku = await as(browser, baseURL!, "student");
  const note = `Could you look at how my fare splitter rounds shares? (${Date.now()})`;
  await visit(wanjiku, DIRECTORY);
  await wanjiku.locator("[data-mentor-card]").filter({ hasText: "David Kamau" }).getByRole("link", { name: "Ask for time" }).click();
  const drawer = wanjiku.getByRole("dialog", { name: "Ask David for time" });
  await drawer.getByRole("textbox", { name: "What would you like help with?" }).fill(note);
  await drawer.getByRole("button", { name: "Send request" }).click();
  const conduct = drawer.getByRole("heading", { name: "First, how we talk to each other" });
  const sent = drawer.getByRole("heading", { name: "Request sent" });
  await expect(conduct.or(sent)).toBeVisible();
  if (await conduct.isVisible()) {
    await drawer.getByRole("button", { name: "I agree" }).click();
    await expect(wanjiku.locator("astro-island[ssr]")).toHaveCount(0);
    await wanjiku.getByRole("dialog", { name: "Ask David for time" }).getByRole("button", { name: "Send request" }).click();
  }
  await expect(wanjiku.getByRole("dialog", { name: "Ask David for time" }).getByRole("heading", { name: "Request sent" })).toBeVisible();

  const david = await as(browser, baseURL!, "mentor");
  await visit(david, REQUESTS);
  const card = david.locator("[data-mentor-request]").filter({ hasText: note });
  await card.getByRole("button", { name: "Report this request" }).click();
  await card.getByRole("textbox", { name: "What's wrong with this request?" }).fill("Fictional report for the e2e run.");
  await card.getByRole("button", { name: "Send report" }).click();
  await expect(card).toContainText("Reported");
  await expect(card.getByRole("button", { name: "Accept" })).toHaveCount(0);
  await runAxe(david, testInfo, "mentor-reported");
  await david.screenshot({ path: `${EVIDENCE}/mentor-reported-1440.png`, fullPage: true });

  await visit(wanjiku, DIRECTORY);
  const row = wanjiku.locator("[data-own-request]").filter({ hasText: "David Kamau" }).first();
  await expect(row).toContainText("TTV is checking this request.");
  await expect(row).not.toContainText(/report|declin/i);

  const admin = await as(browser, baseURL!, "staff");
  await visit(admin, NOTES);
  const reported = admin.locator("[data-request-note]").filter({ hasText: note });
  await expect(reported).toContainText("Reported by the mentor");
  await expect(reported).toContainText("Fictional report for the e2e run.");
  // What a keep does, David's spots included, before anyone chooses (QA4-10).
  await expect(reported.locator("[data-request-note-keep]")).toContainText("Keeping sends it back to David to answer and takes a spot.");
  await expect(reported.locator("[data-request-note-remove]")).toContainText("Wanjiku sees “This request was closed” and can ask again");
  await reported.getByRole("textbox", { name: "Reason" }).fill("A fair question about the project.");
  await reported.getByRole("button", { name: /^Keep: back to David, Wanjiku Mwangi's request/ }).click();
  await expect(admin.locator("#request-notes-notice")).toContainText("Kept.");

  await visit(david, REQUESTS);
  const back = david.locator("[data-mentor-request]").filter({ hasText: note });
  await expect(back.getByRole("button", { name: "Accept" })).toBeVisible();
  // Answered, so nothing waits between Wanjiku and David for the specs that run after this one.
  // "Not this month" opens an optional note (QA4-03); sending it empty is the one-tap answer.
  await back.getByRole("button", { name: "Not this month" }).click();
  await back.getByRole("button", { name: "Send: not this month" }).click();
  await expect(back).toContainText("Not this month");
  await expect(back.getByRole("button", { name: "Accept" })).toHaveCount(0);
});

test("a reported note an admin removes reads as closed to the person asking, never as declined", async ({ browser, baseURL }) => {
  const wanjiku = await as(browser, baseURL!, "student", 390);
  const note = `Could we look at my offline sync queue? (${Date.now()})`;
  await visit(wanjiku, `${DIRECTORY}?ask=ttv-local-persona-mentor`);
  const drawer = wanjiku.getByRole("dialog", { name: "Ask David for time" });
  await drawer.getByRole("textbox", { name: "What would you like help with?" }).fill(note);
  await drawer.getByRole("button", { name: "Send request" }).click();
  await expect(drawer.getByRole("heading", { name: "Request sent" })).toBeVisible();

  const david = await as(browser, baseURL!, "mentor");
  await visit(david, REQUESTS);
  const card = david.locator("[data-mentor-request]").filter({ hasText: note });
  await card.getByRole("button", { name: "Report this request" }).click();
  await card.getByRole("textbox", { name: "What's wrong with this request?" }).fill("Fictional report, to be removed.");
  await card.getByRole("button", { name: "Send report" }).click();
  await expect(card).toContainText("Reported");

  const admin = await as(browser, baseURL!, "staff");
  await visit(admin, NOTES);
  const reported = admin.locator("[data-request-note]").filter({ hasText: note });
  await reported.getByRole("textbox", { name: "Reason" }).fill("Fictional: not how we talk to each other.");
  await reported.getByRole("button", { name: /^Remove: close it, Wanjiku Mwangi's request/ }).click();
  await expect(admin.locator("#request-notes-notice")).toContainText("Removed.");

  await visit(wanjiku, DIRECTORY);
  const row = wanjiku.locator("[data-own-request][data-status=WITHDRAWN]").filter({ hasText: "This request was closed." });
  await expect(row).toHaveCount(1);
  await expect(row).not.toContainText(/declin|withdrawn|report|Not this month/i);
  await expect(row.getByRole("button", { name: "Withdraw" })).toHaveCount(0);

  // David reads that the request he reported is closed, and nothing about Wanjiku withdrawing it.
  await visit(david, REQUESTS);
  const closed = david.locator("[data-mentor-request]").filter({ hasText: note });
  await expect(closed).toContainText("You reported this request. It's closed.");
  await expect(closed).not.toContainText(/withdr/i);
});
