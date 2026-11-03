import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";

/**
 * The prototype-vs-live visual tweaks whose behaviour a browser has to see (T03, T04, T05, T06, T09, T10, T12, T13;
 * Library /reports/platform-visual-review-2026-11-03/), on the DEV-only harnesses: a masked contact
 * marker in a mentor's request card, the directory's filter menus, a failed send's reason in the drawer, the accepted request's notice, where a thread opens, where
 * "Jump to latest" stands, and the phone's bar on the attention page. Unit tests cover the markup.
 */
test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The harnesses are dev-only and unavailable on deployed environments.");
test.use({ reducedMotion: "reduce" });

const MARKER = "[contact details hidden until a moderator checks this message]";
const NOTE = "Contact details hidden until a moderator checks this message";
const COMMUNITY_THREAD = "s00000000000000000000401";

const wide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

test("T03: a mentor's request card shows masked contact details as the channels' note, axe clean", async ({ page }, testInfo) => {
  await open(page, "/dev/platform-mentors?persona=david&view=requests&note=masked");
  const quote = page.locator("main [data-mentor-request] blockquote").first();
  await expect(quote.locator(".channel-masked[role=note]")).toHaveText(NOTE);
  await expect(quote).not.toContainText(MARKER);
  await runAxe(page, testInfo, "request-masked");
});

test("T06: both filter menus open inside the screen and the filter row, from 320 to 1440 px (B1)", async ({ page }) => {
  await open(page, "/dev/platform-mentors?persona=wanjiku&view=directory");
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const menu of await page.locator("[data-mentor-filters] details[data-filter-menu]").all()) {
      await menu.locator("summary").click();
      const list = menu.locator(".mentor-filter-menu__list");
      await expect(list).toBeVisible();
      const [box, row] = [await list.boundingBox(), await page.locator("[data-mentor-filters]").boundingBox()];
      expect(box!.x, `${width}px`).toBeGreaterThanOrEqual(Math.max(0, row!.x - 1));
      expect(box!.x + box!.width, `${width}px`).toBeLessThanOrEqual(Math.min(width, row!.x + row!.width + 1));
      await page.keyboard.press("Escape");
      await expect(list).toBeHidden();
    }
  }
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`T05: Send, and the habits it agrees to, are in view together in the drawer at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await open(page, "/dev/platform-mentors?persona=wanjiku&view=directory&conduct=required");
    await page.locator("[data-mentor-card]", { hasText: "Joseph Mutua" }).getByRole("link", { name: "Ask for time" }).click();
    const drawer = page.locator("dialog[data-mentor-drawer]");
    const send = drawer.getByRole("button", { name: "Agree and send request" });
    await expect(send).toBeInViewport();
    await expect(drawer.getByRole("heading", { name: "Before you send: how we talk to each other" })).toBeInViewport();
    await expect(drawer.getByRole("link", { name: "Read how we talk to each other" })).toBeInViewport();
    await expect(drawer.getByRole("button", { name: "Cancel" }).or(drawer.getByRole("link", { name: "Cancel" }))).toBeInViewport();
    // With the note scrolled to its end, the habits and Send stay together at the drawer's bottom edge.
    await drawer.locator(".mentor-drawer__sheet").evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(send).toBeInViewport();
    await expect(drawer.getByRole("heading", { name: "Before you send: how we talk to each other" })).toBeInViewport();
    await runAxe(page, testInfo, `drawer-conduct-${viewport.width}`);
  });
}

// B1 (re-review): on a short screen the pinned edges let go, so the note being written stays in view,
// and the habits still come straight before Send.
for (const viewport of [{ width: 844, height: 390 }, { width: 640, height: 360 }]) {
  test(`T05: the note being written stays in view on a short screen (${viewport.width}x${viewport.height}), habits just before Send`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await open(page, "/dev/platform-mentors?persona=wanjiku&view=directory&conduct=required");
    await page.locator("[data-mentor-card]", { hasText: "Joseph Mutua" }).getByRole("link", { name: "Ask for time" }).click();
    const drawer = page.locator("dialog[data-mentor-drawer]");
    const note = drawer.getByRole("textbox", { name: "What would you like help with?" });
    await note.focus();
    await page.keyboard.type("Could you look at how my route planner saves trips when the phone is offline?");
    await expect(note).toBeInViewport();
    // Nothing covers it: the point at its centre is the field itself.
    expect(await note.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === el;
    })).toBe(true);
    const send = drawer.getByRole("button", { name: "Agree and send request" });
    await send.scrollIntoViewIfNeeded();
    await expect(send).toBeInViewport();
    await expect(drawer.getByRole("heading", { name: "Before you send: how we talk to each other" })).toBeInViewport();
  });
}

// B1 (second re-review): every control in the drawer, reached from the keyboard, scrolls clear of the
// pinned header and footer: the point at its centre is the control itself (WCAG 2.4.11).
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 640, height: 360 }]) {
  for (const conduct of ["required", "agreed"]) {
    test(`T05: no control is under the drawer's pinned edges when focused (${viewport.width}x${viewport.height}, conduct ${conduct})`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await open(page, `/dev/platform-mentors?persona=wanjiku&view=directory${conduct === "required" ? "&conduct=required" : ""}`);
      await page.locator("[data-mentor-card]", { hasText: "Joseph Mutua" }).getByRole("link", { name: "Ask for time" }).click();
      await expect(page.locator("dialog[data-mentor-drawer] textarea")).toBeFocused();
      const covered: string[] = [];
      const seen = new Set<string>();
      for (let step = 0; step < 30; step++) {
        const result = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || !el.closest("dialog[data-mentor-drawer]")) return null;
          const box = el.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          const name = `${el.tagName.toLowerCase()}:${(el.textContent || el.getAttribute("aria-label") || (el as HTMLInputElement).value || "").trim().slice(0, 40)}`;
          return { name, clear: hit !== null && (hit === el || el.contains(hit) || hit.contains(el) && hit.tagName === "LABEL") };
        });
        if (!result || seen.has(result.name)) break;
        seen.add(result.name);
        if (!result.clear) covered.push(result.name);
        await page.keyboard.press("Tab");
      }
      expect(seen.size, "the drawer has controls to walk").toBeGreaterThan(4);
      expect(covered).toEqual([]);
    });
  }
}

