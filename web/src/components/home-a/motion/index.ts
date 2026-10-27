import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { initBuilders } from "./builders";
import { playHeroIntro } from "./hero";
import { initPointer } from "./pointer";
import { initPrinciples } from "./principles";
import { initReveals } from "./reveals";
import { FINE_POINTER, MOTION } from "./shared";

/** Candidate A's motion. Every effect is scoped to a media query and reverts cleanly. */
export function initHomeA(): void {
  const root = document.querySelector<HTMLElement>("[data-ha-root]");
  if (!root) return;
  gsap.registerPlugin(ScrollTrigger);

  void playHeroIntro(root);

  const media = gsap.matchMedia();
  // The pin is created first so every trigger below it accounts for its spacer.
  initBuilders(root, media);
  media.add(MOTION, () => {
    initReveals(root);
    initPrinciples(root);
  });
  media.add(`${MOTION} and ${FINE_POINTER}`, () => initPointer(root));

  void document.fonts.ready.then(() => ScrollTrigger.refresh());
}
