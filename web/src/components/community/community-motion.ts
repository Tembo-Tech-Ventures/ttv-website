import { initNavigation } from "../homepage/scripts/navigate";
import { navHeight, runScenes } from "../homepage/scripts/scenes";
import { LEAD, sheetScene } from "../homepage/scripts/stack";

/** Reuse the homepage stack, including keyboard/anchor recovery and reduced motion. */
export function initCommunityMotion(root: HTMLElement): () => void {
  const media = window.matchMedia("(prefers-reduced-motion: no-preference)");
  let stopScenes = () => {};
  const sync = () => {
    stopScenes();
    root.style.setProperty("--hp-nav", `${navHeight()}px`);
    stopScenes = media.matches ? runScenes([sheetScene(root)], root) : () => {};
  };
  const stopNavigation = initNavigation(root, () => Math.round(window.innerHeight * LEAD), () => media.matches);
  media.addEventListener("change", sync);
  sync();
  return () => { stopScenes(); stopNavigation(); media.removeEventListener("change", sync); };
}
