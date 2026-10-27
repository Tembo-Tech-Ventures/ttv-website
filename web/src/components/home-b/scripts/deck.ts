import { gsap } from "gsap";
import { clamp01, type Scene } from "./scenes";

const easeOut = (t: number) => 1 - (1 - t) ** 3;

interface Deck {
  stage: HTMLElement;
  deck: HTMLElement;
  cards: HTMLElement[];
  buttons: HTMLButtonElement[];
  /** Back-to-front slot of each card, by DOM index. */
  slots: number[];
}

const decks = new WeakMap<HTMLElement, Deck>();

/** One shared record per page, so selection and motion agree on the slots. */
function findDeck(root: HTMLElement): Deck | null {
  const cached = decks.get(root);
  if (cached) return cached;
  const stage = root.querySelector<HTMLElement>("[data-hb-deck-stage]");
  const deck = stage?.querySelector<HTMLElement>("[data-hb-deck]");
  if (!stage || !deck) return null;
  const cards = [...deck.querySelectorAll<HTMLElement>("[data-hb-deck-card]")];
  const buttons = cards.map((card) => card.querySelector<HTMLButtonElement>("[data-hb-deck-button]")!);
  const slots = cards.map((card) => Number(card.style.getPropertyValue("--slot")) || 0);
  const found = { stage, deck, cards, buttons, slots };
  decks.set(root, found);
  return found;
}

/**
 * Pressing a card brings it to the top of the deck (the others close up
 * behind it). Works with or without motion; with motion the CSS pose
 * transition carries the card across.
 */
export function initDeckSelect(root: HTMLElement): (() => void) | null {
  const found = findDeck(root);
  if (!found) return null;
  const { cards, buttons, slots } = found;
  const top = cards.length - 1;
  const onClick = (event: Event) => {
    const chosen = buttons.indexOf(event.currentTarget as HTMLButtonElement);
    if (chosen < 0 || slots[chosen] === top) return;
    const from = slots[chosen];
    slots.forEach((slot, index) => {
      if (index === chosen) slots[index] = top;
      else if (slot > from) slots[index] = slot - 1;
    });
    cards.forEach((card, index) => {
      card.style.setProperty("--slot", String(slots[index]));
      buttons[index].setAttribute("aria-pressed", String(index === chosen));
    });
    root.dispatchEvent(new CustomEvent("hb:deck"));
  };
  buttons.forEach((button) => button.addEventListener("click", onClick));
  return () => buttons.forEach((button) => button.removeEventListener("click", onClick));
}

/**
 * Motion for the deck: it fans wider as the hero scrolls away, and parts when
 * pointed at or focused, tilting towards the pointer. Cards sit at different
 * depths, so the tilt reads as parallax.
 */
export function deckMotion(root: HTMLElement, finePointer: boolean): { scene: Scene; stop: () => void } | null {
  const found = findDeck(root);
  if (!found) return null;
  const { stage, deck, cards, slots } = found;
  const last = cards.length - 1;
  const setters = cards.map((card) => ({
    x: gsap.quickTo(card, "x", { duration: 0.6, ease: "power3.out" }),
    y: gsap.quickTo(card, "y", { duration: 0.6, ease: "power3.out" }),
    rotation: gsap.quickTo(card, "rotation", { duration: 0.6, ease: "power3.out" }),
  }));
  const state = { part: 0 };
  let fan = 0;
  let narrow = false;

  const render = () => {
    const spread = (narrow ? 3 : 14) * fan + (narrow ? 6 : 26) * state.part;
    const turn = (narrow ? 1.2 : 2.6) * fan + (narrow ? 1.6 : 3.2) * state.part;
    const lift = 16 * fan + (narrow ? 10 : 22) * state.part;
    cards.forEach((_, index) => {
      const slot = slots[index] ?? index;
      setters[index].x((slot - last / 2) * spread);
      setters[index].y(-(last - slot) * lift);
      setters[index].rotation((slot - last * 0.75) * turn);
    });
  };

  const partTo = (value: number) => {
    gsap.to(state, { part: value, duration: 0.7, ease: value ? "back.out(1.6)" : "power3.out", onUpdate: render, overwrite: true });
  };

  const rotateX = gsap.quickTo(deck, "rotationX", { duration: 0.7, ease: "power3.out" });
  const rotateY = gsap.quickTo(deck, "rotationY", { duration: 0.7, ease: "power3.out" });
  const clamp = (value: number) => Math.max(-1, Math.min(1, value));
  const onMove = (event: PointerEvent) => {
    const box = stage.getBoundingClientRect();
    const x = (event.clientX - (box.left + box.width / 2)) / (box.width / 2);
    const y = (event.clientY - (box.top + box.height / 2)) / (box.height / 2);
    rotateY(clamp(x) * 16);
    rotateX(clamp(y) * -10);
  };
  const onEnter = () => partTo(1);
  const onLeave = () => {
    partTo(0);
    rotateX(0);
    rotateY(0);
  };
  const onFocusIn = () => partTo(1);
  const onFocusOut = (event: FocusEvent) => {
    if (!stage.contains(event.relatedTarget as Node | null)) partTo(0);
  };
  const onReorder = () => render();

  if (finePointer) {
    stage.addEventListener("pointerenter", onEnter);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerleave", onLeave);
  }
  stage.addEventListener("focusin", onFocusIn);
  stage.addEventListener("focusout", onFocusOut);
  root.addEventListener("hb:deck", onReorder);

  const scene: Scene = {
    measure() {
      narrow = deck.offsetWidth < 400;
    },
    read() {
      fan = easeOut(clamp01(window.scrollY / (window.innerHeight * 0.75)));
    },
    write: render,
    destroy() {},
  };

  return {
    scene,
    stop() {
      stage.removeEventListener("pointerenter", onEnter);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerleave", onLeave);
      stage.removeEventListener("focusin", onFocusIn);
      stage.removeEventListener("focusout", onFocusOut);
      root.removeEventListener("hb:deck", onReorder);
      gsap.killTweensOf([state, deck, ...cards]);
      gsap.set([deck, ...cards], { clearProps: "transform" });
    },
  };
}
