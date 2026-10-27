import { gsap } from "gsap";

/** Media queries shared by every motion module. */
export const MOTION = "(prefers-reduced-motion: no-preference)";
export const FINE_POINTER = "(hover: hover) and (pointer: fine)";
export const DESKTOP = "(min-width: 1024px)";

export function all<T extends Element = HTMLElement>(scope: Element | Document, selector: string): T[] {
  return [...scope.querySelectorAll<T>(selector)];
}

/** Groups word spans by the line they sit on, using layout (not transformed) positions. */
export function byLine(words: HTMLElement[]): HTMLElement[][] {
  const lines: HTMLElement[][] = [];
  let top = Number.NaN;
  for (const word of words) {
    const mask = word.parentElement ?? word;
    if (!(Math.abs(mask.offsetTop - top) < 4)) {
      lines.push([]);
      top = mask.offsetTop;
    }
    lines.at(-1)?.push(word);
  }
  return lines;
}

/**
 * Counts a numeral up to its own server-rendered value ("~25", "04"), keeping
 * prefix, suffix and zero padding. Writes to the existing text node rather
 * than replacing it, so assistive tech and text tracking see one stable node.
 */
export function countUp(element: HTMLElement, delay = 0): void {
  const node = element.firstChild;
  if (!(node instanceof Text)) return;
  const final = node.data;
  const match = /^(\D*)(\d+)(\D*)$/.exec(final.trim());
  if (!match) return;
  const [, prefix, digits, suffix] = match;
  const target = Number(digits);
  const counter = { value: 0 };
  const render = () => {
    node.data = `${prefix}${String(Math.round(counter.value)).padStart(digits.length, "0")}${suffix}`;
  };
  render();
  gsap.to(counter, {
    value: target,
    duration: 1.1,
    delay,
    ease: "power3.out",
    onUpdate: render,
    onComplete: () => {
      node.data = final;
    },
  });
}
