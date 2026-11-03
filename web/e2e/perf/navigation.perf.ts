/**
 * PERF-1 (investigation branch only, never merged): how long each navigation
 * of the main journeys takes, and where the time goes.
 *
 * Per step it records click → new content visible and click → shell hydrated
 * (wall clock), the document's Navigation Timing (TTFB, FCP, LCP, DCL, load),
 * the JS it fetched, the main thread's script time (CDP), and the server's own
 * trace (D1 queries, sequential waves, phases) from the branch's perf-trace.
 *
 * PERF_VARIANTS (comma separated) sets the `ttv-perf` cookie for each pass, so
 * one deploy can compare prototypes switched at runtime; PERF_REPS repeats.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import { personaSession, signIn, type PersonaKey } from "../platform-personas";

const OUT = fileURLToPath(new URL("../../test-results/perf", import.meta.url));
const REPS = Number(process.env.PERF_REPS ?? 3);
const VARIANTS = (process.env.PERF_VARIANTS ?? "base").split(",").map(v => v.trim()).filter(Boolean);
const DWELL_MS = Number(process.env.PERF_DWELL_MS ?? 250);
const PROFILES = {
  /** The runner's own network and CPU. */
  fast: null,
  /** Chrome DevTools' "Slow 4G" on top of the real network, and a 4x slower CPU: a mid-range phone. */
  throttled: { latency: 150, download: (1.6 * 1024 * 1024) / 8, upload: (750 * 1024) / 8, cpu: 4 },
} as const;
type ProfileName = keyof typeof PROFILES;
const SELECTED = (process.env.PERF_PROFILES ?? "fast,throttled").split(",") as ProfileName[];

/** Before each page loads: when the spaces shell (and every island) hydrated. */
const INIT = `(() => {
  const marks = { shell: null, islands: null };
  window.__perf = marks;
  const check = () => {
    const shell = document.querySelector('astro-island[component-url*="SpacesShell"]');
    if (shell && !shell.hasAttribute("ssr") && marks.shell === null) marks.shell = performance.now();
    if (document.readyState !== "loading" && !document.querySelector('astro-island[ssr][client="load"]') && marks.islands === null) marks.islands = performance.now();
  };
  new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["ssr"] });
  document.addEventListener("DOMContentLoaded", check);
  window.__perfLcp = 0;
  new PerformanceObserver(list => { for (const e of list.getEntries()) window.__perfLcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
})();`;

interface Step {
  journey: string; step: string; profile: ProfileName; variant: string; rep: number; via: string;
  url: string; clickToVisibleMs: number; clickToReadyMs: number; hard: boolean;
  doc?: Record<string, number | string | null>; js?: { count: number; transfer: number; decoded: number };
  scriptMs?: number; taskMs?: number; server?: unknown; serverTiming?: unknown;
}
const results: Step[] = [];

async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics: list } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(list.map(m => [m.name, m.value]));
}

/** CDP's counters are cumulative per renderer; a new renderer starts again from zero. */
function delta(before: Record<string, number>, after: Record<string, number>, key: string): number {
  const a = after[key] ?? 0, b = before[key] ?? 0;
  return Math.round((a >= b ? a - b : a) * 1000);
}

/** Marks the current page so "new content" can be told apart from the old one on soft navigations. */
async function markOld(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll("h1").forEach(h => h.setAttribute("data-perf-old", ""));
    (window as unknown as { __perfOrigin: number }).__perfOrigin = performance.timeOrigin;
  }).catch(() => {});
}

async function collect(page: Page, keepQueries: boolean) {
  return page.evaluate((keep) => {
    const w = window as unknown as { __perf?: { shell: number | null; islands: number | null }; __perfLcp?: number };
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
    const scripts = performance.getEntriesByType("resource").filter(e => (e as PerformanceResourceTiming).initiatorType === "script" || e.name.endsWith(".js")) as PerformanceResourceTiming[];
    let server: unknown = null;
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue ?? "";
      if (text.startsWith("ttv-perf ")) {
        const parsed = JSON.parse(text.slice(9));
        if (!keep) delete parsed.queries;
        server = parsed;
      }
    }
    const activation = (nav as unknown as { activationStart?: number })?.activationStart ?? 0;
    const since = (value: number | null | undefined) => typeof value === "number" ? Math.round(Math.max(0, value - activation)) : null;
    return {
      doc: nav ? {
        type: nav.type, status: (nav as unknown as { responseStatus?: number }).responseStatus ?? null,
        activationStart: Math.round(activation),
        ttfb: since(nav.responseStart), redirect: Math.round(nav.redirectEnd - nav.redirectStart),
        fcp: since(fcp), lcp: since(w.__perfLcp), dcl: since(nav.domContentLoadedEventEnd), load: since(nav.loadEventEnd),
        docTransfer: nav.transferSize, docDecoded: nav.decodedBodySize,
        shellHydrated: since(w.__perf?.shell), islandsHydrated: since(w.__perf?.islands),
      } : undefined,
      serverTiming: nav?.serverTiming?.map(t => ({ name: t.name, dur: t.duration, desc: t.description })) ?? [],
      js: { count: scripts.length, transfer: scripts.reduce((s, e) => s + e.transferSize, 0), decoded: scripts.reduce((s, e) => s + e.decodedBodySize, 0) },
      server,
    };
  }, keepQueries);
}

