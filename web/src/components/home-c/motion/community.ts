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
  const svg = frame?.querySelector<SVGSVGElement>(c.narrow ? ".hc-community__svg--wide" : ".hc-community__svg--square");
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
    const nodes = net.nodes.filter((node) => node.kind === role);
    if (nodes.length === 0) return fullView;
    // Move in at least 1.6x. Where the role is spread out (partners sit on the
    // rim), frame the window that holds the most of it; neighbours may crop.
    const spanX = Math.max(...nodes.map((n) => n.x)) - Math.min(...nodes.map((n) => n.x)) + 60;
    const spanY = Math.max(...nodes.map((n) => n.y)) - Math.min(...nodes.map((n) => n.y)) + 60;
    const zoom = Math.max(1.6, Math.min(fullView.w / spanX, fullView.h / spanY));
    const w = fullView.w / zoom;
    const h = fullView.h / zoom;
    const place = (cx: number, cy: number) => ({
      x: Math.min(Math.max(cx - w / 2, fullView.x), fullView.x + fullView.w - w),
      y: Math.min(Math.max(cy - h / 2, fullView.y), fullView.y + fullView.h - h),
      w,
      h,
    });
    const inside = (view: { x: number; y: number }, n: { x: number; y: number }) =>
      n.x > view.x + 10 && n.x < view.x + w - 10 && n.y > view.y + 10 && n.y < view.y + h - 10;
    const mid = { x: fullView.x + fullView.w / 2, y: fullView.y + fullView.h / 2 };
    const candidates = [
      place(nodes.reduce((s, n) => s + n.x, 0) / nodes.length, nodes.reduce((s, n) => s + n.y, 0) / nodes.length),
      ...nodes.map((n) => place((n.x + mid.x) / 2, (n.y + mid.y) / 2)),
    ];
    return candidates.reduce((best, view) => (nodes.filter((n) => inside(view, n)).length > nodes.filter((n) => inside(best, n)).length ? view : best));
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
    toggles.forEach((toggle) => toggle.classList.toggle("is-lit", toggle.dataset.role === role));
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
    // Focusing (or hovering) a pill previews its role and ends the intro pass.
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
    on(toggle, "focusin", enter);
    on(toggle, "focusout", leave);
    if (c.fine) {
      on(toggle, "pointerenter", enter);
      on(toggle, "pointerleave", leave);
    }
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
  const stage = section.querySelector<HTMLElement>(".hc-community__stage");
  const watchReading = () => {
    observer?.disconnect();
    // The reading line: a 152 px zone just under the sticky band on phones,
    // the middle of the screen elsewhere.
    const bandBottom = c.narrow && stage ? Number.parseFloat(getComputedStyle(stage).top) + stage.offsetHeight : window.innerHeight * 0.45;
    const top = Math.round(bandBottom + 8);
    const bottom = Math.max(0, Math.round(window.innerHeight - bandBottom - 160));
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const role = ((entry.target as HTMLElement).dataset.role ?? null) as Role | null;
          if (entry.isIntersecting) inView = role;
          else if (inView === role) inView = null;
        }
        sync();
      },
      { rootMargin: `-${top}px 0px -${bottom}px 0px` },
    );
    cards.forEach((card) => observer?.observe(card));
  };
  if (!c.fine) {
    watchReading();
    on(window, "resize", watchReading);
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
    toggles.forEach((toggle) => toggle.classList.remove("is-lit"));
  };
}
