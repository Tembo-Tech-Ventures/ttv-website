#!/usr/bin/env node
// Records a narrated MP4 walkthrough of the homepage (or any page).
//
//   node scripts/homepage-lab/record.mjs scripts/homepage-lab/tours/homepage.mjs ../.homepage-lab/videos/homepage.mp4
//
// The page runs inside an iframe on a 1920×1080 "stage" whose side panel
// carries the narration, so captions never cover the design. Frames come from
// the Chrome DevTools screencast (sharper than Playwright's built-in video) and
// are retimed into a constant 30 fps H.264 file. Each tour segment runs in its
// own browser context so phone segments get real touch and no-hover media.
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { BASE_URL } from "./lab.mjs";

const [tourPath, outFile] = process.argv.slice(2);
if (!tourPath || !outFile) {
  console.error("usage: record.mjs <tour.mjs> <out.mp4>");
  process.exit(2);
}
const tour = (await import(pathToFileURL(path.resolve(tourPath)).href)).default;
const workDir = path.resolve(path.dirname(outFile), `.${path.basename(outFile, ".mp4")}-work`);
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });

const mattone = readFileSync(new URL("../../src/assets/fonts/Mattone-Black.woff2", import.meta.url)).toString("base64");
const STAGE = { width: 1920, height: 1080 };
const DEVICES = {
  laptop: { frame: { width: 1440, height: 900 }, context: { isMobile: false, hasTouch: false } },
  phone: { frame: { width: 390, height: 844 }, context: { isMobile: true, hasTouch: true } },
};
const PERSONAS = {
  student: "Prospective student",
  mentor: "Mentor",
  partner: "Institutional partner",
  client: "Client with a project",
  juror: "Design juror",
};

