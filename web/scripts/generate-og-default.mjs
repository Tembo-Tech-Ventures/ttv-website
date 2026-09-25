import { readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(scriptDirectory, "..");
const fontPath = resolve(webRoot, "src/assets/fonts/Mattone-Black.woff2");
const outputPath = resolve(webRoot, "public/og-default.png");

const font = (await readFile(fontPath)).toString("base64");
await mkdir(dirname(outputPath), { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(`<!doctype html>
    <html>
      <head>
        <style>
          @font-face {
            font-family: "Mattone";
            src: url(data:font/woff2;base64,${font}) format("woff2");
            font-weight: 900;
          }
          * { box-sizing: border-box; }
          html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
          body {
            position: relative;
            display: flex;
            align-items: center;
            background:
              radial-gradient(750px 520px at 92% 12%, rgba(242, 141, 104, 0.22), transparent 62%),
              radial-gradient(620px 420px at 3% 104%, rgba(32, 126, 116, 0.42), transparent 70%),
              #012a28;
            color: #f7f0df;
            font-family: Arial, sans-serif;
          }
          body::before {
            content: "";
            position: absolute;
            inset: 32px;
            border: 1px solid rgba(247, 240, 223, 0.22);
          }
          .accent {
            position: absolute;
            top: 0;
            left: 0;
            width: 18px;
            height: 630px;
            background: #f28d68;
          }
          .content { position: relative; width: 100%; padding: 0 96px; }
          .eyebrow {
            margin: 0 0 32px;
            color: #f28d68;
            font-size: 22px;
            font-weight: 700;
            letter-spacing: 0.34em;
            text-transform: uppercase;
          }
          .wordmark {
            margin: 0;
            font-family: "Mattone", Arial, sans-serif;
            font-size: 168px;
            font-weight: 900;
            letter-spacing: -0.035em;
            line-height: 0.82;
          }
          .rule {
            width: 148px;
            height: 9px;
            margin-top: 42px;
            background: #f28d68;
          }
          .tagline {
            margin: 28px 0 0;
            color: rgba(247, 240, 223, 0.82);
            font-size: 27px;
            letter-spacing: 0.06em;
          }
          .mark {
            position: absolute;
            right: 96px;
            bottom: 72px;
            width: 66px;
            height: 66px;
            border: 8px solid #f28d68;
            border-radius: 50%;
          }
        </style>
      </head>
      <body>
        <div class="accent"></div>
        <main class="content">
          <p class="eyebrow">Tech · Ventures</p>
          <h1 class="wordmark">TEMBO</h1>
          <div class="rule"></div>
          <p class="tagline">Practical tech communities across Africa.</p>
        </main>
        <div class="mark" aria-hidden="true"></div>
      </body>
    </html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: outputPath, type: "png" });
} finally {
  await browser.close();
}

console.log(`Wrote ${outputPath}`);
