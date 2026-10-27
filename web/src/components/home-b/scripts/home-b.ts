import { gsap } from "gsap";
import { initCommunityTabs } from "./community";
import { deckScene, deckTilt, rhythmScene } from "./hero";
import { hireScene } from "./hire";
import { fitPrinciples } from "./principles";
import { navHeight, runScenes, type Scene } from "./scenes";
import { cardStackScene, sheetScene } from "./stack";

const MOTION = "(prefers-reduced-motion: no-preference)";
const FINE_POINTER = "(hover: hover) and (pointer: fine)";

/** Keeps the builders' deck-edge rail in step with the card on top. */
function railUpdater(root: HTMLElement) {
  const edges = [...root.querySelectorAll<HTMLElement>("[data-hb-rail-edge]")];
  const current = root.querySelector<HTMLElement>("[data-hb-rail-current]");
  return (index: number) => {
    edges.forEach((edge, i) => {
      edge.classList.toggle("is-current", i === index);
      edge.classList.toggle("is-done", i < index);
    });
    // Rewrite the existing text node rather than replacing it.
    if (current?.firstChild) current.firstChild.nodeValue = String(index + 1).padStart(2, "0");
  };
}

function start(root: HTMLElement) {
  root.style.setProperty("--hb-nav", `${navHeight()}px`);
  fitPrinciples(root);
  initCommunityTabs(root, () => window.matchMedia(MOTION).matches);

  const mm = gsap.matchMedia();
  mm.add({ motion: MOTION, fine: FINE_POINTER }, (context) => {
    const { motion, fine } = context.conditions ?? {};
    if (!motion) return;
    const builders = root.querySelector<HTMLElement>("[data-hb-stack]");
    const values = root.querySelector<HTMLElement>("[data-hb-values]");
    const scenes = [
      sheetScene(root),
      builders ? cardStackScene(builders, { recede: ".hb-bc", onActive: railUpdater(root) }) : null,
      values ? cardStackScene(values, { recede: ".hb-value__inner", scale: 0.04 }) : null,
      deckScene(root),
      rhythmScene(root),
      hireScene(root),
    ].filter((scene): scene is Scene => scene !== null);
    const stopScenes = runScenes(scenes, root);
    const stopTilt = fine ? deckTilt(root) : null;
    return () => {
      stopScenes();
      stopTilt?.();
    };
  });
}

export function initHomeB() {
  const root = document.querySelector<HTMLElement>("[data-hb-root]");
  if (root) start(root);
}
