import { gsap } from "gsap";
import { LiveNet, whileVisible } from "./net";
import type { Conditions } from "./types";

/** Stop drifting after this long without the pointer moving; scrolling or touching wakes it. */
const IDLE_MS = 10_000;

/**
 * Hero network: the four cohorts draw themselves in, then keep breathing. The
 * hero text never waits for this module (its rise is pure CSS). Fine pointers
 * pull nearby nodes towards the cursor and brighten their links; touch
 * screens get a slow autonomous drift at half the frame rate.
 */
export function setupHero(root: HTMLElement, c: Conditions): () => void {
  const html = document.documentElement;
  const hero = root.querySelector<HTMLElement>("[data-hc-hero]");
  const svg = root.querySelector<SVGSVGElement>(c.wide ? ".hc-hero__svg--square" : ".hc-hero__svg--wide");
  if (!hero || !svg || !c.motion) {
    html.classList.remove("hc-intro");
    return () => {};
  }

  const net = new LiveNet(svg);
  const timeline = gsap.timeline({ onUpdate: () => net.render() });

  if (html.classList.contains("hc-intro")) {
    for (const node of net.nodes) node.s = 0;
    for (const edge of net.edges) edge.p = 0;
    net.render();
    html.classList.remove("hc-intro");
    timeline
      .to(net.nodes, { s: 1, duration: 0.45, ease: "back.out(2.2)", stagger: (_i: number, node: { order: number }) => node.order * 0.4 }, 0.05)
      .to(net.edges, { p: 1, duration: 0.45, ease: "power2.out", stagger: (_i: number, edge: { order: number }) => 0.08 + edge.order * 0.4 }, 0.05);
  }

  // Ambient drift and pointer attraction share one ticker.
  const pointer = { x: 0, y: 0, active: false };
  const amplitude = c.fine ? 2.5 : 5;
  const radius = 190;
  let frame = 0;
  let lastActivity = performance.now();
  let running = false;
  const tick = (time: number) => {
    frame += 1;
    if (!c.fine && frame % 2 === 1) return;
    if (performance.now() - lastActivity > IDLE_MS && !pointer.active) {
      stop();
      return;
    }
    for (const node of net.nodes) {
      let tx = Math.sin(time * 0.45 + node.seed) * amplitude;
      let ty = Math.cos(time * 0.38 + node.seed * 1.3) * amplitude;
      let near = 0;
      if (pointer.active) {
        const ddx = pointer.x - node.x;
        const ddy = pointer.y - node.y;
        const d = Math.hypot(ddx, ddy);
        if (d < radius) {
          near = (1 - d / radius) ** 2;
          tx += ddx * near * 0.7;
          ty += ddy * near * 0.7;
        }
      }
      node.dx += (tx - node.dx) * 0.1;
      node.dy += (ty - node.dy) * 0.1;
      node.glow += (near - node.glow) * 0.12;
      node.s = 1 + node.glow * 0.6;
    }
    net.render();
  };
  const start = () => {
    if (running) return;
    running = true;
    svg.classList.remove("hc-paused");
    gsap.ticker.add(tick);
  };
  const stop = () => {
    if (!running) return;
    running = false;
    svg.classList.add("hc-paused");
    gsap.ticker.remove(tick);
  };
  const wake = () => {
    lastActivity = performance.now();
    if (visible) start();
  };

  let visible = false;
  const stopVisible = whileVisible(
    svg,
    () => {
      visible = true;
      wake();
    },
    () => {
      visible = false;
      stop();
    },
  );

  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    // Screen to viewBox units, whatever the alignment and scale.
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const at = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    pointer.x = at.x;
    pointer.y = at.y;
    pointer.active = true;
    wake();
  };
  const onLeave = () => {
    pointer.active = false;
  };
  if (c.fine) {
    hero.addEventListener("pointermove", onMove);
    hero.addEventListener("pointerleave", onLeave);
  }
  window.addEventListener("scroll", wake, { passive: true });
  window.addEventListener("touchstart", wake, { passive: true });

  return () => {
    stopVisible();
    stop();
    timeline.kill();
    hero.removeEventListener("pointermove", onMove);
    hero.removeEventListener("pointerleave", onLeave);
    window.removeEventListener("scroll", wake);
    window.removeEventListener("touchstart", wake);
    html.classList.remove("hc-intro");
  };
}
