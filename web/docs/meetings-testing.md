# Testing calls

How to put several people in one call and check what happens, locally and on a pull request's
preview, where calls run on the fake provider. The live steps on staging, with the real provider,
come with slices P4 and P6 (the placeholder at the end). What calls do is in
[`src/lib/meetings/README.md`](../src/lib/meetings/README.md).

| Layer | What it shows | Where it runs |
|---|---|---|
| Unit and render tests | Access, seats, the clock, the routes and pages, the test-call page's gate | `npm test` |
| Playwright with fake media | The room in real browsers: two or more people, keyboard, announcements, a call ending at its limit | Locally, and on every PR's preview (the preview e2e run) |
| Live on staging | The real provider with the fictional SAM personas | By hand at P4, P6, P7 and P11 (see the last section) |

Two things no automated run shows: how a real phone's microphone, speaker and screen lock behave, and
whether a call survives a poor network. Those need a person with the devices.

## The shared set-up (`e2e/calls.ts`)

Every call check imports `test` and `expect` from `e2e/calls.ts` instead of `@playwright/test`. Its
browser has Chromium's fake camera and microphone (`--use-fake-device-for-media-stream`), with the
permission prompt answered yes (`--use-fake-ui-for-media-stream`), and its `people` fixture opens one
signed-in browser per person:

```ts
import { agreeToConduct, expect, HOST, joinCall, makeTestCall, MEMBER, openCall, test } from "./calls";

test("two people in one call", async ({ people }) => {
  const [host, member] = await people([HOST, MEMBER], { width: 390 });
  for (const { page } of [host, member]) await agreeToConduct(page);
  const id = await makeTestCall(host, { title: "Two of us", minutes: 2 });
  await openCall(host.page, id);
  await joinCall(host.page);          // the host opens the room
  await openCall(member.page, id);
  await joinCall(member.page);
  await expect(member.page.locator("[data-call-count]")).toHaveText("2 people");
});
```

- `people(personas, { width, init })`: one browser context per persona (`e2e/platform-personas.ts`),
  each with its own page, closed when the test ends. `width` under 600 is a touch screen; `init` is a
  script every page runs first, such as a phone without screen sharing.
- `makeTestCall(host, { title, minutes })`: a test call in the member's cohort through the test-call
  page below. `scheduleSession(host, title)` schedules an ordinary session through the API instead.
- `openCall`, `joinCall`, `agreeToConduct`, and `polite` and `assertive` for the room's announcements.
- **Recorded media.** With no files, Chromium draws a test pattern and plays a beep. To use a
  recording, set `CALL_FAKE_VIDEO` to a `.y4m` or `.mjpeg` file and `CALL_FAKE_AUDIO` to a `.wav`
  file before running Playwright (`e2e/fake-media.ts`). A missing file is an error, never a silent
  test pattern. Make a short `.y4m` with `ffmpeg -i clip.mp4 -t 10 -pix_fmt yuv420p clip.y4m`.

Other people's video can't travel on the fake provider (there is no media server), so the room shows
them with no video; who is in the call, and everything TTV's server decides, is real.

## Test calls (`/dev/calls/test`)

A page that makes a short call starting now, with you as its host: two minutes unless you ask for
another length (1 to 90). It ends on its own that long after the host opens the room, which is how
"a call ends on time" is checked. You choose where: a cohort you teach (a session; every cohort for an
admin) or a community channel you moderate (an event, which every signed-in person can join). It
answers with the room's address.

| Where | Test calls |
|---|---|
| `astro dev` | Yes |
| A pull request's preview (`agent-*`) | Yes |
| Staging | Only while the staging environment's variable `MEETINGS_TEST_CALLS` is `on` (GitHub, Settings, Environments, `staging`, Variables), then deploy. Only the SAM personas' fictional cohorts are offered there |
| Production | Never: a 404 whatever is set (`testCallsEnabled` checks production first, and the deploy script refuses the variable anywhere but staging) |

Everywhere it is also a 404 for anyone signed out, a personal access token, someone who hosts
nowhere, `meetings` off, and a post from another site. `src/pages/dev/calls/_tests/test.render.test.ts`
proves the gate.

A script asks for JSON, from a signed-in browser context so the cookie goes with it:

```ts
const made = await host.context.request.post("/dev/calls/test", {
  headers: { origin: host.origin, accept: "application/json" },
  form: { channelId, title: "Ends on time", minutes: "2" },
});
// 201 { id, roomPath, roomUrl, minutes }; 400 for a length outside 1 to 90, 403 conduct_required
```

## Locally

Local `astro dev` uses the fake provider. Once:

```sh
cd web
npm run db:migrate:local
npx wrangler d1 execute ttv-database --local --file e2e/platform-personas.local.sql
# .dev.vars: BETTER_AUTH_SECRET=<the secret in .env>, PLATFORM_FLAGS_OVERRIDE=all
npm run dev
```

Then, in another terminal:

```sh
PLATFORM_PERSONAS_LOCAL_SECRET=<the same secret> npx playwright test e2e/test-call.spec.ts e2e/call-room.spec.ts --project=chromium
```

The local seed's people: `staff` (an admin, who hosts anything), `student` (in the current cohort),
and `alumna`, `community`, `mentor` and `institution`. A cohort session holds `staff` and `student`.
For more people at once, make the test call an event in a community channel (choose it under
"Where"): all six can join it. Each agrees to the code of conduct first (`agreeToConduct`).

In a SAM workspace the remote bindings fail with the placeholder Cloudflare token: copy
`astro.config.mjs` to an uncommitted `astro.local.config.mjs` with
`cloudflare({ imageService: TTV_IMAGE_SERVICE, remoteBindings: false })`, and run
`env -u CF_API_TOKEN -u CF_ACCOUNT_ID npx astro dev --config astro.local.config.mjs`.

## On a preview

Every pull request's preview runs the whole Playwright suite against itself on the fake provider,
including `e2e/test-call.spec.ts` (two people join a one-minute test call, and it ends at its limit
for both) and `e2e/call-room.spec.ts`. The people there are the preview's admin (`staff`, the host) and
accepted student (`student`, in `ttv-fixture-program-cohort-04`), whose agreement to the code of
conduct is seeded (`scripts/cloudflare/agent-preview-auth.mjs`). Their sessions are agents', which
can't agree in the app, so any other preview persona you add to a call needs a seeded agreement too.
Previews never call the real provider: they can't delete the apps it would make.

## Live on staging (slices P4 and P6)

To be written when the real provider reaches staging. It will cover, under the staging lock:

- switching test calls on (`MEETINGS_TEST_CALLS=on`) and off again;
- signing in the sixteen fictional SAM personas (`src/lib/sam-login/README.md`, one SAM token per
  login): ten of them read the current fictional cohort's channel, and all fifteen fixed personas
  can join a community event, so a full room of 15 and one person refused can be tried;
- a two-minute test call ending on time with the real provider;
- removing someone and trying to rejoin with the old token;
- 15 headless browsers holding one call for 10 minutes (the spike's question 12);
- a recording reaching the viewer (P7).