// T13 (#317's late B1): a send that fails says why just above Send, in the pinned footer, so the person who
// pressed it sees it whether the drawer sits at its start or its end, and nothing covers it.
for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  for (const conduct of ["required", "agreed"] as const) {
    test(`T13: a failed send's reason is in view and uncovered above Send (${viewport.width}x${viewport.height}, conduct ${conduct})`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      const path = `/dev/platform-mentors?persona=wanjiku&view=directory${conduct === "required" ? "&conduct=required" : ""}`;
      await open(page, path);
      // Agreeing posts the page's own conduct form; sending once agreed goes to the harness's API. Both fail.
      await page.route((url) => url.pathname === "/dev/platform-mentors", (route) =>
        route.request().method() === "POST" ? route.fulfill({ status: 500, body: "" }) : route.continue());
      await page.waitForFunction(() => typeof window.__mentorsHarness?.refuseWrites === "function");
      await page.evaluate(() => window.__mentorsHarness!.refuseWrites(1, 503, "server"));
      await page.locator("[data-mentor-card]", { hasText: "Joseph Mutua" }).getByRole("link", { name: "Ask for time" }).click();
      const drawer = page.locator("dialog[data-mentor-drawer]");
      const note = drawer.getByRole("textbox", { name: "What would you like help with?" });
      await note.fill("Could you look at how my route planner saves trips when the phone is offline?");
      const send = drawer.getByRole("button", { name: conduct === "required" ? "Agree and send request" : "Send request" });
      await send.click();

      const error = drawer.locator("[data-request-error]");
      await expect(error).toHaveText(conduct === "required"
        ? "Your agreement wasn't saved, so your request wasn't sent. Try again in a moment. Your note is kept."
        : "Your request wasn't sent. Try again in a moment. Your note is kept.");
      const uncovered = () => error.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return hit !== null && el.contains(hit);
      });
      for (const at of ["start", "end"] as const) {
        await drawer.locator(".mentor-drawer__sheet").evaluate((el, end) => el.scrollTo({ top: end ? el.scrollHeight : 0 }), at === "end");
        await expect(error, at).toBeInViewport({ ratio: 1 });
        expect(await uncovered(), `the point at the error's centre is the error (${at})`).toBe(true);
        await expect(send, at).toBeInViewport();
      }
      // It is read out as it appears.
      await expect(error).toHaveRole("alert");
      // The note is kept, and Send has focus and is ready for a retry.
      await expect(note).toHaveValue("Could you look at how my route planner saves trips when the phone is offline?");
      await expect(send).toBeFocused();
      await expect(send).toBeEnabled();
      await expect(send).not.toHaveAttribute("aria-disabled", "true");
      await runAxe(page, testInfo, `drawer-error-${viewport.width}-${conduct}`);
    });
  }
}

