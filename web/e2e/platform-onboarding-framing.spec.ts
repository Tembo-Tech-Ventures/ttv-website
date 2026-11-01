import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { localPersonaSession, personaSession, signIn } from "./platform-personas";

/**
 * U-O.2: intent-aware framing (onboarding SPEC §2 S3–S5, §3), as each person
 * meets it. Every landing in the SPEC §3 map has a fictional persona seeded
 * locally (platform-personas.local.sql), in exactly that state:
 *
 * - Wairimu, just looking around: a welcome card where the first contribution prompt was; the cohort invitation stays.
 * - Mercy, member and mentor, pending: the Pending card above the cohort card; "Your requests" in the sidebar.
 * - Otieno, mentor, pending: Pending, and none of the student framing (QA1-08).
 * - Njambi, organisation, pending: Pending, with where to read about Discover meanwhile.
 * - Kevin, mentor, approved and not yet seen: /dashboard opens Mentoring; Community announces it once.
 * - Daniel, mentor, declined with a message: the message as plain text, and a way to ask again.
 * - David and Joseph, mentor and institution from before onboarding: "Your spaces", no Apply.
 * - Achieng, Faith and Grace, alumnae from before onboarding: the one-time card (S4).
 * - Amani, member and mentor, pending like Mercy: Mercy is only read, Amani withdraws (S5).
 *
 * Tests that write (dismiss, save, withdraw) run once, in the desktop project,
 * on their own persona, and tolerate a rerun against the same database: reseed
 * to replay them from the start. Everything else runs at 1440 and at 390.
 *
 * With onboarding off, or for an agent's delegated session (every preview
 * persona), the pages carry none of this: the last describe checks that on
 * previews, and unit tests prove the flag-off frame is unchanged.
 */
const EVIDENCE_DIR = "test-results/evidence/platform-onboarding-framing";
mkdirSync(EVIDENCE_DIR, { recursive: true });
const PREVIEW = Boolean(process.env.PLAYWRIGHT_BASE_URL);

test.use({ reducedMotion: "reduce" });
test.beforeEach(async ({ page }, testInfo) => {
  await page.setViewportSize(testInfo.project.name === "mobile-chromium" ? { width: 390, height: 844 } : { width: 1440, height: 900 });
});

const desktop = () => test.info().project.name === "chromium";

