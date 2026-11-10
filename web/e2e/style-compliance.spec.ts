import { expect, test, type Page } from "@playwright/test";
import { axeRun, AXE_VERSION, describeViolations } from "./platform-axe";
import { localPersonaSession, personaSession, signIn, type PersonaKey } from "./platform-personas";
import { DESKTOP_CHECKS, MOBILE_CHECKS, STYLE_ROUTES, type StyleCheck, type StylePersona, type StyleRoute } from "./style-compliance.routes";

/**
 * The style guide, checked on every signed-in route (PLAN 0.5): the audit
 * harness from the 2026-11-08 compliance audit, as a spec. The routes, their
 * personas and the checks each one still owes are in style-compliance.routes.ts.
 *
 * - Desktop (chromium, 1440x900): one h1 in the display face, at most one peach
 *   action, every control from the kit, axe WCAG 2.2 AA.
 * - Phone (mobile-chromium, Pixel 7): 44px targets on the coarse pointer, then
 *   at 320 wide no sideways scroll and axe again.
 *
 * Locally it runs against astro dev with PLATFORM_FLAGS_OVERRIDE=all, the
 * personas seeded (platform-personas.local.sql) and
 * PLATFORM_PERSONAS_LOCAL_SECRET; on an agent preview, as the preview's
 * personas (the mentor and the newcomer are local only). Set
 * STYLE_COMPLIANCE_ALL=1 to check the pending routes too and see everything
 * they still owe.
 */

const LOCAL = !process.env.PLAYWRIGHT_BASE_URL;
const IGNORE_PENDING = process.env.STYLE_COMPLIANCE_ALL === "1";
const SHARED_PERSONAS = new Set<StylePersona>(["student", "alumna", "mentor", "community", "institution", "staff"]);

test.use({ reducedMotion: "reduce" });

function sessionFor(persona: StylePersona) {
  return SHARED_PERSONAS.has(persona) ? personaSession(persona as PersonaKey) : localPersonaSession(persona);
}

async function open(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status(), `${path} answers 200`).toBe(200);
  // A client:visible island hydrates only once it is in view: bring each one there, a frame at a time.
  const islands = await page.locator("astro-island[ssr]").count();
  for (let index = 0; index < islands; index++) {
    await page.evaluate((at) => new Promise<void>((settled) => {
      const island = document.querySelectorAll("astro-island[ssr]")[at];
      (island?.firstElementChild ?? island)?.scrollIntoView({ block: "center" });
      requestAnimationFrame(() => requestAnimationFrame(() => settled()));
    }), index);
  }
  await expect(page.locator("astro-island[ssr]"), `${path} hydrates`).toHaveCount(0);
  // An island may fetch what it shows after hydrating: check the page it settles on.
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => {
    document.querySelector(".spaces-shell__main")?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  });
  await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
  await page.evaluate(() => document.fonts.ready);
}

/** The route's own URL: itself, or for a detail route the first matching link on its list. */
async function resolvePath(page: Page, route: StyleRoute): Promise<string | null> {
  if (!route.detail) return route.path;
  await open(page, route.detail.from);
  const hrefs = await page.locator("a[href]").evaluateAll((links) => links.map((link) => new URL((link as HTMLAnchorElement).href).pathname));
  return hrefs.find((href) => route.detail!.link.test(href)) ?? null;
}

/* ---- In the page. Each returns what breaks the rule, so an empty list passes. ---- */

/** Shared by the in-page checks: what counts as on screen, and how to name an element in a failure. */
const PAGE_HELPERS = `
  window.__styleVisible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0 && !el.closest("astro-dev-toolbar,[inert],[hidden]");
  };
  window.__styleName = (el) => {
    const words = (el.getAttribute("aria-label") || el.innerText || el.value || "").trim().replace(/\\s+/g, " ").slice(0, 40);
    const href = el.getAttribute("href");
    return el.tagName.toLowerCase() + (href ? "[href=" + href + "]" : "") + ' "' + words + '"';
  };
`;

const CONTROLS = "a[href],button,input[type=submit],input[type=button],input[type=reset],summary,[role=button]";
/**
 * The kit draws every control's focus the same way: FOCUS_RING or INSET_FOCUS_RING in its classes,
 * or, for the space tabs, the same ring in platform-ui.css, and for a member card's name link, the same
 * ring on the whole card in members.css. A control with none of these was written by hand.
 */
const KIT_RING = String.raw`\bfocus-visible:outline-peach-ink\b|\bspace-tab__link\b|\bmember-card__link\b`;

function desktopFacts({ controls, kitRing }: { controls: string; kitRing: string }) {
  const ring = new RegExp(kitRing);
  const w = window as unknown as { __styleVisible: (el: Element) => boolean; __styleName: (el: Element) => string };
  const probe = document.createElement("span");
  probe.style.color = "var(--color-primary)";
  document.body.appendChild(probe);
  const peach = getComputedStyle(probe).color;
  probe.remove();

  const h1s = [...document.querySelectorAll("h1")].filter((h) => !h.closest("astro-dev-toolbar"));
  const shown = (el: Element) => w.__styleVisible(el);
  const onScreen = [...document.querySelectorAll(controls)].filter(shown);
  return {
    h1: h1s.map((h) => ({ text: (h.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60), visible: shown(h), font: getComputedStyle(h).fontFamily })),
    peach: onScreen.filter((el) => getComputedStyle(el).backgroundColor === peach && !/^skip to/i.test((el.textContent ?? "").trim())).map(w.__styleName),
    unkitted: onScreen.filter((el) => !ring.test(el.getAttribute("class") ?? "")).map(w.__styleName),
    // Peach is the one primary action, never a link's colour (linkClass is ink, underlined).
    peachLinks: onScreen.filter((el) => el.tagName === "A" && getComputedStyle(el).color === peach && getComputedStyle(el).backgroundColor !== peach).map(w.__styleName),
  };
}

