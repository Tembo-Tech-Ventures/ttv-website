import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Conditions } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";

interface Point {
  x: number;
  y: number;
}

interface Endpoint {
  at: Point;
  card: { top: number; left: number };
}

/** A polyline with its corners rounded off. */
function roundedPath(points: Point[], radius: number): string {
  const clean = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 0.5);
  let d = `M${clean[0].x.toFixed(1)} ${clean[0].y.toFixed(1)}`;
  for (let i = 1; i < clean.length - 1; i += 1) {
    const [prev, at, next] = [clean[i - 1], clean[i], clean[i + 1]];
    const inLen = Math.hypot(at.x - prev.x, at.y - prev.y);
    const outLen = Math.hypot(next.x - at.x, next.y - at.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const p1 = { x: at.x + ((prev.x - at.x) / inLen) * r, y: at.y + ((prev.y - at.y) / inLen) * r };
    const p2 = { x: at.x + ((next.x - at.x) / outLen) * r, y: at.y + ((next.y - at.y) / outLen) * r };
    d += ` L${p1.x.toFixed(1)} ${p1.y.toFixed(1)} Q${at.x.toFixed(1)} ${at.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  const last = clean.at(-1)!;
  return `${d} L${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
}

interface Card {
  el: HTMLElement;
  tags: Set<string>;
}

/**
 * Builders: each card's signature draws itself in. Hovering or focusing a
 * card threads it to every builder who shares a skill or language; pressing a
 * skill chip pins that skill across the grid (the touch and keyboard path).
 */
export function setupBuilders(root: HTMLElement, c: Conditions): () => void {
  const section = root.querySelector<HTMLElement>("[data-hc-builders]");
  const grid = section?.querySelector<HTMLElement>(".hc-builders__grid");
  const overlay = section?.querySelector<SVGSVGElement>("[data-hc-threads]");
  if (!section || !grid || !overlay) return () => {};
  const layer: SVGSVGElement = overlay;

  const cards: Card[] = [...grid.querySelectorAll<HTMLElement>("[data-hc-card]")].map((el) => ({
    el,
    tags: new Set((el.dataset.tags ?? "").split("|").filter(Boolean)),
  }));
  const listeners: Array<[EventTarget, string, EventListener]> = [];
  const on = (target: EventTarget, type: string, fn: EventListener) => {
    target.addEventListener(type, fn);
    listeners.push([target, type, fn]);
  };

  /* ---------------------------------------------------------- entrance */
  if (c.motion && cards.length > 0) {
    const els = cards.map((card) => card.el);
    gsap.set(els, { opacity: 0, y: 40 });
    els.forEach((el) => {
      gsap.set(el.querySelectorAll(".hc-sig__spoke, .hc-sig__arc"), { drawSVG: "0%" });
      gsap.set(el.querySelectorAll(".hc-sig__node"), { scale: 0, transformOrigin: "50% 50%" });
    });
    ScrollTrigger.batch(els, {
      start: "top 92%",
      once: true,
      onEnter: (batch) => {
        // One timeline per batch: cards rise, then each signature draws itself.
        const timeline = gsap.timeline();
        timeline.to(batch, { opacity: 1, y: 0, duration: 0.8, ease: "power3.out", stagger: 0.08, clearProps: "opacity,transform" }, 0);
        batch.forEach((el, i) => {
          const at = 0.25 + i * 0.08;
          timeline
            .to(el.querySelectorAll(".hc-sig__spoke"), { drawSVG: "100%", duration: 0.6, ease: "power2.out", stagger: 0.08 }, at)
            .to(el.querySelectorAll(".hc-sig__node"), { scale: 1, duration: 0.5, ease: "back.out(2.5)", stagger: 0.08 }, at + 0.35)
            .to(el.querySelectorAll(".hc-sig__arc"), { drawSVG: "100%", duration: 0.7, ease: "power2.inOut", stagger: 0.1 }, at + 0.5);
        });
      },
    });
  }

  /* ------------------------------------------------------------ threads */
  let pinned: string | null = null;
  let source: Card | null = null;

  const endpoint = (card: Card, node: Element, box: DOMRect): Endpoint => {
    const r = node.getBoundingClientRect();
    const frame = card.el.getBoundingClientRect();
    return {
      at: { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top },
      card: { top: frame.top - box.top, left: frame.left - box.left },
    };
  };

  const clearMarks = () => {
    section.classList.remove("has-focus");
    grid.querySelectorAll(".is-source, .is-linked").forEach((el) => el.classList.remove("is-source", "is-linked"));
    grid.querySelectorAll(".is-shared").forEach((el) => el.classList.remove("is-shared"));
    gsap.killTweensOf(overlay.children);
    overlay.replaceChildren();
  };

  /**
   * Threads run like a transit map: up out of the source card, along the
   * gutters between cards, and down into the target, so a line never crosses
   * anyone's words. `lane` nudges parallel threads apart.
   */
  const thread = (a: Endpoint, b: Endpoint, lane: number) => {
    const gap = Number.parseFloat(getComputedStyle(grid).rowGap) || 16;
    const offset = lane * 4;
    const aTop = a.card.top - gap / 2 - offset;
    const bTop = b.card.top - gap / 2 - offset;
    const points = [a.at, { x: a.at.x, y: aTop }];
    if (Math.abs(aTop - bTop) > 1) {
      const laneX = (b.card.left > a.card.left ? b.card.left : a.card.left) - gap / 2 + offset;
      points.push({ x: laneX, y: aTop }, { x: laneX, y: bTop });
    }
    points.push({ x: b.at.x, y: bTop }, b.at);
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", roundedPath(points, 10));
    path.setAttribute("class", "hc-thread");
    layer.appendChild(path);
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("class", "hc-thread-dot");
    dot.setAttribute("cx", String(b.at.x));
    dot.setAttribute("cy", String(b.at.y));
    dot.setAttribute("r", "3.5");
    layer.appendChild(dot);
    if (c.motion) {
      gsap.fromTo(path, { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.7, ease: "power2.inOut" });
      gsap.fromTo(dot, { scale: 0, transformOrigin: "50% 50%" }, { scale: 1, duration: 0.4, delay: 0.55, ease: "back.out(3)" });
    }
  };

  const markTag = (card: Card, tag: string) => {
    card.el.querySelectorAll(`[data-tag="${CSS.escape(tag)}"]`).forEach((el) => el.classList.add("is-shared"));
    card.el.querySelectorAll(`[data-sig-tag="${CSS.escape(tag)}"]`).forEach((el) => el.classList.add("is-shared"));
  };

  const sigNode = (card: Card, tag: string) => card.el.querySelector(`[data-sig-tag="${CSS.escape(tag)}"]`);

  const highlightCard = (card: Card) => {
    clearMarks();
    source = card;
    const box = grid.getBoundingClientRect();
    card.el.classList.add("is-source");
    section.classList.add("has-focus");
    let lane = 0;
    for (const other of cards) {
      if (other === card) continue;
      const shared = [...card.tags].filter((tag) => other.tags.has(tag));
      if (shared.length === 0) continue;
      other.el.classList.add("is-linked");
      for (const tag of shared) {
        markTag(card, tag);
        markTag(other, tag);
        const a = sigNode(card, tag);
        const b = sigNode(other, tag);
        if (a && b) thread(endpoint(card, a, box), endpoint(other, b, box), lane++);
      }
    }
    if (!grid.querySelector(".is-linked")) section.classList.remove("has-focus");
  };

  /* ------------------------------------------------- phone rail */
  const status = section.querySelector<HTMLElement>("[data-hc-status]");
  const dots = [...section.querySelectorAll<HTMLElement>("[data-hc-rail-dots] span")];
  const isRail = () => getComputedStyle(grid).overflowX !== "visible";
  const railItems = () => [...grid.children].filter((el): el is HTMLElement => el instanceof HTMLElement);
  let dotFrame = 0;
  const syncDots = () => {
    cancelAnimationFrame(dotFrame);
    dotFrame = requestAnimationFrame(() => {
      if (dots.length === 0 || !isRail()) return;
      const left = grid.scrollLeft + Number.parseFloat(getComputedStyle(grid).paddingLeft);
      const items = railItems();
      let current = 0;
      items.forEach((item, i) => {
        if (Math.abs(item.offsetLeft - left) < Math.abs(items[current].offsetLeft - left)) current = i;
      });
      dots.forEach((dot, i) => dot.classList.toggle("is-on", i === current));
    });
  };
  on(grid, "scroll", syncDots);
  syncDots();

  /** On the rail, bring the next builder who holds the tag into view. */
  const scrollToHolder = (from: HTMLElement, tag: string) => {
    if (!isRail()) return;
    const holders = cards.filter((card) => card.tags.has(tag));
    const at = holders.findIndex((card) => card.el === from);
    const next = holders[(at + 1) % holders.length];
    if (!next || next.el === from) return;
    grid.scrollTo({ left: next.el.offsetLeft - Number.parseFloat(getComputedStyle(grid).paddingLeft), behavior: c.motion ? "smooth" : "auto" });
  };

  const highlightTag = (tag: string) => {
    clearMarks();
    const box = grid.getBoundingClientRect();
    const holders = cards.filter((card) => card.tags.has(tag));
    section.classList.add("has-focus");
    holders.forEach((card, i) => {
      card.el.classList.add("is-linked");
      markTag(card, tag);
      const next = holders[i + 1];
      const a = sigNode(card, tag);
      const b = next && sigNode(next, tag);
      if (a && b && next) thread(endpoint(card, a, box), endpoint(next, b, box), 0);
    });
  };

  const syncChips = () => {
    grid.querySelectorAll<HTMLButtonElement>(".hc-chip").forEach((chip) => {
      chip.setAttribute("aria-pressed", String(chip.dataset.tag === pinned));
    });
  };

  const release = () => {
    source = null;
    if (pinned) highlightTag(pinned);
    else clearMarks();
  };

  for (const card of cards) {
    if (c.fine) {
      on(card.el, "pointerenter", () => {
        if (!pinned) highlightCard(card);
      });
      on(card.el, "pointerleave", () => {
        if (!pinned && source === card) release();
      });
    }
    on(card.el, "focusin", (event) => {
      if (pinned || (event.target as HTMLElement).classList.contains("hc-chip")) return;
      highlightCard(card);
    });
    on(card.el, "focusout", (event) => {
      const next = (event as FocusEvent).relatedTarget as Node | null;
      if (!pinned && !(next && card.el.contains(next))) release();
    });
    // The whole card opens the profile; links and chips keep their own job.
    on(card.el, "click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("a, button")) return;
      if (window.getSelection()?.toString()) return;
      const link = card.el.querySelector<HTMLAnchorElement>(".hc-card__name a");
      link?.click();
    });
  }

  grid.querySelectorAll<HTMLButtonElement>(".hc-chip").forEach((chip) => {
    on(chip, "click", () => {
      const tag = chip.dataset.tag ?? "";
      pinned = pinned === tag ? null : tag;
      syncChips();
      if (pinned) {
        highlightTag(pinned);
        const count = cards.filter((card) => card.tags.has(tag)).length;
        if (status) status.textContent = `${chip.textContent?.trim()}: ${count === 1 ? "1 builder" : `${count} builders`}`;
        const card = chip.closest<HTMLElement>("[data-hc-card]");
        if (card) scrollToHolder(card, tag);
      } else {
        clearMarks();
        if (status) status.textContent = "";
      }
    });
  });

  // Each card's chips are one Tab stop; arrows move between them.
  on(grid, "keydown", (event) => {
    const key = (event as KeyboardEvent).key;
    const chip = (event.target as HTMLElement).closest<HTMLButtonElement>(".hc-chip");
    if (!chip || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(key)) return;
    const chips = [...(chip.closest(".hc-chips")?.querySelectorAll<HTMLButtonElement>(".hc-chip") ?? [])];
    const at = chips.indexOf(chip);
    const next =
      key === "Home" ? 0 : key === "End" ? chips.length - 1 : (at + (key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1) + chips.length) % chips.length;
    event.preventDefault();
    chips.forEach((other, i) => other.setAttribute("tabindex", i === next ? "0" : "-1"));
    chips[next]?.focus();
  });

  on(section, "keydown", (event) => {
    if ((event as KeyboardEvent).key !== "Escape" || !pinned) return;
    pinned = null;
    syncChips();
    clearMarks();
    if (status) status.textContent = "";
  });

  let resizeFrame = 0;
  const onResize = () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (pinned) highlightTag(pinned);
      else if (source) highlightCard(source);
    });
  };
  on(window, "resize", onResize);

  return () => {
    for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
    cancelAnimationFrame(resizeFrame);
    cancelAnimationFrame(dotFrame);
    pinned = null;
    syncChips();
    clearMarks();
    if (status) status.textContent = "";
  };
}
