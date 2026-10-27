import { gsap } from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { setupBuilders } from "./builders";
import { setupCommunity } from "./community";
import { setupHero } from "./hero";
import { setupHire } from "./hire";
import { setupPrinciples } from "./principles";
import { setupReveals } from "./reveal";
import { setupRhythm } from "./rhythm";
import type { Conditions } from "./types";

gsap.registerPlugin(ScrollTrigger, DrawSVGPlugin);

/**
 * One gsap.matchMedia context for the whole page: when motion preference,
 * layout width or pointer type changes, everything reverts to the
 * server-rendered composition and is set up again for the new conditions.
 */
export function initHomeC() {
  const root = document.querySelector<HTMLElement>("[data-hc-root]");
  if (!root) return;
  const mm = gsap.matchMedia();
  mm.add(
    {
      motion: "(prefers-reduced-motion: no-preference)",
      wide: "(min-width: 1024px)",
      fine: "(hover: hover) and (pointer: fine)",
    },
    (context) => {
      const conditions = context.conditions as unknown as Conditions;
      root.classList.toggle("hc-motion", conditions.motion);
      const cleanups = [
        setupHero(root, conditions),
        setupRhythm(root, conditions),
        setupReveals(root, conditions),
        setupBuilders(root, conditions),
        setupCommunity(root, conditions),
        setupHire(root, conditions),
        setupPrinciples(root, conditions),
      ];
      // Web fonts change line lengths; measure triggers again once they land.
      void document.fonts.ready.then(() => ScrollTrigger.refresh());
      return () => {
        cleanups.forEach((cleanup) => cleanup());
        root.classList.remove("hc-motion");
      };
    },
  );
}
