import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { personaSession, signIn, type PersonaKey } from "./platform-personas";

/**
 * F-2 (QA1-06): a mentor is told truthfully how much shared work waits for
 * their confirmation. A community member shares a fictional contribution;
 * the mentor's overview, Confirm work badge, attention inbox and Confirm page
 * all give the same number, which drops when the mentor confirms it, and the
 * inbox never says nothing needs them while work waits.
 *
 * F-7 (QA1R-02): the mentor can privately set aside work they can't confirm.
 * It leaves their waiting list and count, the member is not told, a new
 * revision waits again, and undo puts it back.
 *
 * Local seed only (the preview has no browser mentor; see platform-personas.ts).
 * The desktop and phone projects share one local database, so the tests run
 * on desktop only and one after the other, compare numbers before and after
 * their own uniquely titled contribution, and delete it afterwards.
 */

const WAITING = "Waiting for your confirmation of this revision.";

test.use({ reducedMotion: "reduce" });
test.describe.configure({ mode: "serial" });

async function as(browser: Browser, baseURL: string, key: PersonaKey): Promise<Page> {
  const session = personaSession(key);
  if (typeof session === "string") throw new Error(session);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signIn(context, baseURL, session);
  return context.newPage();
}

/**
 * A same-origin community API call with the page's own session cookie. It goes
 * through the context's request API: reading a page fetch's body from the
 * Astro dev server can hang.
 */
async function community(page: Page, method: string, path: string, data?: unknown): Promise<{ status: number; json: unknown }> {
  const origin = new URL(page.url()).origin;
  const response = await page.context().request.fetch(`${origin}/api/community/${path}`, { method, data, headers: { Origin: origin } });
  return { status: response.status(), json: await response.json() as unknown };
}

async function overviewCount(page: Page): Promise<number> {
  await page.goto("/dashboard/mentoring");
  const status = page.locator("#spaces-main [data-awaiting-confirmation]");
  return Number(await status.getAttribute("data-awaiting-confirmation"));
}

test("a mentor sees the same waiting count everywhere, and it follows their confirmations", async ({ browser, baseURL }, testInfo) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The mentor is checked against the local seed only.");
  test.skip(typeof personaSession("mentor") === "string", "Set PLATFORM_PERSONAS_LOCAL_SECRET and apply platform-personas.local.sql.");
  test.skip(testInfo.project.name !== "chromium", "One project at a time: both share the local database.");
  // Two personas and a cold dev server: allow for first compiles.
  test.setTimeout(120_000);

  const member = await as(browser, baseURL!, "community");
  const mentor = await as(browser, baseURL!, "mentor");
  await member.goto("/dashboard/community");
  const title = `Fictional F-2 ${randomUUID().slice(0, 8)}: M-Pesa receipts tracker`;
  const created = await community(member, "POST", "journey", {
    title, description: "Built and tested a fictional receipts tracker for a savings group.",
    occurredAt: "2026-10-20", visibility: "institution",
  });
  expect(created.status).toBe(201);
  const journeyId = (created.json as { entry: { id: string } }).entry.id;

  try {
    const before = await overviewCount(mentor);
    expect(before).toBeGreaterThanOrEqual(1);
    const overview = mentor.locator("#spaces-main [data-awaiting-confirmation]");
    await expect(overview).toHaveText(before === 1
      ? "1 shared contribution is waiting for your confirmation."
      : `${before} shared contributions are waiting for your confirmation.`);

    // The sidebar badge counts the same work, and says what it counts.
    const confirmLink = mentor.locator("#space-sidebar a", { hasText: "Confirm work" });
    await expect(confirmLink.locator("[data-count-badge]")).toContainText(String(before));
    await expect(confirmLink).toContainText("waiting for your confirmation");
    await runAxe(mentor, testInfo, "mentoring-overview-waiting");

    // The attention inbox points at the work rather than saying nothing needs the mentor.
    await mentor.goto("/dashboard/attention");
    const note = mentor.locator(`[data-attention-awaiting="${before}"]`);
    await expect(note).toBeVisible();
    await expect(mentor.getByText("Nothing needs you right now.")).toHaveCount(0);
    await expect(mentor.getByText("You're all caught up.")).toHaveCount(0);
    await runAxe(mentor, testInfo, "attention-waiting");

    // The Confirm page lists exactly that many review forms, and says so plainly.
    await note.getByRole("link", { name: "Open Confirm work" }).click();
    await expect(mentor).toHaveURL(/\/dashboard\/mentoring\/confirm$/);
    const summary = mentor.locator("#spaces-main [data-awaiting-confirmation]");
    await expect(summary).toHaveAttribute("data-awaiting-confirmation", String(before), { timeout: 30_000 });
    await expect(mentor.getByText(WAITING)).toHaveCount(before);
    await expect(mentor.getByText("Nobody has sent you a review request")).toBeVisible();
    await expect(mentor.getByText("not a queue of review requests")).toHaveCount(0);
    await runAxe(mentor, testInfo, "confirm-waiting");

    // Confirming the new contribution leaves one fewer waiting, on the page and on the next load.
    const claim = mentor.locator("article", { has: mentor.getByRole("heading", { name: title }) });
    await claim.getByLabel("Decision").selectOption("confirmed");
    await claim.getByLabel("How did you check it?").fill("Read the repository and its tests");
    await claim.getByLabel("What did you personally check?").fill("I read the fictional tracker's code and ran its tests.");
    await claim.getByRole("button", { name: "Save review" }).click();
    await expect(claim.getByText(`Claim confirmed: ${title}`)).toBeVisible();
    await expect(summary).toHaveAttribute("data-awaiting-confirmation", String(before - 1));
    expect(await overviewCount(mentor)).toBe(before - 1);
  } finally {
    expect((await community(member, "DELETE", `journey/${encodeURIComponent(journeyId)}`)).status).toBe(200);
    await member.context().close();
    await mentor.context().close();
  }
});

