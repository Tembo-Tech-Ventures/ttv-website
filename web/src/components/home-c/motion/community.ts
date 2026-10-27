import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { LiveNet, whileVisible } from "./net";
import type { Conditions } from "./types";

type Role = "all" | "builder" | "mentor" | "partner";

const EDGE_FOR: Record<Exclude<Role, "all">, string> = {
  builder: "peer",
  mentor: "mentor",
  partner: "partner",
};

/** How long each role is shown on the one introductory pass. */
const CYCLE_MS = 4000;

/**
 * Community: each role lights up where it plugs into the network.
 *  - Every role heading is a toggle button that pins its role (touch, keyboard, mouse).
 *  - Mouse hover and keyboard focus preview a role while nothing is pinned.
 *  - On touch screens the card in the reading zone lights its role.
 *  - With a mouse and motion allowed, the roles take one 4 s turn each when the
 *    section arrives, then rest; any interaction stops that for good.
 */
export function setupCommunity(root: HTMLElement, c: Conditions): () => void {
  const section = root.querySelector<HTMLElement>("[data-hc-community]");
  const frame = section?.querySelector<HTMLElement>("[data-hc-community-net]");
  const svg = frame?.querySelector<SVGSVGElement>("svg");
  if (!section || !frame || !svg) return () => {};
  const cards = [...section.querySelectorAll<HTMLElement>("[data-hc-role]")];
  const toggles = [...frame.querySelectorAll<HTMLButtonElement>("[data-hc-role-toggle]")];
  const net = new LiveNet(svg);
  const fullView = { ...net.view };

  /*
   * Phones: the band is small, so the camera moves in on the lit role, the
   * same way the rhythm camera frames each step.
   */
  const viewFor = (role: Role) => {
    if (role === "all") return fullView;
    const ids = new Set(net.nodes.filter((node) => node.kind === role).map((node) => node.id));
    for (const edge of net.edges) {
      if (edge.kind !== EDGE_FOR[role]) continue;
      ids.add(edge.a.id);
      ids.add(edge.b.id);
    }
    const nodes = net.nodes.filter((node) => ids.has(node.id));
    if (nodes.length === 0) return fullView;
    let minX = Math.min(...nodes.map((n) => n.x)) - 14;
    let maxX = Math.max(...nodes.map((n) => n.x)) + 14;
    let minY = Math.min(...nodes.map((n) => n.y)) - 14;
    let maxY = Math.max(...nodes.map((n) => n.y)) + 14;
    const box = svg.getBoundingClientRect();
    const aspect = box.width && box.height ? box.width / box.height : 1;
    const grow = (maxX - minX) / (maxY - minY) > aspect ? ((maxX - minX) / aspect - (maxY - minY)) / 2 : 0;
    const widen = (maxX - minX) / (maxY - minY) < aspect ? ((maxY - minY) * aspect - (maxX - minX)) / 2 : 0;
    minY -= grow;
    maxY += grow;
    minX -= widen;
    maxX += widen;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  };
  const frameRole = (role: Role) => {
    if (!c.narrow) return;
    const view = viewFor(role);
    if (c.motion) gsap.to(net.view, { ...view, duration: 0.6, ease: "power3.inOut", overwrite: true, onUpdate: () => net.render() });
    else {
      Object.assign(net.view, view);
      net.render();
    }
  };
  const listeners: Array<[EventTarget, string, EventListener]> = [];
  const on = (target: EventTarget, type: string, fn: EventListener) => {
    target.addEventListener(type, fn);
    listeners.push([target, type, fn]);
  };

  let current: Role = "all";
  let pinned: Role | null = null;
  let preview: Role | null = null;
  let inView: Role | null = null;
  let touched = false;

  const draw = (role: Role) => {
    if (role === current) return;
    current = role;
    frame.dataset.role = role;
    cards.forEach((card) => card.classList.toggle("is-lit", card.dataset.role === role));
    frameRole(role);
    if (!c.motion || role === "all") return;
    const lines = net.edges.filter((edge) => edge.kind === EDGE_FOR[role]).map((edge) => edge.el);
    gsap.fromTo(lines, { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.7, ease: "power2.out", stagger: 0.025, clearProps: "strokeDasharray,strokeDashoffset" });
    const nodes = net.nodes.filter((node) => node.kind === role);
    gsap.fromTo(nodes, { s: 0.35 }, { s: 1, duration: 0.6, ease: "back.out(3)", stagger: 0.03, onUpdate: () => net.render() });
  };
  const sync = (cycleRole: Role | null = null) => draw(pinned ?? preview ?? inView ?? cycleRole ?? "all");

  /* -------------------------------------------- one introductory pass */
  let timer = 0;
  const stopCycle = () => {
    window.clearTimeout(timer);
    timer = 0;
  };
  const interact = () => {
    touched = true;
    stopCycle();
  };
  let stopVisible = () => {};
  if (c.motion && c.fine) {
    const order: Role[] = ["builder", "mentor", "partner"];
    const run = (index: number) => {
      if (touched) return;
      sync(order[index] ?? null);
      if (index < order.length) timer = window.setTimeout(() => run(index + 1), CYCLE_MS);
      else timer = 0;
    };
    stopVisible = whileVisible(
      frame,
      () => {
        if (!touched && !timer) timer = window.setTimeout(() => run(0), 700);
      },
      () => {
        stopCycle();
        sync();
      },
    );
  }

  /* ------------------------------------------------------- toggles */
  const syncToggles = () => {
    toggles.forEach((toggle) => toggle.setAttribute("aria-pressed", String(pinned === toggle.dataset.role)));
  };
  toggles.forEach((toggle) => {
    const role = (toggle.dataset.role ?? "all") as Role;
    on(toggle, "click", () => {
      interact();
      pinned = pinned === role ? null : role;
      syncToggles();
      sync();
    });
  });

  /* ------------------------------------------- hover and focus preview */
  cards.forEach((card) => {
    const role = (card.dataset.role ?? "all") as Role;
    const enter = () => {
      interact();
      preview = role;
      sync();
    };
    const leave = () => {
      if (preview !== role) return;
      preview = null;
      sync();
    };
    if (c.fine) {
      on(card, "pointerenter", enter);
      on(card, "pointerleave", leave);
    }
    on(card, "focusin", enter);
    on(card, "focusout", (event) => {
      const next = (event as FocusEvent).relatedTarget as Node | null;
      if (!(next && card.contains(next))) leave();
    });
  });

  /* ------------------------------------- touch: the card being read */
  let observer: IntersectionObserver | null = null;
  if (!c.fine) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const role = ((entry.target as HTMLElement).dataset.role ?? null) as Role | null;
          if (entry.isIntersecting) inView = role;
          else if (inView === role) inView = null;
        }
        sync();
      },
      // The reading zone sits below the sticky diagram band on phones.
      { rootMargin: "-55% 0px -30% 0px" },
    );
    cards.forEach((card) => observer?.observe(card));
  }

  /* ---------------------------------------------------- arrival draw */
  if (c.motion) {
    for (const node of net.nodes) node.s = 0;
    for (const edge of net.edges) edge.p = 0;
    net.render();
    ScrollTrigger.create({
      trigger: frame,
      start: "top 85%",
      once: true,
      onEnter: () => {
        gsap.timeline({ onUpdate: () => net.render() })
          .to(net.nodes, { s: 1, duration: 0.5, ease: "back.out(2)", stagger: (_i: number, node: { order: number }) => node.order * 0.6 }, 0)
          .to(net.edges, { p: 1, duration: 0.6, ease: "power2.out", stagger: (_i: number, edge: { order: number }) => 0.1 + edge.order * 0.6 }, 0);
      },
    });
  }

  return () => {
    for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
    stopVisible();
    stopCycle();
    observer?.disconnect();
    for (const node of net.nodes) node.s = 1;
    for (const edge of net.edges) edge.p = 1;
    net.render();
    pinned = null;
    syncToggles();
    Object.assign(net.view, fullView);
    net.render();
    current = "all";
    frame.dataset.role = "all";
    cards.forEach((card) => card.classList.remove("is-lit"));
  };
}
