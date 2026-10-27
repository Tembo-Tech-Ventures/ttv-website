import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Conditions } from "./types";

/** Rise a heading's server-rendered words out of their masks. */
export function riseWords(heading: HTMLElement, options: { delay?: number } = {}) {
  const words = heading.querySelectorAll(".hc-w");
  heading.classList.add("hc-revealing");
  return gsap.fromTo(
    words,
    { yPercent: 118 },
    {
      yPercent: 0,
      duration: 0.7,
      ease: "expo.out",
      stagger: 0.035,
      delay: options.delay ?? 0,
      // Expo's tail is sub-pixel: stop clipping as soon as the words have landed.
      onUpdate() {
        if (this.progress() > 0.6) heading.classList.remove("hc-revealing");
      },
      onComplete: () => heading.classList.remove("hc-revealing"),
    },
  );
}

/**
 * Section headings rise word by word out of masks; supporting blocks slide up
 * and fade in. Text nodes are never replaced, so nothing a reader (or a test)
 * holds on to disappears.
 */
export function setupReveals(root: HTMLElement, c: Conditions): () => void {
  if (!c.motion) return () => {};

  root.querySelectorAll<HTMLElement>("[data-hc-words]").forEach((heading) => {
    if (heading.closest("[data-hc-hero]")) return;
    heading.classList.add("hc-revealing");
    gsap.set(heading.querySelectorAll(".hc-w"), { yPercent: 118 });
    ScrollTrigger.create({ trigger: heading, start: "top 94%", once: true, onEnter: () => riseWords(heading) });
  });

  const blocks = gsap.utils.toArray<HTMLElement>("[data-hc-reveal]", root);
  gsap.set(blocks, { autoAlpha: 0, y: 28 });
  ScrollTrigger.batch(blocks, {
    start: "top 90%",
    once: true,
    onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.75, ease: "power3.out", stagger: 0.09, overwrite: true, clearProps: "opacity,visibility,transform" }),
  });

  return () => root.querySelectorAll(".hc-revealing").forEach((el) => el.classList.remove("hc-revealing"));
}