function evidence(name: string) {
  return `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;
}

/** Chromium in the dev container cannot reach Google Fonts itself; Node can. */
async function routeFonts(page: Page) {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, async (route) => {
    try {
      const response = await fetch(route.request().url());
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    } catch {
      await route.abort();
    }
  });
}

/** Signs in as a local persona, or skips with the reason there is none here. */
async function as(page: Page, baseURL: string | undefined, name: string) {
  const session = localPersonaSession(name);
  test.skip(typeof session === "string", typeof session === "string" ? session : "");
  if (typeof session === "string") return;
  await routeFonts(page);
  await signIn(page.context(), baseURL!, session);
  const me = await page.request.get("/api/platform/me");
  const on = me.status() === 200 && ((await me.json()) as { flags: { onboarding?: boolean } }).flags.onboarding === true;
  test.skip(!on, "Onboarding is off here.");
}

async function open(page: Page, path: string) {
  const response = await page.goto(path);
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready);
  return response;
}

const main = (page: Page) => page.locator("main");
const status = (page: Page, kind: string, role: string) => page.locator(`[data-onboarding-status="${kind}"][data-role="${role}"]`);
const invitation = (page: Page) => page.locator("[data-cohort-invitation]");
const prompt = (page: Page) => page.locator("[data-onboarding-prompt]");
const sidebar = (page: Page) => page.locator("#space-sidebar");
const tabs = (page: Page) => page.getByRole("navigation", { name: "Spaces" }).first();

/** Nothing scrolls sideways at any width. */
async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
}

/** The sidebar's links, wherever the shell keeps them at this width. */
async function sidebarLabels(page: Page): Promise<string[]> {
  return sidebar(page).locator("a").evaluateAll((links) => links.map((link) => link.textContent?.replace(/\s+/g, " ").trim() ?? ""));
}

test.describe("landings, as SPEC §3 maps them", () => {
  test("just looking around: a welcome in place of the first contribution prompt, and the cohort invitation stays", async ({ page, baseURL }) => {
    await as(page, baseURL, "onb-wairimu");
    await open(page, "/dashboard");
    expect(new URL(page.url()).pathname).toBe("/dashboard/community");
    const welcome = page.locator("[data-onboarding-welcome]");
    await expect(welcome.getByRole("heading", { name: "Welcome to the community" })).toBeVisible();
    await expect(welcome.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/dashboard/account#taking-part");
    await expect(invitation(page)).toBeVisible();
    await expect(main(page).getByText("Add a contribution")).toBeVisible();
    await expect(main(page).getByText("Your first contribution belongs here.")).toHaveCount(0);
    expect(await sidebarLabels(page)).toContain("Apply to a cohort");
    await noSideways(page);
    await page.screenshot({ path: evidence("exploring") });
    await runAxe(page, test.info(), "community, just looking around");
  });

  test("member and mentor, pending: the Pending card above the cohort card, and Your requests (screen 03)", async ({ page, baseURL }) => {
    await as(page, baseURL, "onb-mercy");
    await open(page, "/dashboard/community");
    const pending = status(page, "pending", "MENTOR");
    await expect(pending.getByRole("heading", { name: "Your mentor request is with the team" })).toBeVisible();
    await expect(pending).toContainText("An administrator reads each request. The decision will appear here and under Attention.");
    await expect(pending).toContainText("Sent 1 Nov 2026");
    await expect(pending).toContainText("Mentoring opens as a new space once approved");
    await expect(pending.getByRole("link", { name: /^View request/ })).toHaveAttribute("href", "/dashboard/account#taking-part");
    // Pending sits above the member's cohort card, which stays: she chose to build and learn too.
    const [pendingBox, inviteBox] = [await pending.boundingBox(), await invitation(page).boundingBox()];
    expect(pendingBox!.y).toBeLessThan(inviteBox!.y);
    const labels = await sidebarLabels(page);
    expect(labels).toEqual(expect.arrayContaining(["Your journey", "Apply to a cohort", "Mentor access, Pending"]));
    // On a phone the sidebar waits in its closed drawer, so this reads the link itself rather than its role.
    await expect(sidebar(page).locator("a", { hasText: "Mentor access" })).toHaveAttribute("href", "/dashboard/account#taking-part");
    // A request is not access: no Mentoring tab.
    await expect(tabs(page).getByRole("link", { name: /Mentoring/ })).toHaveCount(0);
    await noSideways(page);
    await page.screenshot({ path: evidence("member-mentor-pending") });
  });

  test("mentor pending sees Pending, and none of the student framing (QA1-08)", async ({ page, baseURL }) => {
    await as(page, baseURL, "onb-otieno");
    await open(page, "/dashboard");
    expect(new URL(page.url()).pathname).toBe("/dashboard/community");
    await expect(status(page, "pending", "MENTOR")).toBeVisible();
    await expect(invitation(page)).toHaveCount(0);
    await expect(main(page).getByText(/Apply to Cohort|Find your next cohort/)).toHaveCount(0);
    await expect(main(page).getByText("Your first contribution belongs here.")).toHaveCount(0);
    // Their own work is fully usable, under its own name.
    await expect(main(page).getByRole("heading", { level: 2, name: "Your own work" })).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Add a contribution" })).toBeEnabled();
    const labels = await sidebarLabels(page);
    expect(labels).not.toContain("Apply to a cohort");
    expect(labels).toContain("Your own work");
    expect(labels).toContain("Mentor access, Pending");
    await expect(page).toHaveTitle(/^Community/);
    await expect(tabs(page).getByRole("link", { name: /Mentoring/ })).toHaveCount(0);
    await noSideways(page);
    await page.screenshot({ path: evidence("mentor-pending") });
    await runAxe(page, test.info(), "community, mentor pending");
  });

  test("organisation pending: Pending, where to read about Discover meanwhile, and no Discover tab", async ({ page, baseURL }) => {
    await as(page, baseURL, "onb-njambi");
    await open(page, "/dashboard");
    expect(new URL(page.url()).pathname).toBe("/dashboard/community");
    const pending = status(page, "pending", "INSTITUTION");
    await expect(pending.getByRole("heading", { name: "Your organisation request is with the team" })).toBeVisible();
    await expect(pending).toContainText("Meanwhile, the public For institutions page explains what Discover does.");
    await expect(pending.getByRole("link", { name: "For institutions" })).toHaveAttribute("href", "/community/institutions");
    await expect(pending).toContainText("Discover opens as a new space once approved");
    await expect(invitation(page)).toHaveCount(0);
    expect(await sidebarLabels(page)).toContain("Organisation access, Pending");
    await expect(tabs(page).getByRole("link", { name: /Discover/ })).toHaveCount(0);
    expect((await page.request.get("/dashboard/discover", { maxRedirects: 0 })).status()).toBe(403);
    await noSideways(page);
    await page.screenshot({ path: evidence("institution-pending") });
    await runAxe(page, test.info(), "community, organisation pending");
  });

  test("declined: the administrator's message as plain text, still a member, and a way to ask again", async ({ page, baseURL }) => {
    await as(page, baseURL, "onb-daniel");
    await open(page, "/dashboard/community");
    const declined = status(page, "declined", "MENTOR");
    await expect(declined.getByRole("heading", { name: "Mentor access wasn’t approved this time." })).toBeVisible();
    // Request text is untrusted: markup in it is shown, never rendered.
    await expect(declined.locator("[data-decision-message]")).toHaveText("“Thanks for offering, Daniel. <b>We can’t add this right now.</b>”");
    await expect(declined.locator("b")).toHaveCount(0);
    await expect(declined).toContainText("You can still take part as a member, and you can send a new request later.");
    await expect(declined).not.toContainText("Amina");
    await noSideways(page);
    await page.screenshot({ path: evidence("declined") });
    await runAxe(page, test.info(), "community, declined");
    // Asking again goes to the request step for mentor access alone (it posts, so it works without a script).
    await declined.getByRole("button", { name: /^Send a new request/ }).click();
    await page.waitForURL(/\/dashboard\/welcome\?step=request&role=mentor$/);
    await expect(page.getByRole("heading", { level: 1, name: "A few details for the team" })).toBeVisible();
    await expect(page.getByLabel("What kind of work could you review?")).toBeVisible();
    await expect(page.getByLabel("Organisation name")).toHaveCount(0);
  });

  test("approved: /dashboard opens Mentoring, Community announces it until dismissed, then Your spaces", async ({ page, baseURL }) => {
    test.skip(!desktop(), "Writes Kevin's state: one project.");
    await as(page, baseURL, "onb-kevin");
    await open(page, "/dashboard/community");
    const approved = status(page, "approved", "MENTOR");
    if (await approved.count() > 0) {
      await expect(approved.getByRole("heading", { name: "Mentoring is open" })).toBeVisible();
      await expect(approved).toContainText("Mentoring is now one of your spaces. Start with Confirm work.");
      await expect(approved.getByRole("link", { name: "Open Mentoring" })).toHaveAttribute("href", "/dashboard/mentoring");
      await page.screenshot({ path: evidence("approved") });
      await runAxe(page, test.info(), "community, approved");
      await approved.getByRole("button", { name: /^Dismiss/ }).click();
      await page.waitForURL((url) => url.pathname === "/dashboard/community");
    } else {
      test.info().annotations.push({ type: "rerun", description: "Kevin dismissed the approval in an earlier run: reseed to replay it." });
    }
    await expect(approved).toHaveCount(0);
    const spaces = page.locator("[data-onboarding-spaces]");
    await expect(spaces).toContainText("Mentoring is open to you. Community keeps your own work.");
    await spaces.getByRole("link", { name: "Open Mentoring" }).click();
    await page.waitForURL((url) => url.pathname === "/dashboard/mentoring");
    // The space it opened never repeats the announcement.
    await expect(page.locator("[data-onboarding-status]")).toHaveCount(0);
    const context = await page.context().browser()!.newContext();
    const fresh = await context.newPage();
    await routeFonts(fresh);
    await signIn(context, baseURL!, localPersonaSession("onb-kevin") as { token: string; secret: string });
    await fresh.goto("/dashboard");
    expect(new URL(fresh.url()).pathname).toBe("/dashboard/mentoring");
    await context.close();
  });

  for (const [name, persona, space, open_] of [
    ["an existing mentor with no choice saved", "mentor", "/dashboard/mentoring", "Open Mentoring"],
    ["an existing institution with no choice saved", "institution", "/dashboard/discover", "Open Discover"],
  ] as const) {
    test(`${name} reaches their space in one click from Community, with no Apply prompt`, async ({ page, baseURL }) => {
      const session = personaSession(persona);
      test.skip(typeof session === "string" || PREVIEW, "The local seed's browser sessions only.");
      if (typeof session === "string") return;
      await routeFonts(page);
      await signIn(page.context(), baseURL!, session);
      await open(page, "/dashboard/community");
      test.skip(await page.locator("[data-onboarding-spaces]").count() === 0 && !(await (await page.request.get("/api/platform/me")).json()).flags.onboarding, "Onboarding is off here.");
      await expect(invitation(page)).toHaveCount(0);
      expect(await sidebarLabels(page)).not.toContain("Apply to a cohort");
      await expect(main(page).getByText("Your first contribution belongs here.")).toHaveCount(0);
      const link = page.locator("[data-onboarding-spaces]").getByRole("link", { name: open_ });
      await expect(link).toHaveAttribute("href", space);
      await link.click();
      await page.waitForURL((url) => url.pathname === space);
    });
  }
});

test.describe("the one-time card for existing accounts (S4)", () => {
  test("is prefilled from the cohort, readable and accessible on the landing page (screen 04)", async ({ page, baseURL }) => {
    const session = personaSession("alumna");
    test.skip(typeof session === "string" || PREVIEW, "The local seed's browser sessions only.");
    if (typeof session === "string") return;
    await routeFonts(page);
    await signIn(page.context(), baseURL!, session);
    await open(page, "/dashboard");
    expect(new URL(page.url()).pathname).toBe("/dashboard/cohort");
    const card = prompt(page);
    test.skip(await card.count() === 0, "Onboarding is off here.");
    await expect(card.getByRole("heading", { name: "How do you take part now?" })).toBeVisible();
    await expect(card).toContainText("We use this to choose where you start and what we suggest.");
    if (desktop()) {
      await expect(card.getByRole("checkbox", { name: /^Build and learn/ })).toBeChecked();
      await expect(card.getByRole("checkbox", { name: /^Mentor/ })).not.toBeChecked();
      await expect(card.getByRole("checkbox", { name: /^Find people for your organisation/ })).not.toBeChecked();
      await expect(card.getByRole("button", { name: "Choose" })).toBeHidden();
    } else {
      // Compact on a phone, so the page's own task stays above the fold; Choose opens the toggles.
      await expect(card.getByRole("checkbox", { name: /^Build and learn/ })).toBeHidden();
      await expect(card.getByRole("button", { name: "Save" })).toBeHidden();
      const choose = card.getByRole("button", { name: "Choose" });
      await expect(choose).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByTestId("student-next-step")).toBeInViewport();
      await page.screenshot({ path: evidence("existing-prompt-compact") });
      await choose.click();
      await expect(card.getByRole("checkbox", { name: /^Build and learn/ })).toBeFocused();
      await expect(card.getByRole("checkbox", { name: /^Build and learn/ })).toBeChecked();
      await expect(card.getByRole("button", { name: "Save" })).toBeVisible();
    }
    await noSideways(page);
    await page.screenshot({ path: evidence("existing-prompt") });
    await runAxe(page, test.info(), "cohort, existing account card");
  });

  test("an existing alumna skips it, and it stays gone", async ({ page, baseURL }) => {
    test.skip(!desktop(), "Writes Faith's state: one project.");
    await as(page, baseURL, "onb-faith");
    await open(page, "/dashboard");
    expect(new URL(page.url()).pathname).toBe("/dashboard/cohort");
    if (await prompt(page).count() > 0) {
      await prompt(page).getByRole("button", { name: "Not now" }).click();
      await page.waitForURL((url) => url.pathname === "/dashboard/cohort");
    } else {
      test.info().annotations.push({ type: "rerun", description: "Faith skipped the card in an earlier run: reseed to replay it." });
    }
    await expect(prompt(page)).toHaveCount(0);
    for (const path of ["/dashboard/cohort", "/dashboard/community", "/dashboard"]) {
      await open(page, path);
      await expect(prompt(page), path).toHaveCount(0);
    }
    // Nothing she had changed: she is still framed as a member, and can still choose in Account.
    await open(page, "/dashboard/community");
    await expect(page.locator("[data-onboarding-welcome]")).toHaveCount(0);
    await open(page, "/dashboard/account");
    await expect(page.getByRole("switch", { name: "Build and learn" })).toHaveAttribute("aria-checked", "true");
  });

  test("Save with Mentor ticked goes on to the request step, which asks about mentoring", async ({ page, baseURL }) => {
    test.skip(!desktop(), "Writes Grace's state: one project.");
    await as(page, baseURL, "onb-grace");
    await open(page, "/dashboard/cohort");
    test.skip(await prompt(page).count() === 0, "Grace saved her choices in an earlier run: reseed to replay.");
    await prompt(page).locator("label[data-intent='mentor']").click();
    await expect(prompt(page).getByRole("checkbox", { name: /^Mentor/ })).toBeChecked();
    await prompt(page).getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/\/dashboard\/welcome\?step=request$/);
    await expect(page.getByRole("heading", { level: 1, name: "A few details for the team" })).toBeVisible();
    await expect(page.getByLabel("What kind of work could you review?")).toBeVisible();
    // Choosing asked; it granted nothing.
    const me = (await (await page.request.get("/api/platform/me")).json()) as { spaces: string[] };
    expect(me.spaces).not.toContain("mentoring");
  });
});

test.describe("Account → How you take part (S5)", () => {
  test("shows each access in the one state its request and role are in (screen 05)", async ({ page, baseURL }) => {
    await as(page, baseURL, "onb-otieno");
    await open(page, "/dashboard/account#taking-part");
    const section = page.locator("[data-taking-part]");
    await expect(section.getByRole("heading", { name: "How you take part" })).toBeVisible();
    await expect(section).toContainText("This shapes where you start and what we suggest. It never grants access by itself.");
    await expect(section.getByRole("switch", { name: "Build and learn" })).toHaveAttribute("aria-checked", "false");
    const mentor = section.locator("[data-taking-part-row='MENTOR']");
    await expect(mentor).toHaveAttribute("data-state", "pending");
    await expect(mentor).toContainText("Request sent 1 Nov 2026. An administrator will review it.");
    await expect(mentor.getByRole("button", { name: /^Withdraw request/ })).toBeVisible();
    const organisation = section.locator("[data-taking-part-row='INSTITUTION']");
    await expect(organisation).toHaveAttribute("data-state", "none");
    await expect(organisation.getByRole("button", { name: /^Request access/ })).toBeVisible();
    await expect(page.getByText("Access the team has approved stays on until an administrator removes it.")).toBeVisible();
    await noSideways(page);
    await page.screenshot({ path: evidence("account-pending") });
    await runAxe(page, test.info(), "account, how you take part");
  });

  test("a decline offers a new request and lets the choice go", async ({ page, baseURL }) => {
    await as(page, baseURL, "onb-daniel");
    await open(page, "/dashboard/account");
    const mentor = page.locator("[data-taking-part-row='MENTOR']");
    await expect(mentor).toHaveAttribute("data-state", "declined");
    await expect(mentor).toContainText("Mentor access wasn’t approved this time.");
    await expect(mentor.getByRole("button", { name: /^Send a new request/ })).toBeVisible();
    await expect(mentor.getByRole("button", { name: /^Remove/ })).toBeVisible();
    await noSideways(page);
    await page.screenshot({ path: evidence("account-declined") });
    await runAxe(page, test.info(), "account, declined");
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("withdraws a request, which leaves Community and the sidebar, and switches Build and learn", async ({ page, baseURL }) => {
      test.skip(!desktop(), "Writes Amani's state: one project.");
      await as(page, baseURL, "onb-amani");
      await open(page, "/dashboard/account");
      const mentor = page.locator("[data-taking-part-row='MENTOR']");
      if (await mentor.getAttribute("data-state") === "pending") {
        await mentor.getByRole("button", { name: /^Withdraw request/ }).click();
        await page.waitForURL((url) => url.pathname === "/dashboard/account");
      } else {
        test.info().annotations.push({ type: "rerun", description: "Amani withdrew in an earlier run: reseed to replay it." });
      }
      await expect(mentor).toHaveAttribute("data-state", "none");
      await open(page, "/dashboard/community");
      await expect(page.locator("[data-onboarding-status]")).toHaveCount(0);
      expect(await sidebarLabels(page)).not.toContain("Mentor access, Pending");

      await open(page, "/dashboard/account");
      const member = page.getByRole("switch", { name: "Build and learn" });
      await expect(member).toHaveAttribute("aria-checked", "true");
      await member.click();
      await page.waitForURL((url) => url.pathname === "/dashboard/account");
      await expect(page.getByRole("switch", { name: "Build and learn" })).toHaveAttribute("aria-checked", "false");
      await expect(page.locator("[data-taking-part-exploring]")).toHaveText("Just looking around for now");
      await page.getByRole("switch", { name: "Build and learn" }).click();
      await page.waitForURL((url) => url.pathname === "/dashboard/account");
      await expect(page.getByRole("switch", { name: "Build and learn" })).toHaveAttribute("aria-checked", "true");
    });

    test("Request access asks about that access alone, even beside a declined one", async ({ page, baseURL }) => {
      test.skip(!desktop(), "Writes Daniel's choices: one project.");
      await as(page, baseURL, "onb-daniel");
      await open(page, "/dashboard/account");
      await page.locator("[data-taking-part-row='INSTITUTION']").getByRole("button", { name: /^Request access/ }).click();
      await page.waitForURL(/\/dashboard\/welcome\?step=request&role=institution$/);
      await expect(page.getByLabel("Organisation name")).toBeVisible();
      // His declined mentor request could be sent again, but this step does not ask about it.
      await expect(page.getByLabel("What kind of work could you review?")).toHaveCount(0);
    });
  });
});

test.describe("where onboarding does not apply", () => {
  test("a preview persona's landing pages carry none of it, and its forms do not exist", async ({ page, baseURL }) => {
    const session = personaSession("community");
    test.skip(typeof session === "string", typeof session === "string" ? session : "");
    // Locally the persona is an ordinary browser session with onboarding on; previews seed agent sessions.
    test.skip(!PREVIEW, "Previews only: their personas are agents' delegated sessions.");
    if (typeof session === "string") return;
    await signIn(page.context(), baseURL!, session);
    for (const path of ["/dashboard/community", "/dashboard/account"]) {
      const response = await open(page, path);
      if (response?.status() !== 200) continue;
      await expect(page.locator("[data-onboarding-notices], [data-onboarding-prompt], [data-taking-part]"), path).toHaveCount(0);
    }
    const posted = await page.request.post("/dashboard/account", {
      form: { onboarding: "dismiss-prompt", return: "/dashboard/community" },
      headers: { Origin: new URL(baseURL!).origin },
      maxRedirects: 0,
    });
    expect([403, 404]).toContain(posted.status());
  });
});
