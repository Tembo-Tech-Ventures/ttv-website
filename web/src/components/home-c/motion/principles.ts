import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Conditions } from "./types";

/** Longer than any glyph contour in Mattone at 100 units, so every outline draws fully. */
const DASH = 760;

/**
 * Principles: each outlined word traces itself, then takes a soft peach fill,
 * and its commitment slides in beside it. Reduced motion shows the finished
 * outlines and every commitment from the start.
 */
export function setupPrinciples(root: HTMLElement, c: Conditions): () => void {
  if (!c.motion) return () => {};
  const rows = root.querySelectorAll<HTMLElement>("[data-hc-principle]");
  rows.forEach((row) => {
    const text = row.querySelector<SVGTextElement>(".hc-principle__text");
    const commitment = row.querySelector<HTMLElement>("[data-hc-commitment]");
    if (!text) return;
    gsap.set(text, { strokeDasharray: DASH, strokeDashoffset: DASH, fillOpacity: 0 });
    if (commitment) gsap.set(commitment, { autoAlpha: 0, x: c.wide ? 32 : 0, y: c.wide ? 0 : 16 });
    ScrollTrigger.create({
      trigger: row,
      start: "top 92%",
      once: true,
      onEnter: () => {
        gsap.timeline()
          .to(text, { strokeDashoffset: 0, duration: 1.5, ease: "power2.inOut" })
          .to(text, { fillOpacity: 1, duration: 0.6, ease: "power1.out", clearProps: "strokeDasharray,strokeDashoffset,fillOpacity" }, ">-0.35")
          .to(commitment ?? {}, { autoAlpha: 1, x: 0, y: 0, duration: 0.55, ease: "power3.out" }, 0.1);
      },
    });
  });
  return () => {};
}
