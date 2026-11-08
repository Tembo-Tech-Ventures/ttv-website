import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { slug } from "github-slugger";
import { describe, expect, it } from "vitest";
import {
  SCREENSHOT_DIRECTORY,
  SHOTS,
  VIEWPORTS,
  localOrigin,
  localSessionCookie,
  personaToken,
} from "./readme-shots.mjs";

/**
 * The repository README is what a visitor reads first, so it is held to what the repository
 * actually contains: its links and paths exist, its commands are real scripts, and its screenshots
 * are the ones scripts/readme-shots.mjs takes.
 */

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");
const readFromRoot = (relativePath) => readFile(path.join(repositoryRoot, relativePath), "utf8");

const readme = await readFromRoot("README.md");
const packageJson = JSON.parse(await readFromRoot("web/package.json"));
const ciWorkflow = await readFromRoot(".github/workflows/ci.yml");

/** Paths the README names that are created locally rather than committed. */
const LOCAL_ONLY_PATHS = new Set(["web/.wrangler/", "web/.dev.vars"]);

/** A screenshot is shown on GitHub at a fraction of its size; this keeps clones light. */
const MAX_SCREENSHOT_BYTES = 500 * 1024;

/** The README without fenced code blocks or inline code, where brackets are not links. */
function prose(markdown) {
  return markdown.replace(/^```[\s\S]*?^```$/gm, "").replace(/`[^`\n]*`/g, "");
}

/** GitHub's anchor for a heading. */
const headingSlug = (heading) => slug(heading.trim());

function markdownLinks(markdown) {
  return [...prose(markdown).matchAll(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g)].map(([, bang, text, target]) => ({
    image: bang === "!",
    text,
    target,
  }));
}

function htmlImages(markdown) {
  return [...prose(markdown).matchAll(/<img\b[^>]*>/g)].map(([tag]) => ({
    src: tag.match(/\bsrc="([^"]*)"/)?.[1],
    alt: tag.match(/\balt="([^"]*)"/)?.[1],
  }));
}

function images(markdown) {
  return [
    ...markdownLinks(markdown).filter((link) => link.image).map((link) => ({ src: link.target, alt: link.text })),
    ...htmlImages(markdown),
  ];
}

const isExternal = (target) => /^[a-z][a-z0-9+.-]*:/i.test(target);

/** Width and height from a PNG's IHDR chunk, or null when the bytes are not a PNG. */
function pngSize(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, index) => bytes[index] === byte)) return null;
  if (bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("README links", () => {
  it("points every relative link and image at a file in the repository", () => {
    const targets = [
      ...markdownLinks(readme).map((link) => link.target),
      ...htmlImages(readme).map((image) => image.src ?? ""),
    ].filter((target) => !isExternal(target) && !target.startsWith("#"));

    expect(targets.length).toBeGreaterThan(10);
    const missing = targets.filter((target) => !existsSync(path.join(repositoryRoot, target.split("#")[0])));
    expect(missing).toEqual([]);
  });

  it("links in-page only to headings that exist", () => {
    const slugs = new Set([...prose(readme).matchAll(/^#{1,6}\s+(.+)$/gm)].map(([, heading]) => headingSlug(heading)));
    const anchors = markdownLinks(readme).map((link) => link.target).filter((target) => target.startsWith("#"));

    expect(anchors.length).toBeGreaterThan(5);
    expect(anchors.filter((anchor) => !slugs.has(anchor.slice(1)))).toEqual([]);
  });

  it("lists every second-level section in its contents", () => {
    const sections = [...prose(readme).matchAll(/^##\s+(.+)$/gm)].map(([, heading]) => heading.trim());
    const contents = readme.slice(readme.indexOf("## Contents"), readme.indexOf("\n## ", readme.indexOf("## Contents") + 1));
    const listed = [...contents.matchAll(/\]\(#([^)]+)\)/g)].map(([, anchor]) => anchor);

    expect(listed).toEqual(sections.filter((section) => section !== "Contents").map(headingSlug));
  });

  it("names only repository paths that exist", () => {
    const paths = [...readme.matchAll(/`((?:web|docs|\.github)\/[^`\s*<>]+)`/g)].map(([, name]) => name);

    expect(paths.length).toBeGreaterThan(5);
    const missing = paths.filter((name) => !LOCAL_ONLY_PATHS.has(name) && !existsSync(path.join(repositoryRoot, name)));
    expect(missing).toEqual([]);
  });
});

