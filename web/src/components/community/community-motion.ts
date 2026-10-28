import { initNavigation } from "../homepage/scripts/navigate";
import { navHeight } from "../homepage/scripts/scenes";

/** Keep reading surfaces in document order; upright sheets slide over each other, with disclosures in flow. */
export function initCommunityMotion(root: HTMLElement): () => void {
  const media = window.matchMedia("(prefers-reduced-motion: no-preference)");
  const sheets = [...root.querySelectorAll<HTMLElement>("[data-hp-sheet]")];
  const lead = () => Math.round(window.innerHeight * 0.32);
  const cards = [...root.querySelectorAll<HTMLElement>(".community-deck-card, .audience-evidence-path > li")];
  let observer: IntersectionObserver | undefined;
  let disposed = false;
  const syncMotion = () => {
    observer?.disconnect();
    root.classList.toggle("hp-stacked", media.matches);
    syncLayout();
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
  const syncLayout = () => {
    const nav = bar?.offsetHeight ?? navHeight();
    root.style.setProperty("--hp-nav", `${nav}px`);
    for (const sheet of sheets) {
      // Keep the bottom of a long section readable before the next slides up.
      // No receding transform: the front surface and its contents stay aligned.
      sheet.style.setProperty("--hp-stick", `${Math.min(nav, window.innerHeight - lead() - sheet.offsetHeight)}px`);
    }
  };
  const resize = new ResizeObserver(syncLayout);
  if (bar) resize.observe(bar);
  sheets.forEach(sheet => resize.observe(sheet));
  window.addEventListener("resize", syncLayout);
  syncLayout();
  const stopNavigation = initNavigation(root, lead, () => media.matches);
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
    window.removeEventListener("resize", syncLayout);
    root.classList.remove("hp-stacked");
    sheets.forEach(sheet => sheet.style.removeProperty("--hp-stick"));
    stopNavigation();
    media.removeEventListener("change", syncMotion);
    cards.forEach(card => card.classList.remove("is-arriving"));
  };
}