function stageHtml(device, url, label) {
  const { frame } = DEVICES[device];
  const phone = device === "phone";
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Maven+Pro:wght@400;500;600;700&display=block">
<style>
@font-face { font-family: Mattone; src: url(data:font/woff2;base64,${mattone}) format("woff2"); }
* { box-sizing: border-box; margin: 0; }
html, body { width: ${STAGE.width}px; height: ${STAGE.height}px; overflow: hidden; }
body { background: radial-gradient(900px 600px at 80% 10%, rgba(242,141,104,.14), transparent 60%), #011a18; color: #FFF8F2; font-family: "Maven Pro", sans-serif; }
#head { position: absolute; left: 40px; top: 28px; right: 40px; display: flex; align-items: baseline; gap: 18px; }
#head b { font-family: Mattone; font-size: 26px; letter-spacing: -.01em; }
#head span { font-size: 18px; color: rgba(255,248,242,.7); }
#device { position: absolute; ${phone ? "left: 300px; top: 92px; padding: 14px; border-radius: 54px; background: #0b0b0b; box-shadow: 0 0 0 2px #333, 0 40px 80px rgba(0,0,0,.5);" : "left: 40px; top: 92px; border-radius: 14px; overflow: hidden; box-shadow: 0 0 0 1px rgba(242,141,104,.25), 0 40px 80px rgba(0,0,0,.5);"} }
#bar { display: ${phone ? "none" : "flex"}; height: 36px; align-items: center; gap: 8px; padding: 0 14px; background: #0d2d2a; }
#bar i { width: 11px; height: 11px; border-radius: 50%; background: rgba(255,248,242,.25); }
#bar span { margin-left: 18px; font-size: 13px; color: rgba(255,248,242,.6); }
iframe { display: block; width: ${frame.width}px; height: ${frame.height}px; border: 0; background: #013D39; ${phone ? "border-radius: 40px;" : ""} }
#panel { position: absolute; top: 92px; bottom: 60px; ${phone ? "left: 820px; right: 120px;" : "left: 1512px; right: 40px;"} display: flex; flex-direction: column; justify-content: center; gap: 22px; }
#panel .chapter { font-size: ${phone ? 22 : 17}px; font-weight: 600; color: #F28D68; }
#panel h2 { font-family: Mattone; font-weight: 900; font-size: ${phone ? 46 : 28}px; line-height: 1.12; letter-spacing: -.01em; }
#panel p { font-size: ${phone ? 26 : 19}px; line-height: 1.5; color: rgba(255,248,242,.86); }
#panel ul { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
#panel li { font-size: ${phone ? 18 : 14}px; font-weight: 600; padding: 6px 12px; border-radius: 999px; border: 1px solid rgba(242,141,104,.5); color: #FFF8F2; }
#panel li em { font-style: normal; color: #F28D68; }
#panel .why { display: grid; gap: 10px; }
#panel .why div { font-size: ${phone ? 21 : 16}px; line-height: 1.45; color: rgba(255,248,242,.8); padding-left: 14px; border-left: 2px solid #F28D68; }
#panel > * { transition: opacity .45s ease, transform .45s ease; }
#panel.out > * { opacity: 0; transform: translateY(14px); }
#card { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; padding: 0 180px; gap: 28px; background: #012a28; transition: opacity .7s ease; z-index: 5; }
#card.hidden { opacity: 0; pointer-events: none; }
#card h1 { font-family: Mattone; font-size: 76px; line-height: 1.05; letter-spacing: -.015em; max-width: 1400px; }
#card p { font-size: 30px; line-height: 1.5; color: rgba(255,248,242,.82); max-width: 1300px; }
#card small { font-size: 20px; color: #F28D68; font-weight: 600; }
</style></head><body>
<div id="head"><b>TTV homepage</b><span>${label}</span></div>
<div id="device"><div id="bar"><i></i><i></i><i></i><span>tembotechventures.com</span></div><iframe id="site" src="${url}"></iframe></div>
<aside id="panel" class="out"></aside>
<div id="card" class="hidden"></div>
</body></html>`;
}

/** Visible pointer and tap ripples inside the recorded page. */
function cursorScript() {
  if (window.top === window) return;
  const install = () => {
    const style = document.createElement("style");
    style.textContent = `
      #lab-cursor { position: fixed; z-index: 2147483647; left: 0; top: 0; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
        border: 2px solid #FFF8F2; background: rgba(242,141,104,.45); box-shadow: 0 2px 10px rgba(0,0,0,.4); pointer-events: none; transition: transform .15s ease; }
      #lab-cursor.down { transform: scale(.7); }
      .lab-ripple { position: fixed; z-index: 2147483647; width: 54px; height: 54px; margin: -27px 0 0 -27px; border-radius: 50%; border: 3px solid #F28D68;
        pointer-events: none; animation: lab-ripple .6s ease-out forwards; }
      @keyframes lab-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }
      astro-dev-toolbar, vite-error-overlay { display: none !important; }`;
    document.head.append(style);
    const cursor = document.createElement("div");
    cursor.id = "lab-cursor";
    cursor.style.display = "none";
    document.body.append(cursor);
    const touch = window.matchMedia("(hover: none)").matches;
    window.addEventListener("mousemove", (event) => {
      if (touch) return;
      cursor.style.display = "block";
      cursor.style.left = `${event.clientX}px`;
      cursor.style.top = `${event.clientY}px`;
    }, { passive: true });
    window.addEventListener("mousedown", () => cursor.classList.add("down"));
    window.addEventListener("mouseup", () => cursor.classList.remove("down"));
    window.labRipple = (x, y) => {
      const ripple = document.createElement("div");
      ripple.className = "lab-ripple";
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      document.body.append(ripple);
      window.setTimeout(() => ripple.remove(), 700);
    };
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
}

async function proxyFonts(context) {
  await context.route(/fonts\.(googleapis|gstatic)\.com/, async (route) => {
    const response = await fetch(route.request().url(), { headers: { "user-agent": route.request().headers()["user-agent"] ?? "Mozilla/5.0" } });
    await route.fulfill({
      status: response.status,
      body: Buffer.from(await response.arrayBuffer()),
      headers: { "content-type": response.headers.get("content-type") ?? "text/css", "access-control-allow-origin": "*" },
    });
  });
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

async function recordSegment(segment, index) {
  const device = DEVICES[segment.device];
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: STAGE, deviceScaleFactor: 1, ...device.context });
  await proxyFonts(context);
  await context.addInitScript(cursorScript);
  const page = await context.newPage();
  const url = new URL(tour.path, BASE_URL).toString();
  await page.setContent(stageHtml(segment.device, url, tour.label), { waitUntil: "load" });
  const frame = page.frames().find((candidate) => candidate.url().startsWith(BASE_URL));
  await frame.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready);
  await frame.evaluate(() => document.fonts.ready);

  const framesDir = path.join(workDir, `seg${index}`);
  mkdirSync(framesDir);
  const shots = [];
  const cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const file = path.join(framesDir, `${String(shots.length).padStart(6, "0")}.jpg`);
    writeFileSync(file, Buffer.from(data, "base64"));
    shots.push({ file, time: metadata.timestamp });
    await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });

  const box = async (selector) => {
    const handle = frame.locator(selector).first();
    await handle.scrollIntoViewIfNeeded().catch(() => {});
    const rect = await handle.boundingBox();
    if (!rect) throw new Error(`no box for ${selector}`);
    return rect;
  };
  let pointer = { x: device.frame.width * 0.7, y: device.frame.height * 0.6 };
  const offset = await page.locator("#site").boundingBox();

  const t = {
    page,
    frame,
    device: segment.device,
    pause: (ms) => page.waitForTimeout(ms),
    async caption({ chapter = "", title, body = "", why = [], personas = [] }) {
      await page.evaluate((content) => {
        const panel = document.querySelector("#panel");
        panel.classList.add("out");
        window.setTimeout(() => {
          panel.innerHTML = "";
          const add = (tag, text, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; el.innerHTML = text; panel.append(el); return el; };
          if (content.chapter) add("div", content.chapter, "chapter");
          add("h2", content.title);
          if (content.body) add("p", content.body);
          if (content.why.length > 0) { const list = add("div", "", "why"); for (const line of content.why) { const d = document.createElement("div"); d.innerHTML = line; list.append(d); } }
          if (content.personas.length > 0) { const list = add("ul", ""); for (const persona of content.personas) { const li = document.createElement("li"); li.innerHTML = persona; list.append(li); } }
          window.requestAnimationFrame(() => panel.classList.remove("out"));
        }, 380);
      }, { chapter, title, body, why, personas: personas.map((p) => (PERSONAS[p.id] ? `<em>${PERSONAS[p.id]}</em> · ${p.text}` : p)) });
      await page.waitForTimeout(500);
    },
    async card({ title, body = "", small = "" }) {
      await page.evaluate((content) => {
        const card = document.querySelector("#card");
        card.innerHTML = `${content.small ? `<small>${content.small}</small>` : ""}<h1>${content.title}</h1>${content.body ? `<p>${content.body}</p>` : ""}`;
        card.classList.remove("hidden");
      }, { title, body, small });
      await page.waitForTimeout(800);
    },
    async hideCard() {
      await page.evaluate(() => document.querySelector("#card").classList.add("hidden"));
      await page.waitForTimeout(800);
    },
    /** Moves the visible pointer along an eased path to a point inside the page. */
    async moveTo(target, ms = 900) {
      const rect = typeof target === "string" ? await box(target) : null;
      const goal = rect ? { x: rect.x - offset.x + rect.width / 2, y: rect.y - offset.y + rect.height / 2 } : target;
      // Paced by the clock, not by a fixed step count: each input event waits
      // for the page to handle it, and on a heavy page in a GPU-less container
      // that can take 100 ms+, which stretched a 1 s move to 7 s.
      const start = pointer;
      const began = Date.now();
      for (let k = 0; k < 1; ) {
        k = Math.min(1, (Date.now() - began) / ms);
        const e = ease(k);
        await page.mouse.move(offset.x + start.x + (goal.x - start.x) * e, offset.y + start.y + (goal.y - start.y) * e);
        await page.waitForTimeout(8);
      }
      pointer = goal;
    },
    /** A point inside an element, as fractions of its box, in page coordinates. */
    async point(selector, fx = 0.5, fy = 0.5) {
      const rect = await box(selector);
      return { x: rect.x - offset.x + rect.width * fx, y: rect.y - offset.y + rect.height * fy };
    },
    /** Clicks an element, or a point from `point()`, with the visible pointer. */
    async click(target) {
      await t.moveTo(target, 700);
      await page.mouse.down();
      await page.waitForTimeout(120);
      await page.mouse.up();
    },
    async tap(selector) {
      const rect = await box(selector);
      const x = rect.x - offset.x + rect.width / 2;
      const y = rect.y - offset.y + rect.height / 2;
      await frame.evaluate((point) => window.labRipple?.(point.x, point.y), { x, y });
      await frame.locator(selector).first().tap();
    },
    async press(key, times = 1, gap = 450) {
      for (let i = 0; i < times; i += 1) {
        await page.keyboard.press(key);
        await page.waitForTimeout(gap);
      }
    },
    /** Reloads the page so its intro plays again on camera. */
    async reload() {
      await frame.goto(url, { waitUntil: "load" });
      await frame.evaluate(() => document.fonts.ready);
    },
    /** Swipes a horizontal track by a distance, smoothly, with a touch ripple. */
    async swipe(selector, dx, ms = 700) {
      const rect = await box(selector);
      const x = rect.x - offset.x + rect.width * 0.7;
      const y = rect.y - offset.y + rect.height / 2;
      await frame.evaluate((point) => window.labRipple?.(point.x, point.y), { x, y });
      await frame.locator(selector).first().evaluate((el, distance) => el.scrollBy({ left: distance, behavior: "smooth" }), dx);
      await page.waitForTimeout(ms);
    },
    /** Smoothly scrolls the page by wheel, like a person with a trackpad. */
    async scrollBy(dy, ms = 1600) {
      await page.mouse.move(offset.x + pointer.x, offset.y + pointer.y);
      // Clock-paced like moveTo: slow input handling yields fewer, larger
      // wheel steps rather than a longer scroll.
      const began = Date.now();
      let done = 0;
      for (let k = 0; k < 1; ) {
        k = Math.min(1, (Date.now() - began) / ms);
        const next = Math.round(dy * ease(k));
        if (next !== done) await page.mouse.wheel(0, next - done);
        done = next;
        await page.waitForTimeout(8);
      }
    },
    async scrollTo(target, ms = 1800, offsetPx = 0) {
      const y = typeof target === "number" ? target : await frame.evaluate(({ sel, off }) => {
        const el = document.querySelector(sel);
        return el ? el.getBoundingClientRect().top + window.scrollY - off : window.scrollY;
      }, { sel: target, off: offsetPx });
      const current = await frame.evaluate(() => window.scrollY);
      await t.scrollBy(y - current, ms);
    },
  };

  await cdp.send("Page.startScreencast", { format: "jpeg", quality: Number(process.env.HOMEPAGE_LAB_JPEG_QUALITY ?? 90), maxWidth: STAGE.width, maxHeight: STAGE.height, everyNthFrame: 1 });
  await page.waitForTimeout(300);
  await segment.run(t);
  await page.waitForTimeout(600);
  await cdp.send("Page.stopScreencast");
  await browser.close();

  // Retime the variable-rate screencast into exact per-frame durations.
  const list = shots.map((shot, i) => {
    const next = shots[i + 1]?.time ?? shot.time + 0.5;
    return `file '${shot.file}'\nduration ${Math.max(0.001, next - shot.time).toFixed(4)}`;
  });
  list.push(`file '${shots.at(-1).file}'`);
  const listFile = path.join(workDir, `seg${index}.txt`);
  writeFileSync(listFile, list.join("\n"));
  const segmentFile = path.join(workDir, `seg${index}.mp4`);
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile,
    "-vf", `scale=${STAGE.width}:${STAGE.height}:force_original_aspect_ratio=decrease,pad=${STAGE.width}:${STAGE.height}:(ow-iw)/2:(oh-ih)/2:color=0x011a18,fps=30,format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart", segmentFile]);
  console.log(`segment ${index} (${segment.device}): ${shots.length} frames, ${(shots.at(-1).time - shots[0].time).toFixed(1)}s`);
  return segmentFile;
}

const segments = [];
for (const [index, segment] of tour.segments.entries()) segments.push(await recordSegment(segment, index));
const concatFile = path.join(workDir, "segments.txt");
writeFileSync(concatFile, segments.map((file) => `file '${file}'`).join("\n"));
mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", "-movflags", "+faststart", path.resolve(outFile)]);
const duration = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.resolve(outFile)]).toString().trim();
console.log(`wrote ${outFile} (${Number(duration).toFixed(1)}s)`);