test("a mentor can privately set aside work they can't confirm, and undo it", async ({ browser, baseURL }, testInfo) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The mentor is checked against the local seed only.");
  test.skip(typeof personaSession("mentor") === "string", "Set PLATFORM_PERSONAS_LOCAL_SECRET and apply platform-personas.local.sql.");
  test.skip(testInfo.project.name !== "chromium", "One project at a time: both share the local database.");
  test.setTimeout(120_000);

  const member = await as(browser, baseURL!, "community");
  const mentor = await as(browser, baseURL!, "mentor");
  await member.goto("/dashboard/community");
  const title = `Fictional F-7 ${randomUUID().slice(0, 8)}: Chama savings ledger`;
  const contribution = {
    title, description: "Built a fictional ledger for a savings group, with reconciliation tests.",
    occurredAt: "2026-10-21", visibility: "institution",
  };
  const created = await community(member, "POST", "journey", contribution);
  expect(created.status).toBe(201);
  const journeyId = (created.json as { entry: { id: string } }).entry.id;

  try {
    const summary = mentor.locator("#spaces-main [data-awaiting-confirmation]");
    const claim = mentor.locator("article", { has: mentor.getByRole("heading", { name: title }) });
    const setAside = mentor.locator("details.mentor-set-aside");
    async function openConfirm(): Promise<number> {
      await mentor.goto("/dashboard/mentoring/confirm");
      await expect(summary).toBeVisible({ timeout: 30_000 });
      return Number(await summary.getAttribute("data-awaiting-confirmation"));
    }

    // Setting it aside takes it out of the waiting list and count at once, and says the member isn't told.
    const before = await openConfirm();
    await expect(claim).toBeVisible();
    await claim.getByRole("button", { name: "Set aside: I can't confirm this" }).click();
    await expect(mentor.locator(".mentor-set-aside-notice output")).toHaveText(`You've set aside ${title}. The member isn't told.`);
    await expect(claim).toHaveCount(0);
    await expect(summary).toHaveAttribute("data-awaiting-confirmation", String(before - 1));
    await setAside.locator("summary").click();
    await expect(setAside.getByRole("listitem").filter({ hasText: title })).toContainText("You've set this aside. The member isn't told.");
    await runAxe(mentor, testInfo, "confirm-set-aside");

    // It stays set aside on the next load, and the overview counts the same work as the page.
    const reloaded = await openConfirm();
    await expect(claim).toHaveCount(0);
    await expect(mentor.getByText(WAITING)).toHaveCount(reloaded);
    await expect(setAside.locator("summary")).toContainText("Set aside (");
    expect(await overviewCount(mentor)).toBe(reloaded);

    // The member sees nothing of it.
    const journey = await community(member, "GET", "journey");
    expect(journey.status).toBe(200);
    expect(JSON.stringify(journey.json)).not.toMatch(/set.?aside/i);
    await member.goto("/dashboard/community");
    await expect(member.getByRole("heading", { name: title })).toBeVisible();
    await expect(member.getByText(/set aside/i)).toHaveCount(0);

    // A new revision waits for the mentor again.
    const revised = await community(member, "PUT", `journey/${encodeURIComponent(journeyId)}`, {
      ...contribution, description: `${contribution.description} Added monthly statements.`, expectedRevision: 1,
    });
    expect(revised.status).toBe(200);
    await openConfirm();
    await expect(claim).toBeVisible();
    await expect(claim.getByText("Claim revision 2")).toBeVisible();
    await expect(claim.getByText(WAITING)).toBeVisible();

    // Set aside again, then undo from the set-aside list: it waits again.
    const waiting = Number(await summary.getAttribute("data-awaiting-confirmation"));
    await claim.getByRole("button", { name: "Set aside: I can't confirm this" }).click();
    await expect(summary).toHaveAttribute("data-awaiting-confirmation", String(waiting - 1));
    await setAside.locator("summary").click();
    await setAside.getByRole("button", { name: `Undo: put ${title} back in your waiting list` }).click();
    await expect(mentor.locator(".mentor-set-aside-notice output")).toHaveText(`${title} is back in your waiting list.`);
    await expect(claim).toBeVisible();
    await expect(summary).toHaveAttribute("data-awaiting-confirmation", String(waiting));
    await runAxe(mentor, testInfo, "confirm-set-aside-undone");
    await openConfirm();
    await expect(claim).toBeVisible();
  } finally {
    expect((await community(member, "DELETE", `journey/${encodeURIComponent(journeyId)}`)).status).toBe(200);
    await member.context().close();
    await mentor.context().close();
  }
});
