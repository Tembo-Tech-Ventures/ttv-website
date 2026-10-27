import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Conditions } from "./types";

/**
 * Principles, the finale.
 *  - The word nearest the middle of the screen takes the solid fill, one at a
 *    time (a state change, so reduced motion keeps it too).
 *  - With motion, each finished outline is uncovered left to right behind a
 *    peach caret where the eye is, and its commitment rises under it. There is
 *    never a frame with a fragment of a letter.
 */
export function setupPrinciples(root: HTMLElement, c: Conditions): () => void {
  const rows = gsap.utils.toArray<HTMLElement>("[data-hc-principle]", root);
  const triggers: ScrollTrigger[] = [];

  rows.forEach((row) => {
    triggers.push(
      ScrollTrigger.create({
        trigger: row,
        start: "top 58%",
        end: "bottom 42%",
        toggleClass: "is-current",
      }),
    );
  });

  if (c.motion) {
    rows.forEach((row) => {
      const ink = row.querySelector<HTMLElement>(".hc-principle__ink");
      const commitment = row.querySelector<HTMLElement>("[data-hc-commitment]");
      if (!ink) return;
      row.classList.add("hc-wiping");
      gsap.set(ink, { "--hc-wipe": "100%", "--hc-caret": 0 });
      if (commitment) gsap.set(commitment, { opacity: 0, y: 16 });
      triggers.push(
        ScrollTrigger.create({
          trigger: row,
          start: "top 90%",
          once: true,
          onEnter: () => {
            // The clip goes the moment the outline is whole; the caret fades after.
            gsap.timeline({ onComplete: () => row.classList.remove("hc-caret-on") })
              .add(() => row.classList.add("hc-caret-on"))
              .set(ink, { "--hc-caret": 1 })
              .to(ink, { "--hc-wipe": "0%", duration: 0.55, ease: "power3.inOut" })
              .add(() => row.classList.remove("hc-wiping"))
              .to(ink, { "--hc-caret": 0, duration: 0.25 });
            if (commitment) gsap.to(commitment, { opacity: 1, y: 0, duration: 0.6, delay: 0.25, ease: "power3.out", clearProps: "opacity,transform" });
          },
        }),
      );
    });
  }

  return () => {
    triggers.forEach((trigger) => trigger.kill());
    rows.forEach((row) => row.classList.remove("hc-wiping", "hc-caret-on", "is-current"));
    gsap.set(
      rows.map((row) => row.querySelector(".hc-principle__ink")).filter(Boolean),
      { clearProps: "--hc-wipe,--hc-caret" },
    );
  };
}
