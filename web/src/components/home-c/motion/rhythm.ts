import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { LiveNet } from "./net";
import type { Conditions } from "./types";

interface Model {
  nodeStates: Record<string, Array<{ x: number; y: number; o: number }>>;
  edgeStates: Record<string, number[]>;
  ringStates: Array<Array<{ r: number; gap: number }>>;
}

/** Put a live network straight into one step's state. */
function applyStep(net: LiveNet, model: Model, step: number) {
  for (const node of net.nodes) {
    const state = model.nodeStates[node.id]?.[step];
    if (!state) continue;
    node.x = state.x;
    node.y = state.y;
    node.o = state.o;
    node.s = 1;
  }
  for (const edge of net.edges) edge.p = model.edgeStates[edge.id]?.[step] ?? 0;
  net.rings.forEach((ring, i) => Object.assign(ring, model.ringStates[i]?.[step] ?? {}));
  net.render();
}

/**
 * The cohort rhythm. Wide screens scrub one sticky network through three
 * states as the steps pass. Reduced motion swaps states with a crossfade.
 * Narrow screens draw each step's own frame as it arrives.
 */
export function setupRhythm(root: HTMLElement, c: Conditions): () => void {
  const section = root.querySelector<HTMLElement>("[data-hc-rhythm]");
  const source = section?.querySelector("[data-hc-rhythm-model]");
  if (!section || !source?.textContent) return () => {};
  const model = JSON.parse(source.textContent) as Model;
  const steps = [...section.querySelectorAll<HTMLElement>("[data-hc-step]")];
  const list = section.querySelector<HTMLElement>(".hc-rhythm__steps");

  if (c.wide) {
    const svg = section.querySelector<SVGSVGElement>('[data-hc-net="rhythm"]');
    if (!svg || !list) return () => {};
    const net = new LiveNet(svg);
    let shown = -1;
    const show = (index: number) => {
      if (index === shown) return;
      shown = index;
      if (c.motion) return;
      gsap.timeline()
        .to(svg, { opacity: 0, duration: 0.18 })
        .add(() => applyStep(net, model, index))
        .to(svg, { opacity: 1, duration: 0.32 });
    };

    steps.forEach((step, index) => {
      ScrollTrigger.create({
        trigger: step,
        start: "top 58%",
        end: "bottom 58%",
        toggleClass: "is-active",
        onToggle: (self) => {
          if (self.isActive) show(index);
        },
      });
    });

    if (!c.motion) {
      applyStep(net, model, 0);
      shown = 0;
      return () => applyStep(net, model, 2);
    }

    ScrollTrigger.create({
      trigger: list,
      start: "top 50%",
      end: "bottom 50%",
      onUpdate: (self) => list.style.setProperty("--hc-progress", self.progress.toFixed(4)),
    });

    // Start from nothing: the first step builds the ring.
    applyStep(net, model, 0);
    for (const node of net.nodes) node.s = 0;
    for (const edge of net.edges) edge.p = 0;
    net.rings.forEach((ring) => (ring.gap = 1));
    net.render();

    const staged = net.nodes.filter((node) => model.nodeStates[node.id]);
    const arriving = (step: number) =>
      net.edges.filter((edge) => model.edgeStates[edge.id]?.[step] === 1 && (step === 0 || model.edgeStates[edge.id]?.[step - 1] === 0));

    const timeline = gsap.timeline({
      defaults: { ease: "power2.inOut" },
      onUpdate: () => net.render(),
      scrollTrigger: { trigger: list, start: "top 60%", end: "bottom 70%", scrub: 0.8 },
    });

    const builders = net.nodes.filter((node) => model.nodeStates[node.id][0].o > 0);
    timeline
      .to(builders, { s: 1, duration: 0.45, ease: "back.out(2)", stagger: 0.06 }, 0)
      .to(arriving(0), { p: 1, duration: 0.5, stagger: 0.04 }, 0.2)
      .to(net.rings, { gap: 0, duration: 0.9 }, 0.1);

    ([1, 2] as const).forEach((step) => {
      const at = step === 1 ? 1.3 : 2.9;
      for (const node of staged) {
        const state = model.nodeStates[node.id][step];
        timeline.to(node, { x: state.x, y: state.y, o: state.o, s: 1, duration: 0.9 }, at + node.order * 0.1);
      }
      timeline.to(arriving(step), { p: 1, duration: 0.45, stagger: 0.03 }, at + 0.35);
      net.rings.forEach((ring, i) => {
        timeline.to(ring, { ...model.ringStates[i][step], duration: 0.9 }, at);
      });
    });
    timeline.to({}, { duration: 0.7 }, 3.9);

    return () => {
      list.style.removeProperty("--hc-progress");
      applyStep(net, model, 2);
    };
  }

  if (!c.motion) return () => {};

  // Narrow screens: every step frame draws itself in once.
  const nets = steps
    .map((step) => step.querySelector<SVGSVGElement>(".hc-step__svg"))
    .filter((svg): svg is SVGSVGElement => Boolean(svg))
    .map((svg) => new LiveNet(svg));
  nets.forEach((net) => {
    for (const node of net.nodes) node.s = 0;
    for (const edge of net.edges) edge.p = 0;
    net.render();
    ScrollTrigger.create({
      trigger: net.svg,
      start: "top 82%",
      once: true,
      onEnter: () => {
        gsap.timeline({ onUpdate: () => net.render() })
          .to(net.nodes, { s: 1, duration: 0.5, ease: "back.out(2)", stagger: (_i: number, node: { order: number }) => node.order * 0.35 }, 0)
          .to(net.edges, { p: 1, duration: 0.55, ease: "power2.out", stagger: (_i: number, edge: { order: number }) => 0.1 + edge.order * 0.4 }, 0.05);
      },
    });
  });
  return () => {
    nets.forEach((net) => {
      for (const node of net.nodes) node.s = 1;
      for (const edge of net.edges) edge.p = 1;
      net.render();
    });
  };
}
