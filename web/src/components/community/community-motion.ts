import { initNavigation } from "../homepage/scripts/navigate";
import { navHeight } from "../homepage/scripts/scenes";

/** Keep reading surfaces in document order; only illustrations settle into place. */
export function initCommunityMotion(root: HTMLElement): () => void {
  const media = window.matchMedia("(prefers-reduced-motion: no-preference)");
  const cards = [...root.querySelectorAll<HTMLElement>(".community-deck-card, .audience-evidence-path > li")];
  let observer: IntersectionObserver | undefined;
  let disposed = false;
  const syncMotion = () => {
    observer?.disconnect();
    cards.forEach(card => card.classList.remove("is-arriving"));
    if (!media.matches) return;
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-arriving");
        observer?.unobserve(entry.target);
      }
    }, { threshold: 0.25, rootMargin: "0px 0px -8% 0px" });
    cards.forEach(card => observer?.observe(card));
  };
  // Observe the bar, not an expanded mobile menu: opening navigation must not
  // change the page's anchor offset or rearrange its content.
  const bar = document.querySelector<HTMLElement>("body header nav") ?? document.querySelector<HTMLElement>("body header");
  const syncNav = () => root.style.setProperty("--hp-nav", `${bar?.offsetHeight ?? navHeight()}px`);
  const resize = new ResizeObserver(syncNav);
  if (bar) resize.observe(bar);
  syncNav();
  const stopNavigation = initNavigation(root, () => 0, () => media.matches);
  media.addEventListener("change", syncMotion);
  // Font metrics determine which cards have actually entered the viewport.
  void document.fonts.ready.then(() => {
    if (!disposed) syncMotion();
    return undefined;
  });
  return () => {
    disposed = true;
    observer?.disconnect();
    resize.disconnect();
    stopNavigation();
    media.removeEventListener("change", syncMotion);
    cards.forEach(card => card.classList.remove("is-arriving"));
  };
}