// On a short screen the footer scrolls with the form, so the drawer brings the reason and Send back into view.
for (const viewport of [{ width: 844, height: 390 }, { width: 640, height: 360 }]) {
  for (const conduct of ["required", "agreed"] as const) {
    test(`T13: on a short screen (${viewport.width}x${viewport.height}, conduct ${conduct}) a failed send's reason and Send are both in view`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await open(page, `/dev/platform-mentors?persona=wanjiku&view=directory${conduct === "required" ? "&conduct=required" : ""}`);
      await page.route((url) => url.pathname === "/dev/platform-mentors", (route) =>
        route.request().method() === "POST" ? route.fulfill({ status: 500, body: "" }) : route.continue());
      await page.waitForFunction(() => typeof window.__mentorsHarness?.refuseWrites === "function");
      await page.evaluate(() => window.__mentorsHarness!.refuseWrites(1, 503, "server"));
      await page.locator("[data-mentor-card]", { hasText: "Joseph Mutua" }).getByRole("link", { name: "Ask for time" }).click();
      const drawer = page.locator("dialog[data-mentor-drawer]");
      await drawer.getByRole("textbox", { name: "What would you like help with?" }).fill("Could you look at how my route planner saves trips when the phone is offline?");
      const send = drawer.getByRole("button", { name: conduct === "required" ? "Agree and send request" : "Send request" });
      await send.click();
      const error = drawer.locator("[data-request-error]");
      await expect(error).toBeVisible();
      await expect(error).toBeInViewport({ ratio: 1 });
      await expect(send).toBeInViewport({ ratio: 1 });
      await expect(send).toBeFocused();
    });
  }
}

