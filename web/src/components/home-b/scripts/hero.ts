import { gsap } from "gsap";
import { clamp01, type Scene } from "./scenes";

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * The rhythm cards arrive stacked on the first one and deal out into their
 * row (or column on phones) as they scroll into view.
 */
export function rhythmScene(root: HTMLElement): Scene | null {
  const list = root.querySelector<HTMLElement>("[data-hb-rhythm]");
  if (!list) return null;
  const cards = [...list.querySelectorAll<HTMLElement>("[data-hb-rhythm-card]")];
  const offsets = cards.map(() => ({ x: 0, y: 0 }));
  const setters = cards.map((card) => ({
    x: gsap.quickTo(card, "x", { duration: 0.55, ease: "power3.out" }),
    y: gsap.quickTo(card, "y", { duration: 0.55, ease: "power3.out" }),
    rotation: gsap.quickTo(card, "rotation", { duration: 0.55, ease: "power3.out" }),
  }));
  let p = 1;
  return {
    measure() {
      const first = cards[0];
      cards.forEach((card, index) => {
        offsets[index] = { x: card.offsetLeft - first.offsetLeft, y: card.offsetTop - first.offsetTop };
      });
    },
    read() {
      const top = list.getBoundingClientRect().top;
      const vh = window.innerHeight;
      p = clamp01((vh * 0.95 - top) / (vh * 0.4));
    },
    write() {
      const gather = 1 - easeOut(p);
      setters.forEach((set, index) => {
        set.x((-offsets[index].x + index * 22) * gather);
        set.y((-offsets[index].y + index * 16) * gather);
        set.rotation((index - 1) * 3.5 * gather);
      });
    },
    destroy() {
      gsap.killTweensOf(cards);
      gsap.set(cards, { clearProps: "transform" });
    },
  };
}