class Journey {
  /** When the person actually clicked: the dwell before it belongs to them, not to the navigation. */
  clickedAt: number | null = null;

  constructor(readonly page: Page, readonly cdp: CDPSession, readonly journey: string, readonly profile: ProfileName, readonly variant: string, readonly rep: number) {}

  /** Runs one navigation: `act` starts it, then waits for new content and the shell. */
  async step(name: string, act: () => Promise<string>, ready: (page: Page) => Promise<void> = newContent) {
    const { page } = this;
    await markOld(page);
    const before = await metrics(this.cdp);
    const originBefore = await page.evaluate(() => performance.timeOrigin).catch(() => 0);
    this.clickedAt = null;
    let startedAt = Date.now();
    const via = await act();
    startedAt = this.clickedAt ?? startedAt;
    await ready(page);
    const visibleAt = Date.now();
    await shellReady(page);
    const readyAt = Date.now();
    await page.waitForLoadState("load").catch(() => {});
    await page.waitForTimeout(150);
    const after = await metrics(this.cdp);
    const hard = (await page.evaluate(() => performance.timeOrigin)) !== originBefore;
    const data = await collect(page, this.rep === 1);
    results.push({
      journey: this.journey, step: name, profile: this.profile, variant: this.variant, rep: this.rep, via,
      url: new URL(page.url()).pathname + new URL(page.url()).search,
      clickToVisibleMs: visibleAt - startedAt, clickToReadyMs: readyAt - startedAt, hard,
      ...(hard ? data : { js: data.js }),
      scriptMs: delta(before, after, "ScriptDuration"),
      taskMs: delta(before, after, "TaskDuration"),
    });
  }

  /** Clicks the first link matching `selector` like a person: point, dwell, click. Falls back to goto. */
  async click(selector: string, fallback?: string): Promise<string> {
    const link = this.page.locator(selector).filter({ visible: true }).first();
    if (await link.count()) {
      await link.hover();
      await this.page.waitForTimeout(DWELL_MS);
      this.clickedAt = Date.now();
      await link.click({ noWaitAfter: true });
      return "click";
    }
    if (!fallback) throw new Error(`No link for ${selector} on ${this.page.url()}`);
    await this.page.goto(fallback, { waitUntil: "commit" });
    return "goto";
  }
}

async function newContent(page: Page) {
  await page.locator("h1:not([data-perf-old])").first().waitFor({ state: "visible", timeout: 60_000 });
}

async function shellReady(page: Page) {
  await page.waitForFunction(() => {
    const shell = document.querySelector('astro-island[component-url*="SpacesShell"]');
    return shell ? !shell.hasAttribute("ssr") : !document.querySelector('astro-island[ssr][client="load"]');
  }, undefined, { timeout: 60_000 }).catch(() => {});
}

async function begin(context: BrowserContext, baseURL: string, key: PersonaKey, variant: string): Promise<boolean> {
  const session = personaSession(key);
  if (typeof session === "string") { test.info().annotations.push({ type: "skip", description: `${key}: ${session}` }); return false; }
  await signIn(context, baseURL, session);
  await context.addCookies([{ name: "ttv-perf", value: variant, url: baseURL }]);
  await context.addInitScript(INIT);
  return true;
}

async function throttle(page: Page, profile: ProfileName): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const settings = PROFILES[profile];
  if (settings) {
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: settings.latency, downloadThroughput: settings.download, uploadThroughput: settings.upload });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: settings.cpu });
  }
  return cdp;
}

