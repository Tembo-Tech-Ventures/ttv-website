import { gsap } from "gsap";
import { all } from "./shared";

/**
 * Each principle fills from outline to solid peach as it crosses the middle
 * of the screen, scrubbed to the scroll, and its commitment slides in beside
 * it. Reversible: scrolling back empties the word again.
 */
export function initPrinciples(root: HTMLElement): void {
  for (const value of all(root, "[data-ha-value]")) {
    const word = value.querySelector<HTMLElement>("[data-ha-word]");
    const commitment = value.querySelector<HTMLElement>("[data-ha-commitment]");
    if (!word || !commitment) continue;
    gsap
      .timeline({ scrollTrigger: { trigger: value, start: "top 72%", end: "bottom 42%", scrub: 0.5 } })
      .fromTo(word, { "--ha-fill": "0%" }, { "--ha-fill": "100%", ease: "none", duration: 1 }, 0)
      .fromTo(
        commitment,
        // A short slide on phones, where the copy already spans the full width.
        { x: () => Math.min(56, window.innerWidth * 0.06), opacity: 0.15 },
        { x: 0, opacity: 1, ease: "power2.out", duration: 0.45 },
        0,
      );
  }
}
