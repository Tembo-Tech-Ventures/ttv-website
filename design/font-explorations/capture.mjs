/**
 * Heading-font exploration harness.
 *
 * Swaps `--font-heading` — the Tailwind theme token in `web/src/styles/global.css`
 * that drives `h1`, `h2` and the `.font-heading` utility — to a candidate display
 * face, waits for the webfont to genuinely load, and screenshots the same regions
 * of three pages so the candidates can be judged like-for-like.
 *
 * Usage:
 *   cd web && npm run dev                       # in one shell
 *   node design/font-explorations/capture.mjs   # in another
 *
 * This is design tooling; nothing here ships to the Worker. Adopting a font is a
 * two-line edit to `global.css` (the `@import` and `--font-heading`).
 */
import { chromium } from "../../web/node_modules/playwright-core/index.mjs";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "shots");

const selfHosted = (family, url, weight) =>
  `@font-face{font-family:"${family}";src:url("${url}") format("woff2");` +
  `font-weight:${weight};font-style:normal;font-display:block;}`;

/**
 * Fontshare serves protocol-relative URLs, which resolve to plain http from a
 * localhost page and then fail. Fetch the stylesheet and pin it to https.
 */
async function fontshareCss(spec) {
  const res = await fetch(
    `https://api.fontshare.com/v2/css?f%5B%5D=${encodeURIComponent(spec)}`
  );
  const css = await res.text();
  if (!css.includes("@font-face")) throw new Error(`Fontshare returned no faces for ${spec}`);
  return css.replaceAll("url('//", "url('https://");
}

const VARIANTS = [
  {
    id: "0-current-climate-crisis",
    label: "Current — Climate Crisis",
  },
  {
    id: "1-panchang",
    label: "Panchang Extrabold — Fontshare (Indian Type Foundry)",
    family: "Panchang",
    weight: 800,
    tracking: "-0.03em",
    fontshare: "panchang@800",
  },
  {
    id: "2-mattone",
    label: "Mattone Black — Collletttivo",
    family: "Mattone",
    weight: 900,
    tracking: "-0.02em",
    css: selfHosted(
      "Mattone",
      "https://raw.githubusercontent.com/collletttivo/mattone/main/fonts/Mattone-Black.woff2",
      900
    ),
  },
  {
    id: "3-bricolage-grotesque",
    label: "Bricolage Grotesque ExtraBold — Google Fonts",
    family: "Bricolage Grotesque",
    weight: 800,
    tracking: "-0.03em",
    link:
      "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,800&display=swap",
  },
];

/** Each view frames one place the display face actually has to work. */
const VIEWS = [
  { id: "1-home-hero", path: "/", width: 1440, height: 950, scrollTo: 0 },
  // Anchored to the section rather than a fixed offset: each candidate changes
  // the heading's height, so a fixed scrollTo would frame each one differently.
  { id: "2-home-sections", path: "/", width: 1440, height: 780, anchor: "#what-we-do", anchorOffset: 90 },
  { id: "3-hire", path: "/hire", width: 1440, height: 1400, scrollTo: 0 },
  { id: "4-talent", path: "/talent", width: 1440, height: 1200, scrollTo: 0 },
];

async function applyVariant(page, variant) {
  if (!variant.family) return;
  if (variant.link) await page.addStyleTag({ url: variant.link });
  if (variant.css) await page.addStyleTag({ content: variant.css });
  if (variant.fontshare) await page.addStyleTag({ content: await fontshareCss(variant.fontshare) });

  await page.addStyleTag({
    content: `
      :root { --font-heading: "${variant.family}", sans-serif !important; }
      h1, h2, .font-heading {
        font-family: "${variant.family}", sans-serif !important;
        font-weight: ${variant.weight} !important;
        letter-spacing: ${variant.tracking} !important;
      }
    `,
  });

  // A silent fallback to the system sans would invalidate the comparison, so
  // force the download and assert the face actually resolved.
  const loaded = await page.evaluate(async ({ family, weight }) => {
    await document.fonts.load(`${weight} 96px "${family}"`);
    await document.fonts.ready;
    return document.fonts.check(`${weight} 96px "${family}"`);
  }, variant);
  if (!loaded) throw new Error(`Font "${variant.family}" failed to load`);
}

/**
 * The homepage animates headings in with GSAP ScrollTrigger using
 * `toggleActions: play none none reverse`. Jumping straight to an offset can
 * leave a heading mid-fade, so walk down in steps and let the timelines finish.
 */
async function settle(page, view) {
  const target = view.anchor
    ? await page.evaluate(
        ({ anchor, offset }) =>
          Math.max(0, document.querySelector(anchor).getBoundingClientRect().top + window.scrollY - offset),
        { anchor: view.anchor, offset: view.anchorOffset ?? 0 }
      )
    : view.scrollTo;

  for (let y = 0; y <= target; y += 150) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(110);
  }
  await page.evaluate((v) => window.scrollTo(0, v), target);
  await page.waitForTimeout(2200);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();

  for (const view of VIEWS) {
    for (const variant of VARIANTS) {
      const context = await browser.newContext({
        viewport: { width: view.width, height: view.height },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      await page.goto(BASE_URL + view.path, { waitUntil: "networkidle" });
      await page.addStyleTag({ content: "astro-dev-toolbar{display:none !important;}" });
      await applyVariant(page, variant);
      await settle(page, view);

      const name = `${view.id}__${variant.id}.png`;
      await page.screenshot({ path: join(OUT_DIR, name) });
      console.log(`✓ ${name}  (${variant.label})`);
      await context.close();
    }
  }

  await browser.close();
}

await main();
