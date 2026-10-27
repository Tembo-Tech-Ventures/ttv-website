import { gsap } from "gsap";
import type { Conditions } from "./types";

/**
 * Hire: the network's threads converge into one line that lands on the call
 * to action. Magnetic buttons lean towards a fine pointer.
 */
export function setupHire(root: HTMLElement, c: Conditions): () => void {
  const cleanups: Array<() => void> = [];
  const section = root.querySelector<HTMLElement>("[data-hc-hire]");
  const lines = section?.querySelectorAll<SVGPathElement>(".hc-converge__line");
  const knot = section?.querySelector<HTMLElement>(".hc-hire__knot");

  if (c.motion && section && lines?.length) {
    gsap.set(lines, { drawSVG: "0%" });
    if (knot) gsap.set(knot, { scale: 0 });
    gsap.timeline({
      scrollTrigger: { trigger: section.querySelector("[data-hc-converge]"), start: "top 85%", end: "bottom 55%", scrub: 0.6 },
    })
      .to(lines, { drawSVG: "100%", duration: 1, ease: "none", stagger: { each: 0.03, from: "edges" } })
      .to(knot ?? {}, { scale: 1, duration: 0.25, ease: "back.out(3)" }, ">-0.1");
  }

  if (c.motion && c.fine) {
    root.querySelectorAll<HTMLElement>("[data-hc-magnetic]").forEach((button) => {
      const label = button.querySelector<HTMLElement>(".hc-pill__label");
      const moveX = gsap.quickTo(button, "x", { duration: 0.5, ease: "power3.out" });
      const moveY = gsap.quickTo(button, "y", { duration: 0.5, ease: "power3.out" });
      const labelX = label ? gsap.quickTo(label, "x", { duration: 0.5, ease: "power3.out" }) : null;
      const onMove = (event: PointerEvent) => {
        const box = button.getBoundingClientRect();
        const dx = event.clientX - (box.left + box.width / 2);
        const dy = event.clientY - (box.top + box.height / 2);
        moveX(dx * 0.28);
        moveY(dy * 0.4);
        labelX?.(dx * 0.08);
      };
      const onLeave = () => {
        gsap.to(button, { x: 0, y: 0, duration: 0.9, ease: "elastic.out(1, 0.4)", overwrite: true });
        if (label) gsap.to(label, { x: 0, duration: 0.9, ease: "elastic.out(1, 0.4)", overwrite: true });
      };
      button.addEventListener("pointermove", onMove);
      button.addEventListener("pointerleave", onLeave);
      cleanups.push(() => {
        button.removeEventListener("pointermove", onMove);
        button.removeEventListener("pointerleave", onLeave);
        gsap.set([button, label], { clearProps: "transform" });
      });
    });
  }

  return () => cleanups.forEach((fn) => fn());
}
