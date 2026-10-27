import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Conditions } from "./types";

/**
 * Principles: each finished outline is uncovered left to right behind a
 * peach caret, rows cascading, and its commitment slides in beside it. The
 * word is always whole letters: there is no frame with a fragment of a glyph.
 * Reduced motion shows every outline and commitment from the start.
 */
export function setupPrinciples(root: HTMLElement, c: Conditions): () => void {
  if (!c.motion) return () => {};
  const rows = gsap.utils.toArray<HTMLElement>("[data-hc-principle]", root);
  const inks = rows.map((row) => row.querySelector<HTMLElement>(".hc-principle__ink"));
  const commitments = rows.map((row) => row.querySelector<HTMLElement>("[data-hc-commitment]"));

  rows.forEach((row, i) => {
    const ink = inks[i];
    if (!ink) return;
    row.classList.add("hc-wiping");
    gsap.set(ink, { "--hc-wipe": "100%", "--hc-caret": 0 });
    if (commitments[i]) gsap.set(commitments[i], { opacity: 0, x: c.wide ? 28 : 0, y: c.wide ? 0 : 14 });
  });

  ScrollTrigger.batch(rows, {
    start: "top bottom",
    once: true,
    onEnter: (batch) => {
      batch.forEach((row, n) => {
        const i = rows.indexOf(row as HTMLElement);
        const ink = inks[i];
        const delay = n * 0.1;
        if (ink) {
          // The clip goes the moment the outline is whole; the caret fades after.
          gsap.timeline({ delay, onComplete: () => row.classList.remove("hc-caret-on") })
            .add(() => row.classList.add("hc-caret-on"))
            .set(ink, { "--hc-caret": 1 })
            .to(ink, { "--hc-wipe": "0%", duration: 0.75, ease: "power3.inOut" })
            .add(() => row.classList.remove("hc-wiping"))
            .to(ink, { "--hc-caret": 0, duration: 0.25 });
        }
        if (commitments[i]) {
          gsap.to(commitments[i], { opacity: 1, x: 0, y: 0, duration: 0.6, delay: delay + 0.3, ease: "power3.out", clearProps: "opacity,transform" });
        }
      });
    },
  });

  return () => {
    rows.forEach((row) => row.classList.remove("hc-wiping", "hc-caret-on"));
    gsap.set(inks.filter(Boolean), { clearProps: "--hc-wipe,--hc-caret" });
  };
}
