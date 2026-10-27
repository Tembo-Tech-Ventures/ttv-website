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

/**
 * Community: each role lights up where it plugs into the network. Hover or
 * focus picks a role; otherwise, with motion allowed, the roles take turns
 * while the section is on screen.
 */
export function setupCommunity(root: HTMLElement, c: Conditions): () => void {
  const section = root.querySelector<HTMLElement>("[data-hc-community]");
  const frame = section?.querySelector<HTMLElement>("[data-hc-community-net]");
  const svg = frame?.querySelector<SVGSVGElement>("svg");
  if (!section || !frame || !svg) return () => {};
  const roles = [...section.querySelectorAll<HTMLElement>("[data-hc-role]")];
  const net = new LiveNet(svg);
  const listeners: Array<[EventTarget, string, EventListener]> = [];
  const on = (target: EventTarget, type: string, fn: EventListener) => {
    target.addEventListener(type, fn);
    listeners.push([target, type, fn]);
  };

  let current: Role = "all";
  let held: Role | null = null;

  const setRole = (role: Role) => {
    if (role === current) return;
    current = role;
    frame.dataset.role = role;
    roles.forEach((card) => card.classList.toggle("is-lit", card.dataset.role === role));
    if (!c.motion || role === "all") return;
    const lines = net.edges.filter((edge) => edge.kind === EDGE_FOR[role]).map((edge) => edge.el);
    gsap.fromTo(
      lines,
      { drawSVG: "0%" },
      { drawSVG: "100%", duration: 0.7, ease: "power2.out", stagger: 0.025, clearProps: "strokeDasharray,strokeDashoffset" },
    );
    const nodes = net.nodes.filter((node) => node.kind === role);
    gsap.fromTo(nodes, { s: 0.35 }, { s: 1, duration: 0.6, ease: "back.out(3)", stagger: 0.03, onUpdate: () => net.render() });
  };

  for (const card of roles) {
    const role = (card.dataset.role ?? "all") as Role;
    const enter = () => {
      held = role;
      setRole(role);
    };
    const leave = () => {
      if (held !== role) return;
      held = null;
      if (!c.motion) setRole("all");
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
  }

  let stopCycle = () => {};
  if (c.motion) {
    const order: Role[] = ["builder", "mentor", "partner", "all"];
    let index = -1;
    let timer = 0;
    const step = () => {
      if (!held) {
        index = (index + 1) % order.length;
        setRole(order[index]);
      }
      timer = window.setTimeout(step, order[index] === "all" ? 1800 : 2600);
    };
    stopCycle = whileVisible(
      frame,
      () => {
        timer = window.setTimeout(step, 900);
      },
      () => {
        window.clearTimeout(timer);
        if (!held) setRole("all");
      },
    );

    // The network itself arrives drawn from the centre.
    for (const node of net.nodes) node.s = 0;
    for (const edge of net.edges) edge.p = 0;
    net.render();
    ScrollTrigger.create({
      trigger: frame,
      start: "top 80%",
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
    stopCycle();
    for (const node of net.nodes) node.s = 1;
    for (const edge of net.edges) edge.p = 1;
    net.render();
    current = "all";
    frame.dataset.role = "all";
    roles.forEach((card) => card.classList.remove("is-lit"));
  };
}
