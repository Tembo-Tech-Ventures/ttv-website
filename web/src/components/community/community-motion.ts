import { initNavigation } from "../homepage/scripts/navigate";
import { navHeight } from "../homepage/scripts/scenes";

/** Keep reading surfaces in document order; upright sheets slide over each other, with disclosures in flow. */
export function initCommunityMotion(root: HTMLElement): () => void {
  const media = window.matchMedia("(prefers-reduced-motion: no-preference)");
  const sheets = [...root.querySelectorAll<HTMLElement>("[data-hp-sheet]")];
  const lead = () => Math.round(window.innerHeight * 0.32);
  const cards = [...root.querySelectorAll<HTMLElement>(".community-deck-card")];
  const stacks = [...root.querySelectorAll<HTMLElement>("[data-card-stack]")];
  const arrived = new WeakSet<Element>();
  let observer: IntersectionObserver | undefined;
  let disposed = false;
  let scrollFrame = 0;
  const settle = (stack: Element) => {
    stack.getAnimations({ subtree: true }).forEach(animation => animation.finish());
    stack.classList.remove("is-arriving");
    stack.classList.add("is-settled");
    observer?.unobserve(stack);
  };
  const onScroll = () => {
    if (scrollFrame || !stacks.some(stack => stack.classList.contains("is-arriving"))) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      for (const stack of stacks) {
        if (!stack.classList.contains("is-arriving")) continue;
        // Sticky sheets can cover an illustration without moving its IO box.
        const box = stack.getBoundingClientRect();
        const y = Math.min(window.innerHeight - 1, Math.max(1, box.top + box.height / 2));
        const hit = document.elementFromPoint(box.left + box.width / 2, y);
        if (hit && !stack.contains(hit) && hit.closest("[data-hp-sheet]") !== stack.closest("[data-hp-sheet]")) settle(stack);
      }
    });
  };
  const onArrivalEnd = (event: AnimationEvent) => {
    const stack = (event.target as Element).closest("[data-card-stack]");
    if (!stack?.classList.contains("is-arriving")) return;
    if (stack.getAnimations({ subtree: true }).every(animation => animation.playState === "finished")) settle(stack);
  };
  // Hide only enhanced stacks while font metrics settle; server HTML stays visible.
  stacks.forEach(stack => stack.classList.toggle("is-pending", media.matches));
  const syncMotion = () => {
    observer?.disconnect();
    root.classList.toggle("hp-stacked", media.matches);
    syncLayout();
    cards.forEach(card => card.classList.remove("is-arriving"));
    stacks.forEach(stack => {
      // Once the bounded fallback revealed the file, late fonts must not hide it again.
      if (document.documentElement.hasAttribute("data-community-motion-fallback")) arrived.add(stack);
      stack.classList.remove("is-arriving");
      stack.classList.toggle("is-settled", arrived.has(stack));
      stack.classList.toggle("is-pending", media.matches && !arrived.has(stack));
    });
    document.documentElement.removeAttribute("data-community-motion");
    document.documentElement.removeAttribute("data-community-motion-fallback");
    if (!media.matches) return;
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          // A fast scroll must not strand a half-dealt file or replay it later.
          if (arrived.has(entry.target)) {
            settle(entry.target);
          }
          continue;
        }
        entry.target.classList.remove("is-pending");
        entry.target.classList.add("is-arriving");
        if (entry.target.matches("[data-card-stack]")) arrived.add(entry.target);
        else observer?.unobserve(entry.target);
      }
    }, { threshold: 0.25, rootMargin: "0px 0px -8% 0px" });
    [...cards, ...stacks.filter(stack => !arrived.has(stack))].forEach(card => observer?.observe(card));
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
  window.addEventListener("scroll", onScroll, { passive: true });
  root.addEventListener("animationend", onArrivalEnd);
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
    window.removeEventListener("scroll", onScroll);
    root.removeEventListener("animationend", onArrivalEnd);
    cancelAnimationFrame(scrollFrame);
    root.classList.remove("hp-stacked");
    document.documentElement.removeAttribute("data-community-motion");
    sheets.forEach(sheet => sheet.style.removeProperty("--hp-stick"));
    stopNavigation();
    media.removeEventListener("change", syncMotion);
    cards.forEach(card => card.classList.remove("is-arriving"));
    stacks.forEach(stack => stack.classList.remove("is-pending", "is-arriving", "is-settled"));
  };
}
