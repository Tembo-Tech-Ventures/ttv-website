import { gsap } from "gsap";
import { clamp01, type Scene } from "./scenes";

/** The two hire cards arrive tightly overlapped and settle apart into their resting fan. */
export function hireScene(root: HTMLElement): Scene | null {
  const pair = root.querySelector<HTMLElement>("[data-hp-hire]");
  if (!pair) return null;
  const [primary, secondary] = pair.querySelectorAll<HTMLElement>("[data-hp-hire-card]");
  if (!primary || !secondary) return null;

  const set = {
    primaryY: gsap.quickTo(primary, "y", { duration: 0.6, ease: "power3.out" }),
    primaryRotation: gsap.quickTo(primary, "rotation", { duration: 0.6, ease: "power3.out" }),
    secondaryY: gsap.quickTo(secondary, "y", { duration: 0.6, ease: "power3.out" }),
    secondaryX: gsap.quickTo(secondary, "x", { duration: 0.6, ease: "power3.out" }),
    secondaryRotation: gsap.quickTo(secondary, "rotation", { duration: 0.6, ease: "power3.out" }),
  };
  let p = 1;
  return {
    read() {
      const top = pair.getBoundingClientRect().top;
      const vh = window.innerHeight;
      p = clamp01((vh * 0.98 - top) / (vh * 0.45));
    },
    write() {
      const gather = (1 - p) ** 2;
      set.primaryY(60 * gather);
      set.primaryRotation(3 * gather);
      set.secondaryY(-90 * gather);
      set.secondaryX(-24 * gather);
      set.secondaryRotation(-5 * gather);
    },
    destroy() {
      gsap.killTweensOf([primary, secondary]);
      gsap.set([primary, secondary], { clearProps: "transform" });
    },
  };
}