// The server asks for the habits after all (their words changed), and agreeing from that step fails: the step,
// and the button that had focus, give way to the form, and Send takes focus back with the reason in view.
for (const viewport of [{ width: 1440, height: 900 }, { width: 640, height: 360 }]) {
  test(`T13: agreeing from the habits step fails, and Send has focus again beside the reason (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await open(page, "/dev/platform-mentors?persona=wanjiku&view=directory");
    await page.route((url) => url.pathname === "/dev/platform-mentors", (route) =>
      route.request().method() === "POST" ? route.fulfill({ status: 500, body: "" }) : route.continue());
    await page.waitForFunction(() => typeof window.__mentorsHarness?.refuseWrites === "function");
    await page.evaluate(() => window.__mentorsHarness!.refuseWrites(1, 403, "conduct_required"));
    await page.locator("[data-mentor-card]", { hasText: "Joseph Mutua" }).getByRole("link", { name: "Ask for time" }).click();
    const drawer = page.locator("dialog[data-mentor-drawer]");
    await drawer.getByRole("textbox", { name: "What would you like help with?" }).fill("Could you look at how my route planner saves trips when the phone is offline?");
    await drawer.getByRole("button", { name: "Send request" }).click();
    await drawer.getByRole("button", { name: "I agree, send my request" }).click();
    const error = drawer.locator("[data-request-error]");
    await expect(error).toHaveText("Your agreement wasn't saved, so your request wasn't sent. Try again in a moment. Your note is kept.");
    await expect(error).toBeInViewport({ ratio: 1 });
    const send = drawer.locator("[data-request-send]");
    await expect(send).toBeFocused();
    await expect(send).toBeInViewport({ ratio: 1 });
  });
}

// A refusal the page arrived with (posted before the island hydrated, or without JavaScript) opens on the note,
// focused and in view: the drawer only scrolls to Send after a send it made itself.
test("T13: on a short screen, a refusal the page arrived with keeps the focused note in view", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await open(page, "/dev/platform-mentors?persona=wanjiku&view=directory");
  // David already has a waiting request from Wanjiku, so asking him again is refused.
  const david = await page.locator("[data-mentor-card]", { hasText: "David Kamau" }).getAttribute("data-mentor-card");
  await Promise.all([
    page.waitForURL(/platform-mentors/),
    page.evaluate((mentorId) => {
      const form = document.createElement("form");
      form.method = "post";
      form.action = window.location.href;
      for (const [name, value] of Object.entries({ intent: "mentor-request", mentorId, note: "Could you look at my API's error responses?", format: "CALL_30_MIN" })) {
        const input = document.createElement("input");
        Object.assign(input, { type: "hidden", name, value });
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    }, david!),
  ]);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  const drawer = page.locator("dialog[data-mentor-drawer]");
  await expect(drawer.locator("[data-request-error]")).toBeVisible();
  const note = drawer.getByRole("textbox", { name: "What would you like help with?" });
  await expect(note).toHaveValue("Could you look at my API's error responses?");
  await expect(note).toBeFocused();
  await expect(note).toBeInViewport();
});

test("T04: an accepted request leads with the mentor and shows Open conversation, on the panel and the page", async ({ page }, testInfo) => {
  const accepted = (scope: ReturnType<Page["locator"]>) => scope.locator("[data-attention-item]").filter({ has: page.locator("[data-attention-action]") });
  await open(page, "/dev/platform-overlays?persona=wanjiku&page=attention");
  const row = accepted(page.locator("main"));
  await expect(row).toHaveCount(1);
  await expect(row.locator("strong")).toHaveText("David Kamau");
  await expect(row.locator("[data-attention-action]")).toHaveText("Open conversation");
  await expect(row.locator("[data-attention-action]")).toBeVisible();
  // The row is one link, to the conversation; the action is its words, not a second control.
  await expect(row.locator("a")).toHaveCount(1);
  await expect(row.locator("a")).toHaveAttribute("href", /^\/dashboard\/community\/dm\//);
  await runAxe(page, testInfo, "attention-page");
  if (!wide(page)) return;
  await open(page, "/dev/platform-overlays?persona=wanjiku");
  await page.getByRole("button", { name: /Needs your attention|attention/i }).first().click();
  const panel = page.locator("[data-attention-panel]");
  await expect(accepted(panel).locator("[data-attention-action]")).toBeVisible();
  await runAxe(page, testInfo, "attention-panel");
});

test.describe("T09: where a thread opens", () => {
  test.use({ viewport: { width: 1440, height: 560 } });

  test("at its latest reply, and at a linked reply when a link names one", async ({ page }) => {
    await open(page, `/dev/platform-channel?persona=wanjiku&channel=show-your-work&thread=${COMMUNITY_THREAD}`);
    const rail = page.locator("[data-thread-rail] [data-focus-home]");
    const replies = page.locator("[data-thread-rail] .channel-messages [data-message]");
    await expect(replies.last()).toBeInViewport();
    expect(await rail.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2);
    expect(await rail.evaluate((el) => el.scrollHeight > el.clientHeight + 40), "the thread is longer than its rail").toBe(true);

    const first = await replies.first().getAttribute("data-message");
    await open(page, `/dev/platform-channel?persona=wanjiku&channel=show-your-work&thread=${COMMUNITY_THREAD}&message=${first}`);
    await expect(replies.first()).toBeInViewport();
    await expect(replies.first()).toBeFocused();
  });
});

test("T10: Jump to latest stands on the list's bottom edge, at its end, compact on phones", async ({ page }) => {
  await open(page, "/dev/platform-channel?persona=wanjiku&channel=cohort-04");
  const scroller = page.locator("[data-channel-scroller]");
  const jump = page.locator("[data-jump-latest]");
  // Read from the top: the list measures where the reader is once it has settled, then offers the jump.
  await expect(async () => {
    await scroller.evaluate((el) => el.scrollTo({ top: 0 }));
    await expect(jump).toBeVisible({ timeout: 1_000 });
  }).toPass();
  const [button, list] = [await jump.boundingBox(), await scroller.boundingBox()];
  const end = list!.y + list!.height;
  // At the list's right end, below the middle of the messages: across its bottom edge on a wide sheet,
  // and on a phone just under it, where the list stops short while it shows, so it covers no words.
  expect(button!.x + button!.width).toBeGreaterThan(list!.x + list!.width * 0.75);
  expect(button!.y + button!.height).toBeGreaterThan(end);
  if (wide(page)) expect(button!.y).toBeLessThan(end);
  else expect(button!.y).toBeGreaterThanOrEqual(end - 1);
  await expect(jump).toHaveAccessibleName("Jump to latest");
  if (!wide(page)) expect(Math.round(button!.width)).toBe(44);
});

test("T12: the phone's bar marks no space current on the attention page", async ({ page }) => {
  await open(page, "/dev/platform-overlays?persona=wanjiku&page=attention");
  test.skip(wide(page), "The bottom bar is the phone's.");
  const bar = page.getByRole("navigation", { name: "Spaces" });
  await expect(bar.getByRole("link")).not.toHaveCount(0);
  await expect(bar.locator("[aria-current]")).toHaveCount(0);
});
