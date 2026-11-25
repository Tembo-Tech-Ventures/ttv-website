import type { Locator, Page, TestInfo } from "@playwright/test";
import { runAxe } from "./platform-axe";
import {
  agreeToConduct, assertive, expect, HOST, MEMBER, openCall, peopleUnavailable, polite, scheduleSession, test,
} from "./calls";

/**
 * The call room (in-app calls P5, src/lib/meetings/README.md "The room") on the fake provider, with
 * Chromium's fake camera and microphone, as a host and a member in two browser contexts, at 1440,
 * 390 and 320 px: the pre-join page, waiting for the host, joining by keyboard alone, the
 * announcements, a host removing the member and ending the session, and on every screen no
 * sideways scroll, axe at WCAG 2.2 AA and at most one peach action.
 *
 * Each test schedules its own session through the meetings API as the host, so tests never share a
 * call. The browsers, their fake media and the people in them come from the shared call set-up
 * (calls.ts, docs/meetings-testing.md).
 */

const WIDTHS = [1440, 390, 320] as const;

test.describe.configure({ mode: "parallel" });

/** Presses Tab until `target` has focus: the keyboard, never a click, reaches it. */
async function tabTo(page: Page, target: Locator, { back = false, max = 60 } = {}) {
  for (let step = 0; step < max; step++) {
    if (await target.evaluate((element) => element === document.activeElement).catch(() => false)) return;
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
  }
  const at = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120));
  throw new Error(`Tab never reached ${target}; focus is on ${at}`);
}

/** No sideways scroll, at most one peach action and axe clean, on the screen as it is now. */
async function screenChecks(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const facts = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--color-primary)";
    document.body.appendChild(probe);
    const peach = getComputedStyle(probe).color;
    probe.remove();
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 1 && box.height > 1 && style.visibility !== "hidden" && style.display !== "none" && !element.closest("[inert],[hidden]");
    };
    const controls = [...document.querySelectorAll("a[href],button,summary,[role=button]")].filter(visible);
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      peach: controls.filter((element) => getComputedStyle(element).backgroundColor === peach).map((element) => element.textContent?.trim()),
    };
  });
  expect(facts.overflow, `${name}: no sideways scroll`).toBeLessThanOrEqual(1);
  expect(facts.peach.length, `${name}: at most one peach action (${facts.peach.join(", ")})`).toBeLessThanOrEqual(1);
  await runAxe(page, testInfo, name);
}

