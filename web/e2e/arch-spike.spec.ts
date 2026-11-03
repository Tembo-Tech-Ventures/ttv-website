/**
 * ARCH-1 spike (throwaway, never merged): the chrome split from SpacesShell, with and without Astro's
 * ClientRouter, in one build. `ttv-arch=mpa` turns the router off. Measures click → new h1 visible,
 * whether the chrome's DOM survives a navigation, document requests per click and console errors.
 */
import { test, type Page } from "@playwright/test";
import { personaSession, signIn } from "./platform-personas";

const STEPS = [
  { via: "tab", href: "/dashboard/cohort" },
  { via: "tab", href: "/dashboard/community" },
  { via: "sidebar", href: "/dashboard/community/c/" },
  { via: "sidebar", href: "/dashboard/community" },
  { via: "tab", href: "/dashboard/me" },
  { via: "tab", href: "/dashboard/community" },
] as const;

async function step(page: Page, via: string, href: string) {
  const link =
    via === "tab"
      ? page.locator(`.space-file__nav a[href="${href}"], .spaces-bottom a[href="${href}"]`).locator("visible=true").first()
      : page.locator(`#space-sidebar a[href${href.endsWith("/") ? "^" : ""}="${href}"]`).first();
  const before = await page.locator("main h1").first().textContent();
  const marked = await page.evaluate(() => {
    const row = document.querySelector(".space-file__row") as (HTMLElement & { __arch?: boolean }) | null;
    if (row) row.__arch = true;
    return Boolean(row);
  });
  const start = Date.now();
  await link.click();
  await page.waitForFunction(
    (previous) => {
      const h1 = document.querySelector("main h1");
      return h1 && h1.textContent !== previous && (h1 as HTMLElement).offsetParent !== null;
    },
    before,
    { timeout: 20_000 },
  );
  const ms = Date.now() - start;
  const kept = await page.evaluate(() => Boolean((document.querySelector(".space-file__row") as (HTMLElement & { __arch?: boolean }) | null)?.__arch));
  return { href, via, ms, chromeKept: marked && kept, url: new URL(page.url()).pathname };
}

for (const variant of ["router", "mpa"] as const) {
  for (const cpu of [1, 4]) {
    test(`ARCH-1 spike: ${variant}, cpu ×${cpu}`, async ({ context, page, baseURL }, info) => {
      test.skip(info.project.name !== "chromium");
      test.setTimeout(180_000);
      const session = personaSession("student");
      test.skip(typeof session === "string");
      if (typeof session === "string") return;
      await signIn(context, baseURL!, session);
      if (variant === "mpa") await context.addCookies([{ name: "ttv-arch", value: "mpa", url: baseURL! }]);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message.slice(0, 160)));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text().slice(0, 160));
      });
      let documents = 0;
      page.on("request", (request) => {
        if (["document", "fetch"].includes(request.resourceType()) && request.url().includes("/dashboard")) documents += 1;
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
      await page.goto("/dashboard/community");
      await page.locator("main h1").first().waitFor();
      const results = [];
      for (let rep = 0; rep < 3; rep += 1) {
        for (const s of STEPS) {
          documents = 0;
          const result = await step(page, s.via, s.href);
          results.push({ ...result, rep, requests: documents });
        }
      }
      const ms = results.map((r) => r.ms).sort((a, b) => a - b);
      const p = (q: number) => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))];
      console.log(
        JSON.stringify({
          variant,
          cpu,
          median: p(0.5),
          p75: p(0.75),
          chromeKept: results.filter((r) => r.chromeKept).length + "/" + results.length,
          requestsPerClick: results.map((r) => r.requests).join(","),
          errors: [...new Set(errors)].slice(0, 6),
          perStep: results.map((r) => `${r.url}:${r.ms}`).join(" "),
        }),
      );
    });
  }
}
