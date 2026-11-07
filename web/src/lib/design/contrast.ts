/*
 * WCAG 2 contrast arithmetic for the kit's colours: the numbers contrast.test.ts
 * proves and the public style guide prints. Translucent inks and tints are
 * composited onto the opaque surface below them first, as a browser would.
 */

export type Rgb = readonly [number, number, number];

/** "#F28D68" or "rgba(255, 248, 242, 0.72)" → its channels and alpha. */
export function parseColour(value: string): { rgb: Rgb; alpha: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const parts = value.match(/[\d.]+/g);
  if (!parts || parts.length < 3) throw new Error(`Cannot parse colour: ${value}`);
  return { rgb: [Number(parts[0]), Number(parts[1]), Number(parts[2])], alpha: Number(parts[3] ?? 1) };
}

/** `top` at `alpha` laid over the opaque `base`. */
export function over(top: Rgb, alpha: number, base: Rgb): Rgb {
  return [0, 1, 2].map((i) => alpha * top[i] + (1 - alpha) * base[i]) as unknown as Rgb;
}

export function luminance([r, g, b]: Rgb): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A colour value, composited onto `surface` if it is translucent. */
export function onSurface(value: string, surface: Rgb): Rgb {
  const { rgb, alpha } = parseColour(value);
  return over(rgb, alpha, surface);
}

/** "4.76:1": rounded down, so a printed ratio never claims more than it has. */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}
