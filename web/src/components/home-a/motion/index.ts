import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { initBuilders } from "./builders";
import { countHeroFacts, initCohortMotion } from "./cohort";
import { initPointer } from "./pointer";
import { initPrinciples } from "./principles";
import { initReveals } from "./reveals";
import { FINE_POINTER, MOTION } from "./shared";

/** Candidate A's motion. Every effect is scoped to a media query and reverts cleanly. */
export function initHomeA(): void {
  const root = document.querySelector<HTMLElement>("[data-ha-root]");
  if (!root) return;
  gsap.registerPlugin(ScrollTrigger);

  // The hero intro itself is pure CSS (home-a.css); script only counts the first fact.
  countHeroFacts(root);

  const media = gsap.matchMedia();
  // Triggers are created in page order, so those below the pin account for its spacer.
  initCohortMotion(root, media);
  initBuilders(root, media);
  media.add(MOTION, () => {
    initReveals(root);
    initPrinciples(root);
  });
  media.add(`${MOTION} and ${FINE_POINTER}`, () => initPointer(root));

  void document.fonts.ready.then(() => ScrollTrigger.refresh());
}
