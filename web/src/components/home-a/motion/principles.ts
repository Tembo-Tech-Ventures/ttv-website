import { gsap } from "gsap";
import { all } from "./shared";

/**
 * Each principle starts as an outline and fills to solid peach as it crosses
 * the middle of the screen, scrubbed to the scroll; its commitment slides in
 * early and stays legible throughout. Reversible. The server-rendered (and
 * reduced-motion) state is the finished, filled one.
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
        { x: 24, opacity: 0.55 },
        { x: 0, opacity: 1, ease: "power2.out", duration: 0.25 },
        0,
      );
  }
}