describe("README commands", () => {
  it("documents only npm scripts that web/package.json defines", () => {
    const scripts = [...readme.matchAll(/\bnpm run ([\w:-]+)/g)].map(([, name]) => name);

    expect(scripts.length).toBeGreaterThan(10);
    expect(scripts.filter((name) => !(name in packageJson.scripts))).toEqual([]);
    expect(readme).toContain("npm test");
    expect(packageJson.scripts.test).toBeTruthy();
  });

  it("lists every script a contributor runs, and leaves the deployment scripts to the workflows", () => {
    const documented = new Set([...readme.matchAll(/`npm run ([\w:-]+)`/g)].map(([, name]) => name));
    const undocumented = Object.keys(packageJson.scripts)
      .filter((name) => !["test", "db:import"].includes(name) && !name.startsWith("cf:"))
      .filter((name) => !documented.has(name));

    expect(undocumented).toEqual([]);
    expect(readme).toContain("The `cf:*` scripts");
  });

  it("installs and runs on the Node version and install command CI uses", () => {
    const ciNode = ciWorkflow.match(/node-version:\s*(\d+)/)?.[1];

    expect(ciNode).toBeTruthy();
    expect(readme).toContain(`Node.js ${ciNode}`);
    expect(ciWorkflow).toContain("npm ci --legacy-peer-deps");
    expect(readme).toContain("npm ci --legacy-peer-deps");
  });
});

describe("README screenshots", () => {
  it("describes every image for people who cannot see it", () => {
    const shown = images(readme);

    expect(shown.length).toBeGreaterThan(0);
    for (const image of shown) {
      expect(image.alt?.trim().length ?? 0, `${image.src}`).toBeGreaterThan(20);
    }
  });

  it("shows exactly the screenshots scripts/readme-shots.mjs takes", () => {
    const shown = images(readme).map((image) => image.src).toSorted();
    const taken = SHOTS.map((shot) => `${SCREENSHOT_DIRECTORY}/${shot.file}`).toSorted();

    expect(shown).toEqual(taken);
  });

  it.each(SHOTS)("keeps $file at the size its viewport produces", async (shot) => {
    const bytes = await readFile(path.join(repositoryRoot, SCREENSHOT_DIRECTORY, shot.file));
    const { viewport, deviceScaleFactor } = VIEWPORTS[shot.viewport];

    expect(pngSize(bytes)).toEqual({
      width: viewport.width * deviceScaleFactor,
      height: viewport.height * deviceScaleFactor,
    });
    expect(bytes.length).toBeLessThanOrEqual(MAX_SCREENSHOT_BYTES);
  });

  it("signs in only as people the fictional local seed defines", async () => {
    const seed = await readFromRoot("web/e2e/platform-personas.local.sql");
    const personas = SHOTS.flatMap((shot) => (shot.persona ? [shot.persona] : []));

    expect(personas.length).toBeGreaterThan(0);
    for (const persona of personas) expect(seed).toContain(`'${personaToken(persona)}'`);
    expect(seed).toMatch(/^-- Fictional local personas/);
  });
});

describe("local-only screenshots", () => {
  it("signs the session token the way Better Auth does", () => {
    // better-call's serializeSignedCookie("better-auth.session_token", "tok", "sec") gives
    // tok.sTUSNW0UA9JEmqLnNpIU8EWfDTwIy3QrCv9P5XquNvU%3D
    expect(localSessionCookie("http://127.0.0.1:4321", "tok", "sec")).toEqual({
      name: "better-auth.session_token",
      value: "tok.sTUSNW0UA9JEmqLnNpIU8EWfDTwIy3QrCv9P5XquNvU%3D",
      url: "http://127.0.0.1:4321",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    });
  });

  it.each([
    "https://tembotechventures.com",
    "https://staging.tembotechventures.com",
    "https://ttv-website-agent-pr-1.example.workers.dev",
    "http://192.168.1.20:4321",
    "http://localhost.example.com:4321",
    "https://127.0.0.1:4321",
  ])("refuses %s", (origin) => {
    expect(() => localOrigin(origin)).toThrow(/only on a local build/);
    expect(() => localSessionCookie(origin, "tok", "sec")).toThrow(/only on a local build/);
  });

  it.each(["http://127.0.0.1:4321/", "http://localhost:4330", "http://[::1]:4321"])("accepts %s", (origin) => {
    expect(localOrigin(origin)).toBe(new URL(origin).origin);
  });

  it("asks for the build's secret instead of signing with none", () => {
    expect(() => localSessionCookie("http://localhost:4321", "tok", "")).toThrow(/PLATFORM_PERSONAS_LOCAL_SECRET/);
  });
});
