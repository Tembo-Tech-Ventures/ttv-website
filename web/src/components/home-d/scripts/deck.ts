import { gsap } from "gsap";
import { clamp01, type Scene } from "./scenes";

const easeOut = (t: number) => 1 - (1 - t) ** 3;

interface Deck {
  stage: HTMLElement;
  deck: HTMLElement;
  cards: HTMLElement[];
  buttons: HTMLElement[];
  /** Back-to-front slot of each card, by DOM index. */
  slots: number[];
}

const decks = new WeakMap<HTMLElement, Deck>();

/** One shared record per page, so selection and motion agree on the slots. */
function findDeck(root: HTMLElement): Deck | null {
  const cached = decks.get(root);
  if (cached) return cached;
  const stage = root.querySelector<HTMLElement>("[data-hd-deck-stage]");
  const deck = stage?.querySelector<HTMLElement>("[data-hd-deck]");
  if (!stage || !deck) return null;
  const cards = [...deck.querySelectorAll<HTMLElement>("[data-hd-deck-card]")];
  const buttons = cards.map((card) => card.querySelector<HTMLElement>("[data-hd-deck-button]")!);
  const slots = cards.map((card) => Number(card.style.getPropertyValue("--slot")) || 0);
  const found = { stage, deck, cards, buttons, slots };
  decks.set(root, found);
  return found;
}

/**
 * Turns the deck cards into toggle buttons (only now that JS can honour them)
 * and brings the pressed (or focused) card to the top, the others closing up
 * behind it.
 * The card on top shows its cohort's published builders, and the hero's
 * "Meet the builders" link then leads to that cohort's first card. Works with
 * or without motion; with motion the CSS pose transition carries the card.
 */
export function initDeckSelect(root: HTMLElement): (() => void) | null {
  const found = findDeck(root);
  if (!found) return null;
  const { deck, cards, buttons, slots } = found;
  const top = cards.length - 1;

  const sync = () => {
    cards.forEach((card, index) => {
      const onTop = slots[index] === top;
      card.style.setProperty("--slot", String(slots[index]));
      card.classList.toggle("is-top", onTop);
      buttons[index].setAttribute("aria-pressed", String(onTop));
    });
    const chosen = cards[slots.indexOf(top)];
    if (chosen && !chosen.classList.contains("hd-cc--running")) root.dataset.hdCohort = chosen.dataset.cohort;
    else delete root.dataset.hdCohort;
  };

  const choose = (chosen: number) => {
    if (chosen < 0 || slots[chosen] === top) return;
    const from = slots[chosen];
    slots.forEach((slot, index) => {
      if (index === chosen) slots[index] = top;
      else if (slot > from) slots[index] = slot - 1;
    });
    sync();
    root.dispatchEvent(new CustomEvent("hd:deck"));
  };

  const onClick = (event: Event) => choose(buttons.indexOf(event.currentTarget as HTMLElement));
  // Focus selects, like the community tabs: a focused card comes to the top
  // whole (its people and number showing), never as a blank slab in front.
  const onFocus = (event: FocusEvent) => choose(buttons.indexOf(event.currentTarget as HTMLElement));
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    choose(buttons.indexOf(event.currentTarget as HTMLElement));
  };

  deck.classList.add("hd-deck--live");
  buttons.forEach((button) => {
    button.setAttribute("role", "button");
    button.tabIndex = 0;
    button.addEventListener("click", onClick);
    button.addEventListener("focus", onFocus);
    button.addEventListener("keydown", onKey);
  });
  sync();

  return () => {
    deck.classList.remove("hd-deck--live");
    buttons.forEach((button) => {
      button.removeAttribute("role");
      button.removeAttribute("tabindex");
      button.removeAttribute("aria-pressed");
      button.removeEventListener("click", onClick);
      button.removeEventListener("focus", onFocus);
      button.removeEventListener("keydown", onKey);
    });
  };
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
    // Below 1024px the deck stays as dealt: fanning or parting would push the
    // outer cards past the gutter.
    const spread = narrow ? 0 : 14 * fan + 26 * state.part;
    const turn = narrow ? 0 : 2.6 * fan + 3.2 * state.part;
    // On phones the deck sits under the eligibility line: never lift it over that.
    const lift = narrow ? 0 : 16 * fan + 22 * state.part;
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
  root.addEventListener("hd:deck", onReorder);

  const scene: Scene = {
    measure() {
      narrow = deck.offsetWidth < 400 || window.innerWidth < 1024;
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
      root.removeEventListener("hd:deck", onReorder);
      gsap.killTweensOf([state, deck, ...cards]);
      gsap.set([deck, ...cards], { clearProps: "transform" });
    },
  };
}
