import { gsap } from "gsap";
import { initCommunityTabs } from "./community";
import { deckMotion, initDeckSelect } from "./deck";
import { rhythmScene } from "./hero";
import { hireScene } from "./hire";
import { fitPrinciples } from "./principles";
import { navHeight, runScenes, type Scene } from "./scenes";
import { initNavigation } from "./navigate";
import { LEAD, cardStackScene, sheetScene } from "./stack";

const MOTION = "(prefers-reduced-motion: no-preference)";
const FINE_POINTER = "(hover: hover) and (pointer: fine)";

function start(root: HTMLElement) {
  root.style.setProperty("--hb-nav", `${navHeight()}px`);
  fitPrinciples(root);
  initDeckSelect(root);
  initCommunityTabs(root, () => window.matchMedia(MOTION).matches);

  const mm = gsap.matchMedia();
  mm.add({ motion: MOTION, fine: FINE_POINTER }, (context) => {
    const { motion, fine } = context.conditions ?? {};
    if (!motion) return;
    const builders = root.querySelector<HTMLElement>("[data-hb-stack]");
    const values = root.querySelector<HTMLElement>("[data-hb-values]");
    const deck = deckMotion(root, Boolean(fine));
    const scenes = [
      sheetScene(root),
      builders
        ? cardStackScene(builders, { recede: ".hb-bc", scale: 0.025, dim: 0.3, file: { min: 56, narrowMin: 54, max: 66 } })
        : null,
      values ? cardStackScene(values, { recede: ".hb-value__inner", scale: 0.04 }) : null,
      deck?.scene ?? null,
      rhythmScene(root),
      hireScene(root),
    ].filter((scene): scene is Scene => scene !== null);
    const stopScenes = runScenes(scenes, root);
    const stopNavigation = initNavigation(root, () => Math.round(window.innerHeight * LEAD));
    return () => {
      stopNavigation();
      stopScenes();
      deck?.stop();
    };
  });
}

export function initHomeB() {
  const root = document.querySelector<HTMLElement>("[data-hb-root]");
  if (root) start(root);
}