function smallTargets({ controls }: { controls: string }) {
  const w = window as unknown as { __styleVisible: (el: Element) => boolean; __styleName: (el: Element) => string };
  return [...document.querySelectorAll(`${controls},input:not([type=hidden]),select,textarea,[role=tab],[role=link]`)]
    .filter((el) => w.__styleVisible(el))
    // A link inside a sentence is exempt (WCAG 2.5.8, inline): an inline link in running text, or with words around it.
    .filter((el) => !(el.tagName === "A" && getComputedStyle(el).display === "inline"
      && (el.closest("p,li,dd,td,blockquote,figcaption,label,legend")
        || (el.parentElement?.textContent ?? "").trim().length > (el.textContent ?? "").trim().length)))
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ rect }) => Math.min(rect.width, rect.height) < 43.5)
    .map(({ el, rect }) => `${w.__styleName(el)} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
}

function sidewaysScroll() {
  return [document.documentElement, document.querySelector(".spaces-shell__main")]
    .filter((el): el is Element => el !== null)
    .filter((el) => el.scrollWidth > el.clientWidth + 1)
    .map((el) => `${el === document.documentElement ? "the page" : ".spaces-shell__main"} is ${el.scrollWidth}px wide in ${el.clientWidth}px`);
}

async function axeFailures(page: Page): Promise<string[]> {
  const run = await axeRun(page);
  expect(run.version, "the pinned axe ran").toBe(AXE_VERSION);
  return describeViolations(run);
}

/* ---- The spec ---- */

for (const route of STYLE_ROUTES) {
  test(`${route.path} follows the style guide (as ${route.persona})`, async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name === "integration", "The style checks run in the desktop and phone projects.");
    const session = sessionFor(route.persona);
    test.skip(typeof session === "string", typeof session === "string" ? session : "");
    if (typeof session === "string") return;
    const phone = testInfo.project.name === "mobile-chromium";
    test.skip(!LOCAL && route.browserOnly === true, "The page refuses an agent's delegated session, and the preview's staff persona is one.");
    const everywhere = route.pending?.checks ?? [];
    const owed = new Set<StyleCheck>(IGNORE_PENDING ? [] : [...everywhere, ...(LOCAL ? [] : route.pending?.preview ?? [])]);
    const runs = phone ? MOBILE_CHECKS : DESKTOP_CHECKS;
    test.skip(runs.every((name) => owed.has(name)), route.pending?.todo ?? "");

    // A detail route opens its list first, and astro dev compiles each page on its first visit.
    test.slow();
    await signIn(page.context(), baseURL!, session);
    await page.addInitScript(PAGE_HELPERS);
    const path = await resolvePath(page, route);
    test.skip(path === null, `Nothing to open from ${route.detail?.from} in this environment.`);
    await open(page, path!);

    const nowPassing: StyleCheck[] = [];
    const passingOnPreview: StyleCheck[] = [];
    const check = async (name: StyleCheck, failures: () => Promise<string[]> | string[]) => {
      if (!runs.includes(name)) return;
      const found = await failures();
      if (owed.has(name)) {
        testInfo.annotations.push({ type: "pending", description: `${name}: ${route.pending?.todo}` });
        if (found.length === 0 && everywhere.includes(name)) nowPassing.push(name);
        else if (found.length === 0) passingOnPreview.push(name);
        return;
      }
      expect.soft(found, `${name} on ${path}`).toEqual([]);
    };

    if (!phone) {
      const facts = await page.evaluate(desktopFacts, { controls: CONTROLS, kitRing: KIT_RING });
      await check("h1", () => {
        const visible = facts.h1.filter((h) => h.visible);
        if (route.namedH1) return facts.h1.length === 1 ? [] : [`expected one named h1, found ${facts.h1.length}`];
        if (visible.length !== 1) return [`expected one visible h1, found ${visible.length}: ${visible.map((h) => h.text).join(" | ")}`];
        return /mattone/i.test(visible[0]!.font) ? [] : [`h1 "${visible[0]!.text}" is set in ${visible[0]!.font}, not the display face`];
      });
      await check("peach", () => (facts.peach.length > 1 ? [`${facts.peach.length} peach actions: ${facts.peach.join(", ")}`] : []));
      await check("kit-controls", () => [...facts.unkitted.map((c) => `not from the kit: ${c}`), ...facts.peachLinks.map((c) => `peach link: ${c}`)]);
      await check("axe", () => axeFailures(page));
    } else {
      await check("targets", () => page.evaluate(smallTargets, { controls: CONTROLS }));
      await page.setViewportSize({ width: 320, height: 800 });
      await check("overflow", () => page.evaluate(sidewaysScroll));
      await check("axe-320", () => axeFailures(page));
    }

    // A preview's data changes between runs, so a `preview` check that passes there is reported, not failed: prune it by hand.
    if (passingOnPreview.length > 0) {
      const note = `${route.path} passes its pending.preview checks ${passingOnPreview.join(", ")}: delete them from style-compliance.routes.ts`;
      testInfo.annotations.push({ type: "pending-passes", description: note });
      console.log(`STYLE-COMPLIANCE ${note}`);
    }

    // The seed is fixed locally, so a pending check that passes there is done: the list only shrinks.
    if (LOCAL && !IGNORE_PENDING) {
      expect(nowPassing, `${route.path} now passes these pending checks; delete them from style-compliance.routes.ts`).toEqual([]);
    }
  });
}
