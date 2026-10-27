import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Conditions } from "./types";

/** Anything a reveal may hold back. Never hidden with `visibility`, so it stays focusable. */
export const REVEALED = "[data-hc-reveal], [data-hc-card], [data-hc-commitment]";

/**
 * Section headings rise word by word (a CSS animation toggled from
 * `.hc-await` to `.hc-rise`); supporting blocks slide up and fade in. Only
 * opacity and transform are ever animated, so every link and button stays in
 * the tab order, and a focused element finishes its own reveal at once.
 */
export function setupReveals(root: HTMLElement, c: Conditions): () => void {
  if (!c.motion) return () => {};

  const headings = [...root.querySelectorAll<HTMLElement>("[data-hc-words]")];
  headings.forEach((heading) => {
    heading.classList.add("hc-await");
    ScrollTrigger.create({
      trigger: heading,
      start: "top bottom",
      once: true,
      onEnter: () => heading.classList.replace("hc-await", "hc-rise"),
    });
  });

  const blocks = gsap.utils.toArray<HTMLElement>("[data-hc-reveal]", root);
  gsap.set(blocks, { opacity: 0, y: 28 });
  ScrollTrigger.batch(blocks, {
    start: "top 90%",
    once: true,
    onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 0.75, ease: "power3.out", stagger: 0.09, overwrite: true, clearProps: "opacity,transform" }),
  });

  // Tabbing ahead of the scroll: show whatever holds the focused element now.
  const onFocus = (event: FocusEvent) => {
    let el = (event.target as HTMLElement | null)?.closest<HTMLElement>(REVEALED);
    while (el && root.contains(el)) {
      gsap.killTweensOf(el);
      gsap.set(el, { clearProps: "opacity,transform" });
      el = el.parentElement?.closest<HTMLElement>(REVEALED) ?? null;
    }
  };
  root.addEventListener("focusin", onFocus);

  return () => {
    root.removeEventListener("focusin", onFocus);
    headings.forEach((heading) => heading.classList.remove("hc-await", "hc-rise"));
  };
}