/** Untimed: the student has agreed to the code of conduct and their cohort channel has a thread to open. */
async function seedThread(page: Page, baseURL: string): Promise<string | null> {
  const list = await page.request.get("/api/channels");
  if (!list.ok()) return null;
  const { items } = await list.json() as { items: { id: string; slug: string; kind: string }[] };
  const channel = items.find(c => c.kind === "COHORT" && !c.slug.endsWith("announcements")) ?? items.find(c => c.kind === "COMMUNITY");
  if (!channel) return null;
  const href = `/dashboard/${channel.kind === "COHORT" ? "cohort" : "community"}/c/${channel.slug}`;
  await page.goto(href);
  const agree = page.getByRole("button", { name: "I’ll keep to this" });
  if (await agree.isVisible().catch(() => false)) { await agree.click(); await page.waitForLoadState("load"); }
  const post = (body: string, parentId: string | null) => page.request.post(`/api/channels/${channel.id}/messages`, {
    headers: { origin: new URL(baseURL).origin }, data: { body, clientNonce: `perf-${Date.now()}-${Math.random().toString(36).slice(2)}`, parentId, embeds: [] },
  });
  const root = await post("Perf check: a thread to open (synthetic, preview only).", null);
  if (!root.ok()) return href;
  const { id } = await root.json() as { id: string };
  await post("A reply in the thread.", id);
  return href;
}

for (const profile of SELECTED) {
  for (const variant of VARIANTS) {
    test.describe(`${profile} · ${variant}`, () => {
      test(`student: overview → channel → thread → community → mentors → ask → account post`, async ({ browser, baseURL }) => {
        let channel: string | null = null;
        for (let rep = 1; rep <= REPS; rep++) {
          const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
          if (!await begin(context, baseURL!, "student", variant)) { await context.close(); return; }
          const page = await context.newPage();
          if (rep === 1) { const seed = await context.newPage(); channel = await seedThread(seed, baseURL!); await seed.close(); }
          const cdp = await throttle(page, profile);
          const j = new Journey(page, cdp, "student", profile, variant, rep);
          await j.step("overview (cold load)", async () => { await page.goto("/dashboard/cohort", { waitUntil: "commit" }); return "goto"; });
          await j.step("cohort channel", () => j.click(channel ? `a[href="${channel}"]` : 'a[href^="/dashboard/cohort/c/"]', channel ?? "/dashboard/community/c/design-crit"));
          await j.step("thread", () => j.click('a[href^="?thread="]'), async p => {
            await p.locator('[data-thread="open"]').first().waitFor({ timeout: 60_000 });
          }).catch(error => test.info().annotations.push({ type: "thread", description: String(error).slice(0, 200) }));
          await j.step("community", () => j.click('a[href="/dashboard/community"]', "/dashboard/community"));
          await j.step("mentors", () => j.click('a[href="/dashboard/community/mentors"]', "/dashboard/community/mentors"));
          await j.step("cohort tab", () => j.click('a[href="/dashboard/cohort"]', "/dashboard/cohort"));
          await j.step("ask", () => j.click('a[href="/dashboard/cohort/ask"]', "/dashboard/cohort/ask"));
          await j.step("account", () => j.click('a[href="/dashboard/account"]', "/dashboard/account"));
          await j.step("account form post", async () => {
            const save = page.locator('form:has(input[name="action"][value="profile"]) button[type="submit"]').first();
            await save.click({ noWaitAfter: true });
            return "post";
          });
          await context.close();
        }
      });

      test(`staff: admin → users → user → applications → application → status post`, async ({ browser, baseURL }) => {
        for (let rep = 1; rep <= REPS; rep++) {
          const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
          if (!await begin(context, baseURL!, "staff", variant)) { await context.close(); return; }
          const page = await context.newPage();
          const cdp = await throttle(page, profile);
          const j = new Journey(page, cdp, "staff", profile, variant, rep);
          await j.step("admin home (cold load)", async () => { await page.goto("/admin", { waitUntil: "commit" }); return "goto"; });
          await j.step("users", () => j.click('a[href="/admin/users"]', "/admin/users"));
          await j.step("user detail", () => j.click('main a[href^="/admin/users/"]'));
          await j.step("applications", () => j.click('a[href="/admin/applications"]', "/admin/applications"));
          await j.step("application detail", () => j.click('main a[href^="/admin/applications/"]:not([href$="/applications/"])'));
          await j.step("status post", async () => {
            // A stale expectedStatus: the full POST pipeline (guards, form, reads, render) runs and the
            // page answers "changed, refresh", so the preview's applications stay as the e2e suite left them.
            const form = page.locator("form:has(input[name='expectedStatus'])").first();
            await form.locator("input[name='expectedStatus']").evaluate((input: HTMLInputElement) => {
              input.value = input.value === "PENDING" ? "REJECTED" : "PENDING";
            });
            page.once("dialog", dialog => dialog.accept());
            await form.locator("button[type='submit']").click({ noWaitAfter: true });
            return "post";
          }).catch(error => test.info().annotations.push({ type: "status", description: String(error).slice(0, 200) }));
          await context.close();
        }
      });
    });
  }
}

// After every test, not once: a failing test restarts the worker and would lose the rest.
const FILE = path.join(OUT, `${SELECTED.join("+")}-${VARIANTS.join("+")}-${process.pid}.json`);
test.afterEach(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(FILE, JSON.stringify(results, null, 1));
});
