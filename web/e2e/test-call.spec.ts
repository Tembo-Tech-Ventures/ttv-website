import { agreeToConduct, expect, HOST, joinCall, makeTestCall, MEMBER, openCall, peopleUnavailable, test } from "./calls";

/**
 * The test-call page (in-app calls T1; docs/meetings-testing.md) and the shared call set-up together:
 * the host makes a one-minute test call through the page, the host and a member join it from two
 * browsers with a fake camera and microphone, both see each other in the room, and the call ends on
 * its own at its limit, which both pages say. This is the "a call ends on time" check that later
 * slices run against the real provider on staging.
 */

test.beforeEach(({ baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop only: the room's layouts are checked in call-room.spec.ts.");
  const unavailable = peopleUnavailable([HOST, MEMBER]);
  test.skip(unavailable !== null, unavailable ?? "");
  test.skip(!baseURL, "No base URL.");
});

test("two people join a one-minute test call, and it ends on time for both", async ({ people }) => {
  // A minute in the call, plus the room's poll (ROOM_POLL_MS, 15 s) to notice the end.
  test.setTimeout(180_000);
  const [host, member] = await people([HOST, MEMBER]);
  for (const { page } of [host, member]) await agreeToConduct(page);
  const title = `Test call ${Date.now().toString(36)}`;
  const id = await makeTestCall(host, { title, minutes: 1 });

  await openCall(host.page, id);
  await expect(host.page.locator("[data-call-join]")).toHaveText("Start session");
  await joinCall(host.page);
  const opened = Date.now();

  await openCall(member.page, id);
  await joinCall(member.page);
  for (const { page } of [host, member]) await expect(page.locator("[data-call-count]")).toHaveText("2 people", { timeout: 20_000 });

  for (const { page } of [host, member]) {
    await expect(page.getByRole("heading", { level: 1, name: `${title} has ended` })).toBeFocused({ timeout: 100_000 });
    await expect(page.getByText("It reached its 1-minute limit and ended.", { exact: false })).toBeVisible();
  }
  // Never before its minute was up: the server ends it, not the page.
  expect(Date.now() - opened).toBeGreaterThanOrEqual(60_000);
});