test.beforeEach(({ baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Each width is set here, in the desktop project only.");
  const unavailable = peopleUnavailable([HOST, MEMBER]);
  test.skip(unavailable !== null, unavailable ?? "");
  test.skip(!baseURL, "No base URL.");
});

for (const width of WIDTHS) {
  test(`a host starts a session and a member joins, removed and ended, by keyboard at ${width}px`, async ({ people: open }, testInfo) => {
    test.setTimeout(180_000);
    const [host, member] = await open([HOST, MEMBER], { width });
    const hostPage = host.page;
    const memberPage = member.page;
    await agreeToConduct(hostPage);
    await agreeToConduct(memberPage);
    const title = `Calls check ${width} ${Date.now().toString(36)}`;
    const id = await scheduleSession(host, title);

    // The member arrives first: the session hasn't started, and Join says why it is off.
    await openCall(memberPage, id);
    await expect(memberPage.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(memberPage.getByText("A host hasn't started the session yet").first()).toBeVisible();
    const memberJoin = memberPage.locator("[data-call-join]");
    await expect(memberJoin).toBeDisabled();
    await expect(memberJoin).toHaveAccessibleDescription("A host hasn't started the session yet");
    await screenChecks(memberPage, testInfo, `waiting-${width}`);

    // The host's pre-join page: the recording notice before Start, and one peach action.
    await openCall(hostPage, id);
    await expect(hostPage.getByText("This session is recorded", { exact: true })).toBeVisible();
    await expect(hostPage.getByText(/Your voice, your camera if it's on, and anything you share are in the recording/)).toBeVisible();
    const start = hostPage.locator("[data-call-join]");
    await expect(start).toHaveText("Start session");
    await screenChecks(hostPage, testInfo, `prejoin-host-${width}`);

    // Start, by keyboard: the room takes focus at its h1, and the recording is said at once.
    await tabTo(hostPage, start);
    await hostPage.keyboard.press("Enter");
    await expect(hostPage.locator("[data-call-room]")).toBeVisible();
    await expect(hostPage.getByRole("heading", { level: 1, name: title })).toBeFocused();
    await expect(assertive(hostPage)).toHaveText("Recording started");
    await expect(hostPage.locator("header").getByText("Recording", { exact: true })).toBeVisible();
    await screenChecks(hostPage, testInfo, `room-host-${width}`);

    // The member's page sees the session open and says so; Join is the one peach action.
    await expect(polite(memberPage)).toHaveText("The session has started. You can join now.", { timeout: 20_000 });
    await expect(memberJoin).toBeEnabled();
    await expect(memberJoin).toHaveText("Join session");
    await expect(memberPage.getByText(/This session is being recorded, since \d\d:\d\d EAT/)).toBeVisible();
    await tabTo(memberPage, memberJoin);
    await memberPage.keyboard.press("Enter");
    await expect(memberPage.locator("[data-call-room]")).toBeVisible();
    await expect(memberPage.locator("[data-call-count]")).toHaveText("2 people", { timeout: 10_000 });
    await screenChecks(memberPage, testInfo, `room-member-${width}`);

    // The host hears the member arrive, politely, by name.
    await expect(polite(hostPage)).toHaveText(/ joined$/, { timeout: 15_000 });

    // The controls are one toolbar: Tab reaches it once ("Skip to call controls" first), arrows move in it.
    await hostPage.getByRole("heading", { level: 1, name: title }).focus();
    await hostPage.keyboard.press("Shift+Tab");
    const skip = hostPage.getByRole("link", { name: "Skip to call controls" });
    await expect(skip).toBeFocused();
    const mute = hostPage.getByRole("toolbar", { name: "Call controls" }).getByRole("button", { name: "Mute", exact: true });
    await tabTo(hostPage, mute);
    await hostPage.keyboard.press("ArrowRight");
    await hostPage.keyboard.press("ArrowRight");
    await hostPage.keyboard.press("ArrowRight");
    const people = hostPage.getByRole("button", { name: "People", exact: true });
    await expect(people).toBeFocused();
    await hostPage.keyboard.press("Enter");
    const panel = hostPage.locator("[data-call-panel=people]");
    await expect(panel.getByRole("heading", { level: 2, name: "People · 2" })).toBeFocused();
    await screenChecks(hostPage, testInfo, `people-${width}`);

    // Escape closes the panel (never the call) and gives focus back to its button.
    await hostPage.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(people).toBeFocused();
    await expect(hostPage.locator("[data-call-room]")).toBeVisible();

    // The host removes the member, by keyboard, after a confirm.
    await hostPage.keyboard.press("Enter");
    const actions = panel.getByRole("button", { name: /^Actions for / });
    await tabTo(hostPage, actions);
    await hostPage.keyboard.press("Enter");
    await hostPage.getByRole("menuitem", { name: "Remove from session" }).focus();
    await hostPage.keyboard.press("Enter");
    const confirm = hostPage.getByRole("dialog", { name: /^Remove .* from this session\?$/ });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await hostPage.keyboard.press("Tab");
    await expect(confirm.getByRole("button", { name: "Remove", exact: true })).toBeFocused();
    await hostPage.keyboard.press("Enter");

    // The member's tab shows the removed page with focus on its h1, and says it at once.
    const removed = memberPage.getByRole("heading", { level: 1, name: "A host removed you from this session" });
    await expect(removed).toBeFocused({ timeout: 15_000 });
    await expect(assertive(memberPage)).toHaveText("A host removed you from this session");
    await screenChecks(memberPage, testInfo, `removed-${width}`);

    // The host ends the session: the dialog starts at "Keep going", and Escape keeps the call.
    // The panel comes after the controls: Shift+Tab enters the toolbar at the control used last
    // (People), and End moves to its last, Leave or end.
    const leave = hostPage.getByRole("button", { name: "Leave or end", exact: true });
    await tabTo(hostPage, people, { back: true });
    await hostPage.keyboard.press("End");
    await expect(leave).toBeFocused();
    await hostPage.keyboard.press("Enter");
    const end = hostPage.getByRole("dialog", { name: `End ${title} for everyone?` });
    await expect(end.getByRole("button", { name: "Keep going", exact: true })).toBeFocused();
    await expect(end.getByRole("button", { name: "Just leave", exact: true })).toHaveCount(0);
    await screenChecks(hostPage, testInfo, `end-dialog-${width}`);
    await hostPage.keyboard.press("Escape");
    await expect(end).toBeHidden();
    await expect(leave).toBeFocused();
    await hostPage.keyboard.press("Enter");
    await hostPage.keyboard.press("Tab");
    await expect(end.getByRole("button", { name: "End for everyone", exact: true })).toBeFocused();
    await hostPage.keyboard.press("Enter");
    const ended = hostPage.getByRole("heading", { level: 1, name: `${title} has ended` });
    await expect(ended).toBeFocused({ timeout: 15_000 });
    await expect(hostPage.getByText("A host ended the session. The recording will be in Sessions when it's ready.")).toBeVisible();
    await expect(assertive(hostPage)).toHaveText(`${title} has ended`);
    await screenChecks(hostPage, testInfo, `ended-${width}`);
  });
}

test("what only the provider causes is said: the connection, the recording, a host muting you", async ({ people }) => {
  test.setTimeout(90_000);
  const [host] = await people([HOST]);
  const { page } = host;
  await agreeToConduct(page);
  const id = await scheduleSession(host, `Calls states ${Date.now().toString(36)}`);
  await openCall(page, id);
  await page.locator("[data-call-join]").click();
  await expect(page.locator("[data-call-room]")).toBeVisible();
  await expect(assertive(page)).toHaveText("Recording started");

  await page.evaluate(() => window.__ttvFakeRoom!.simulateConnection("reconnecting"));
  await expect(assertive(page)).toHaveText("Connection lost. Trying to reconnect.");
  await expect(page.getByText("Reconnecting…")).toBeVisible();
  await page.evaluate(() => window.__ttvFakeRoom!.simulateConnection("connected"));
  await expect(polite(page)).toHaveText("Connected again.");

  await page.evaluate(() => window.__ttvFakeRoom!.simulateRecording("failed"));
  await expect(assertive(page)).toHaveText("Recording stopped working. The session carries on, but the rest isn't being recorded.");
  await expect(page.locator("header").getByText("Recording stopped working")).toBeVisible();

  await page.evaluate(() => window.__ttvFakeRoom!.simulateNotice("muted-by-host"));
  await expect(assertive(page)).toHaveText("A host muted you. You can unmute yourself.");
  await expect(page.getByRole("button", { name: "Unmute", exact: true })).toBeVisible();

  // Leaving gives the seat back and the page says so.
  await page.getByRole("button", { name: "Leave or end", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "End for everyone", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /has ended$/ })).toBeFocused();
});

test("a phone that can't share a screen says so, and a blocked camera offers joining without it, at 320px", async ({ people }, testInfo) => {
  test.setTimeout(90_000);
  // A phone browser: no screen sharing, and a camera the browser blocked.
  const [host] = await people([HOST], {
    width: 320,
    init: () => {
      const media = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: unknown };
      Object.defineProperty(media, "getDisplayMedia", { value: undefined });
      const getUserMedia = media.getUserMedia.bind(media);
      media.getUserMedia = (constraints) => constraints?.video
        ? Promise.reject(new DOMException("Blocked", "NotAllowedError"))
        : getUserMedia(constraints);
    },
  });
  const { page } = host;
  await agreeToConduct(page);
  const id = await scheduleSession(host, `Calls phone ${Date.now().toString(36)}`);
  await openCall(page, id);
  await expect(page.getByText("TTV can't use your camera")).toBeVisible();
  await screenChecks(page, testInfo, "camera-blocked-320");
  await page.getByRole("button", { name: "Join without camera", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Join with my camera off" })).toBeChecked();
  await page.locator("[data-call-join]").click();
  await expect(page.locator("[data-call-room]")).toBeVisible();

  // Every control fits on the screen, a 44px target, none cut off at the edges.
  const controls = await page.locator("#call-controls button").evaluateAll((buttons) => buttons.map((button) => {
    const box = button.getBoundingClientRect();
    return { left: box.left, right: box.right, width: box.width, height: box.height };
  }));
  expect(controls).toHaveLength(6);
  for (const box of controls) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(320);
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  }

  const share = page.getByRole("button", { name: "Share screen", exact: true });
  await expect(share).toBeVisible();
  await share.click();
  await expect(page.getByText("This browser can't share a screen")).toBeVisible();
  await expect(polite(page)).toHaveText("This browser can't share a screen. Join from a computer to share yours.");

  // On a phone the panel covers the stage: one at a time.
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page.locator("[data-call-panel=chat]").getByRole("link", { name: /Open the thread/ })).toBeVisible();
  await page.getByRole("button", { name: "People", exact: true }).click();
  await expect(page.locator("[data-call-panel]")).toHaveCount(1);
  await expect(page.locator("[data-call-panel=people]")).toBeVisible();
  await screenChecks(page, testInfo, "phone-people-320");
  await page.getByRole("button", { name: "Close people", exact: true }).click();
  await page.getByRole("button", { name: "Leave or end", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "End for everyone", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /has ended$/ })).toBeFocused();
});

test("a call is the same 404 to anyone it isn't for", async ({ people }) => {
  const [{ page }] = await people([HOST]);
  for (const id of ["no-such-call", "x".repeat(40)]) {
    const response = await page.goto(`/dashboard/calls/${id}`);
    expect(response?.status()).toBe(404);
  }
});
