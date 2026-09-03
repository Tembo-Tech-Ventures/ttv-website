import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve, join } from "node:path";

/**
 * The ink ramp has to stay legible against the surfaces it is actually used on.
 *
 * This exists because the tokens themselves were the bug: `--color-ink-muted`
 * shipped at 0.48 alpha, which is 3.86:1 on `--color-dark` — so "adopt the
 * design system" was advice that produced inaccessible text. Nothing caught it,
 * including axe, because the app's backgrounds are gradients and axe reports
 * those as `incomplete` rather than failing.
 *
 * Colour maths in a unit test cannot see a real page, so it deliberately checks
 * the *worst* surface each token is allowed on rather than a representative one.
 */
const CSS = readFileSync(join(resolve(__dirname, ".."), "styles/global.css"), "utf8");

const WCAG_AA_BODY = 4.5;

function token(name: string) {
  const match = new RegExp(`--color-${name}:\\s*([^;]+);`).exec(CSS);
  if (!match) throw new Error(`--color-${name} is not defined in global.css`);
  return match[1].trim();
}

function toRgb(value: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const parts = value.match(/[\d.]+/g);
  if (!parts) throw new Error(`Cannot parse colour: ${value}`);
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

function alphaOf(value: string) {
  const parts = value.match(/[\d.]+/g);
  return value.startsWith("rgba") && parts?.[3] !== undefined ? Number(parts[3]) : 1;
}

function relativeLuminance([r, g, b]: [number, number, number]) {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast of a (possibly translucent) ink composited over an opaque surface. */
export function contrastOnSurface(ink: string, surface: string) {
  const surfaceRgb = toRgb(surface);
  const inkRgb = toRgb(ink);
  const alpha = alphaOf(ink);
  const composited = inkRgb.map((c, i) => alpha * c + (1 - alpha) * surfaceRgb[i]) as [
    number,
    number,
    number,
  ];
  const [hi, lo] = [relativeLuminance(composited), relativeLuminance(surfaceRgb)].toSorted(
    (a, b) => b - a
  );
  return (hi + 0.05) / (lo + 0.05);
}

/*
 * Every surface body text is placed on. `--color-surface` is the light end of
 * the app shell's gradient and the binding constraint — checking only
 * `--color-dark` understates the problem by more than a whole ratio point.
 *
 * `--color-teal` is deliberately absent: it is a border and translucent-fill
 * accent (135 border uses), and the single place opaque `bg-teal` carries text
 * is a 30px bold avatar initial, which clears the 3:1 large-text bar.
 */
const SURFACES = ["dark", "bg-raised", "surface"] as const;

describe("ink ramp contrast", () => {
  for (const inkName of ["ink-primary", "ink-secondary", "ink-muted"] as const) {
    for (const surfaceName of SURFACES) {
      it(`${inkName} meets WCAG AA on ${surfaceName}`, () => {
        const ratio = contrastOnSurface(token(inkName), token(surfaceName));
        expect(
          ratio,
          `${inkName} on --color-${surfaceName} is ${ratio.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(WCAG_AA_BODY);
      });
    }
  }

  it("keeps the ramp ordered, so the tokens still mean something", () => {
    // A fix that raises muted until it passes can quietly make it identical to
    // secondary, at which point the scale conveys nothing.
    const [primary, secondary, muted] = ["ink-primary", "ink-secondary", "ink-muted"].map(
      (name) => alphaOf(token(name))
    );
    expect(primary).toBeGreaterThan(secondary);
    expect(secondary).toBeGreaterThan(muted);
  });
});

/*
 * The token fix only protects text that uses the tokens. 198 utilities bypassed
 * them entirely, and every band at or below `/60` is below 4.5:1 on
 * `--color-surface`, so reintroducing one silently reintroduces the bug.
 */
const FAILING_OPACITY_BANDS = /text-white\/(?:[0-5]\d|60)\b/g;
const MARKUP = [".astro", ".tsx"];

async function markupFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return markupFiles(path);
      return MARKUP.some((ext) => entry.name.endsWith(ext)) ? [path] : [];
    })
  );
  return nested.flat();
}

describe("raw text opacities", () => {
  it("never uses a white opacity that cannot reach AA", async () => {
    const files = await markupFiles(resolve(__dirname, ".."));
    const offenders = files.flatMap((file) => {
      const matches = readFileSync(file, "utf8").match(FAILING_OPACITY_BANDS) ?? [];
      return matches.map((match) => `${file.replace(/^.*\/src\//, "src/")}: ${match}`);
    });

    expect(
      offenders,
      `Use text-ink-muted (0.64) or text-ink-secondary (0.72) instead:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});
