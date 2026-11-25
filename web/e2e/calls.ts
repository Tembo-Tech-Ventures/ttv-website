import { expect, test as base, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { fakeMediaArgs } from "./fake-media";
import { personaSession, signIn, type PersonaKey } from "./platform-personas";

/**
 * The shared set-up for call checks (in-app calls T1; docs/meetings-testing.md): Chromium with a fake
 * camera and microphone, and `people`, which opens one signed-in browser per fictional person so
 * several people can be in one call. Every browser it opens is closed when the test ends.
 *
 *   import { expect, test } from "./calls";
 *   test("…", async ({ people }) => {
 *     const [host, member] = await people(["staff", "student"]);
 *   });
 *
 * Locally the people come from platform-personas.local.sql; on an agent preview they are the
 * preview's admin and accepted student, whose agreement to the code of conduct is seeded
 * (agent-preview-auth.mjs). Calls run on the fake provider in both places.
 */

/** The host every call check uses: the local seed's admin, or the preview's. */
export const HOST: PersonaKey = "staff";
/** A member of COHORT. */
export const MEMBER: PersonaKey = "student";
/** The member's cohort: the local seed's current cohort, or the preview fixtures' cohort. */
export const COHORT = process.env.PLAYWRIGHT_BASE_URL ? "ttv-fixture-program-cohort-04" : "ttv-local-persona-cohort-05";

/** One fictional person's own browser, signed in, with the camera and microphone allowed. */
export interface CallPerson {
  persona: PersonaKey;
  context: BrowserContext;
  page: Page;
  /** The site this person is signed in to. */
  origin: string;
}

export interface PeopleOptions {
  /** The window's width in CSS pixels (1440 unless told); under 600 it is a touch screen. */
  width?: number;
  /** A script every page of these people runs before the site's own, such as a phone's missing APIs. */
  init?: () => void;
}

export type OpenPeople = (personas: readonly PersonaKey[], options?: PeopleOptions) => Promise<CallPerson[]>;

/** Why these people can't be signed in here, or null when they can. */
export function peopleUnavailable(personas: readonly PersonaKey[]): string | null {
  for (const persona of personas) {
    const session = personaSession(persona);
    if (typeof session === "string") return session;
  }
  return null;
}

export const test = base.extend<{ people: OpenPeople }>({
  launchOptions: [async ({ launchOptions }, use) => {
    await use({ ...launchOptions, args: [...launchOptions.args ?? [], ...fakeMediaArgs()] });
  }, { scope: "worker" }],

  people: async ({ browser, baseURL }, use) => {
    const opened: BrowserContext[] = [];
    await use(async (personas, { width = 1440, init } = {}) => {
      if (!baseURL) throw new Error("No base URL.");
      return Promise.all(personas.map(async (persona) => {
        const session = personaSession(persona);
        if (typeof session === "string") throw new Error(session);
        const context = await browser.newContext({
          baseURL, viewport: { width, height: width < 600 ? 780 : 900 }, permissions: ["camera", "microphone"],
          reducedMotion: "reduce", hasTouch: width < 600,
        });
        opened.push(context);
        await signIn(context, baseURL, session);
        if (init) await context.addInitScript(init);
        return { persona, context, page: await context.newPage(), origin: new URL(baseURL).origin };
      }));
    });
    await Promise.all(opened.map((context) => context.close()));
  },
});
export { expect };

/** Agrees to the code of conduct where the person still can (locally); previews seed the agreement. */
export async function agreeToConduct(page: Page) {
  await page.goto("/dashboard/community/conduct");
  const agree = page.locator("[data-conduct-agree] button[type=submit]");
  if (await agree.count()) await agree.click();
}

/** COHORT's main channel, as its host reads the channels. */
export async function cohortChannelId(request: APIRequestContext): Promise<string> {
  const channels = await request.get("/api/channels");
  expect(channels.status(), "the host reads the channels").toBe(200);
  const { items } = await channels.json() as { items: { id: string; slug: string; kind: string; programId: string | null }[] };
  const channel = items.find((item) => item.kind === "COHORT" && item.programId === COHORT && item.slug.startsWith("cohort-"));
  expect(channel, `the cohort channel of ${COHORT}`).toBeTruthy();
  return channel!.id;
}

/** A cohort session for COHORT, starting in two minutes, scheduled by the host through the API. */
export async function scheduleSession(host: CallPerson, title: string): Promise<string> {
  const { request } = host.context;
  const created = await request.post("/api/meetings", {
    headers: { origin: host.origin },
    data: { purpose: "SESSION", channelId: await cohortChannelId(request), title, scheduledStartAt: Date.now() + 2 * 60_000, bookedMinutes: 30 },
  });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json() as { id: string }).id;
}

/**
 * A test call in COHORT through the test-call page's form, with the host as its host, starting now
 * and ending `minutes` after the host opens the room. Returns its id, read from the room's address
 * the page shows.
 */
export async function makeTestCall(host: CallPerson, { title, minutes }: { title: string; minutes: number }): Promise<string> {
  const { page } = host;
  const response = await page.goto("/dev/calls/test");
  expect(response?.status(), "the test-call page exists here").toBe(200);
  await page.getByLabel("Where").selectOption(await cohortChannelId(host.context.request));
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Length in minutes").fill(String(minutes));
  await page.getByRole("button", { name: "Make the call" }).click();
  await expect(page.getByText("Test call made")).toBeVisible();
  const room = await page.locator("[data-test-call-room]").textContent();
  const id = new URL(room ?? "").pathname.split("/").pop();
  expect(id, "the room's address names the call").toBeTruthy();
  return id!;
}

/** The call's page, hydrated, with astro dev's own toolbar (which sits over the controls locally) hidden. */
export async function openCall(page: Page, id: string) {
  const response = await page.goto(`/dashboard/calls/${id}`);
  expect(response?.status()).toBe(200);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
}

/** Presses Join (or "Start session") and waits for the room. */
export async function joinCall(page: Page) {
  const join = page.locator("[data-call-join]");
  await expect(join).toBeEnabled({ timeout: 20_000 });
  await join.click();
  await expect(page.locator("[data-call-room]")).toBeVisible();
}

/** The call's live announcer: what it says politely, and what it says at once. */
const announcer = (page: Page) => page.locator("[data-live-announcer=call]");
export const polite = (page: Page) => announcer(page).locator("output");
export const assertive = (page: Page) => announcer(page).locator("[role=alert]");
