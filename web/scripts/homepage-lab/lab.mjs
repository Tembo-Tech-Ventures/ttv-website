// Shared browser helpers for designing, auditing and recording homepage
// candidates against the local dev server. Not part of the Worker bundle.
import { Buffer } from "node:buffer";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";

export const BASE_URL = process.env.HOMEPAGE_LAB_URL ?? "http://127.0.0.1:4321";

export const VIEWPORTS = {
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { width: 820, height: 1180, deviceScaleFactor: 1, isMobile: false, hasTouch: true },
  laptop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  wide: { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};

const FONT_HOSTS = /fonts\.(googleapis|gstatic)\.com/;

/**
 * Chromium in the devcontainer cannot reach Google Fonts although Node can, and
 * every capture then silently falls back to a system sans. Proxy those
 * requests through Node so screenshots show Maven Pro.
 */
async function proxyFonts(context) {
  await context.route(FONT_HOSTS, async (route) => {
    try {
      const response = await fetch(route.request().url(), {
        headers: { "user-agent": route.request().headers()["user-agent"] ?? "Mozilla/5.0" },
      });
      const body = Buffer.from(await response.arrayBuffer());
      await route.fulfill({
        status: response.status,
        body,
        headers: { "content-type": response.headers.get("content-type") ?? "text/css", "access-control-allow-origin": "*" },
      });
    } catch {
      await route.abort();
    }
  });
}

const HIDE_DEV_CHROME = "astro-dev-toolbar, vite-error-overlay { display: none !important; }";

export async function openLab({ viewport = "laptop", reducedMotion = "no-preference", video } = {}) {
  const browser = await chromium.launch();
  const { width, height, ...device } = VIEWPORTS[viewport];
  const context = await browser.newContext({
    viewport: { width, height },
    ...device,
    reducedMotion,
    ...(video ? { recordVideo: video } : {}),
  });
  await proxyFonts(context);
  await context.addInitScript((css) => {
    const style = document.createElement("style");
    style.textContent = css;
    document.addEventListener("DOMContentLoaded", () => document.head.append(style));
  }, HIDE_DEV_CHROME);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return { browser, context, page, errors };
}

export async function gotoReady(page, path) {
  const response = await page.goto(new URL(path, BASE_URL).toString(), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  return response;
}

export const wait = (ms) => sleep(ms);
