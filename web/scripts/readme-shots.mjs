/**
 * The README's screenshots, taken from a running build seeded with fictional people.
 *
 * Every image in the repository README comes from this list, so a screenshot can always be
 * retaken and nobody has to wonder whose data is in it. Run it against a local build whose D1
 * holds only the fictional personas (never staging or production, which hold real people):
 *
 *   npm run db:migrate:local
 *   npx wrangler d1 execute ttv-database --local --file e2e/platform-personas.local.sql
 *   # .dev.vars: BETTER_AUTH_SECRET=<secret>, PLATFORM_FLAGS_OVERRIDE=all
 *   npm run build && npx astro preview --port 4321 --host 127.0.0.1
 *   PLATFORM_PERSONAS_LOCAL_SECRET=<secret> node scripts/readme-shots.mjs
 *
 * README_SHOTS_BASE_URL points it at another port on this machine. Signed-in shots use the
 * seeded sessions, signed with the preview's own secret; anything but a loopback origin is
 * refused, so no other deployment can be screenshotted as a persona.
 */
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Where the README finds its images, relative to the repository root. */
export const SCREENSHOT_DIRECTORY = "docs/readme";

export const VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }),
  mobile: Object.freeze({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  }),
});

/**
 * One entry per README image. `persona` signs in as a fictional person from
 * e2e/platform-personas.local.sql; without one the page is shot signed out.
 */
export const SHOTS = Object.freeze([
  { file: "homepage-desktop.png", route: "/", viewport: "desktop" },
  { file: "homepage-mobile.png", route: "/", viewport: "mobile" },
  { file: "cohort-space-desktop.png", route: "/dashboard/cohort", viewport: "desktop", persona: "student" },
  { file: "cohort-space-mobile.png", route: "/dashboard/cohort", viewport: "mobile", persona: "student" },
  { file: "style-guide-desktop.png", route: "/style-guide/components", viewport: "desktop" },
]);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The origin of a build on this machine, or an error for any other: README shots are local only. */
export function localOrigin(baseURL) {
  const url = new URL(baseURL);
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`README screenshots are taken only on a local build, not ${url.origin}.`);
  }
  return url.origin;
}

/**
 * Better Auth's signed session cookie (better-call signCookieValue) for a session the local seed
 * already holds, the same cookie e2e/platform-personas.ts sets. Refuses any origin but this
 * machine's.
 */
export function localSessionCookie(baseURL, token, secret) {
  const origin = localOrigin(baseURL);
  if (!secret) throw new Error("Set PLATFORM_PERSONAS_LOCAL_SECRET to the build's BETTER_AUTH_SECRET.");
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return {
    name: "better-auth.session_token",
    value: encodeURIComponent(`${token}.${signature}`),
    url: origin,
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
  };
}

/** The seeded session token of a persona in e2e/platform-personas.local.sql. */
export function personaToken(persona) {
  return `ttv-local-persona-${persona}-token`;
}

async function capture({ baseURL, secret, outputDirectory }) {
  // Checked before the first shot, so a remote page never overwrites a README image.
  localOrigin(baseURL);
  if (SHOTS.some((shot) => shot.persona) && !secret) {
    throw new Error("Set PLATFORM_PERSONAS_LOCAL_SECRET to the build's BETTER_AUTH_SECRET.");
  }
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    for (const shot of SHOTS) {
      const context = await browser.newContext({ ...VIEWPORTS[shot.viewport], reducedMotion: "reduce" });
      if (shot.persona) await context.addCookies([localSessionCookie(baseURL, personaToken(shot.persona), secret)]);
      const page = await context.newPage();
      const response = await page.goto(new URL(shot.route, baseURL).href, { waitUntil: "networkidle" });
      if (!response?.ok()) throw new Error(`${shot.route} answered ${response?.status()}`);
      // A signed-out redirect would quietly shoot the login page instead.
      if (new URL(page.url()).pathname !== shot.route) throw new Error(`${shot.route} redirected to ${page.url()}`);
      await page.evaluate(() => document.fonts.ready);
      const file = path.join(outputDirectory, shot.file);
      await page.screenshot({ path: file });
      console.log(file);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const outputDirectory = path.join(repositoryRoot, SCREENSHOT_DIRECTORY);
  mkdirSync(outputDirectory, { recursive: true });
  await capture({
    baseURL: process.env.README_SHOTS_BASE_URL ?? "http://127.0.0.1:4321",
    secret: process.env.PLATFORM_PERSONAS_LOCAL_SECRET,
    outputDirectory,
  });
}
