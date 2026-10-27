import { gsap } from "gsap";
import { clamp01, type Scene } from "./scenes";

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** The cohort deck fans wider as the hero scrolls away. */
export function deckScene(root: HTMLElement): Scene | null {
  const deck = root.querySelector<HTMLElement>("[data-hb-deck]");
  if (!deck) return null;
  const cards = [...deck.querySelectorAll<HTMLElement>("[data-hb-deck-card]")];
  const last = cards.length - 1;
  const setters = cards.map((card) => ({
    x: gsap.quickTo(card, "x", { duration: 0.6, ease: "power3.out" }),
    y: gsap.quickTo(card, "y", { duration: 0.6, ease: "power3.out" }),
    rotation: gsap.quickTo(card, "rotation", { duration: 0.6, ease: "power3.out" }),
  }));
  let p = 0;
  let spread = 14;
  let turn = 2.6;
  return {
    measure() {
      // Narrow decks fan upwards more than outwards, so no card leaves the screen.
      const narrow = deck.offsetWidth < 400;
      spread = narrow ? 3 : 14;
      turn = narrow ? 1.2 : 2.6;
    },
    read() {
      p = clamp01(window.scrollY / (window.innerHeight * 0.75));
    },
    write() {
      const fan = easeOut(p);
      setters.forEach((set, k) => {
        const fromTop = last - k;
        set.x((k - last / 2) * spread * fan);
        set.y(-fromTop * 16 * fan);
        set.rotation((k - last * 0.75) * turn * fan);
      });
    },
    destroy() {
      gsap.killTweensOf(cards);
      gsap.set(cards, { clearProps: "transform" });
    },
  };
}

/** Pointer tilt for the deck; its cards sit at different depths, so tilt reads as parallax. */
export function deckTilt(root: HTMLElement): (() => void) | null {
  const stage = root.querySelector<HTMLElement>("[data-hb-deck-stage]");
  const deck = root.querySelector<HTMLElement>("[data-hb-deck]");
  const area = stage?.closest<HTMLElement>(".hb-sheet");
  if (!stage || !deck || !area) return null;
  const rotateX = gsap.quickTo(deck, "rotationX", { duration: 0.8, ease: "power3.out" });
  const rotateY = gsap.quickTo(deck, "rotationY", { duration: 0.8, ease: "power3.out" });
  const onMove = (event: PointerEvent) => {
    const box = stage.getBoundingClientRect();
    const x = (event.clientX - (box.left + box.width / 2)) / window.innerWidth;
    const y = (event.clientY - (box.top + box.height / 2)) / window.innerHeight;
    rotateY(Math.max(-1, Math.min(1, x * 1.6)) * 12);
    rotateX(Math.max(-1, Math.min(1, y * 1.6)) * -9);
  };
  const onLeave = () => {
    rotateX(0);
    rotateY(0);
  };
  area.addEventListener("pointermove", onMove);
  area.addEventListener("pointerleave", onLeave);
  return () => {
    area.removeEventListener("pointermove", onMove);
    area.removeEventListener("pointerleave", onLeave);
    gsap.killTweensOf(deck);
    gsap.set(deck, { clearProps: "transform" });
  };
}

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
