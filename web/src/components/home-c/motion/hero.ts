import { gsap } from "gsap";
import { LiveNet, whileVisible } from "./net";
import { riseWords } from "./reveal";
import type { Conditions } from "./types";

const fontsReady = () =>
  Promise.race([
    document.fonts.ready,
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, 250);
    }),
  ]);

/**
 * Hero: the four cohorts draw themselves in, then keep breathing. Fine
 * pointers pull nearby nodes gently towards the cursor; touch screens get a
 * slow autonomous drift instead.
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
  let disposed = false;
  const timeline = gsap.timeline({ paused: true, onUpdate: () => net.render() });

  if (html.classList.contains("hc-intro")) {
    for (const node of net.nodes) node.s = 0;
    for (const edge of net.edges) edge.p = 0;
    net.render();
    const fades = hero.querySelectorAll(".hc-hero__summary, .hc-hero__actions, .hc-fact");
    gsap.set(fades, { autoAlpha: 0, y: 18 });
    const h1 = hero.querySelector<HTMLElement>("h1");

    const start = () => {
      if (disposed) return;
      if (h1) {
        h1.classList.add("hc-revealing");
        gsap.set(h1.querySelectorAll(".hc-w"), { yPercent: 118 });
      }
      html.classList.remove("hc-intro");
      if (h1) timeline.add(riseWords(h1), 0);
      timeline
        .to(fades, { autoAlpha: 1, y: 0, duration: 0.55, ease: "power3.out", stagger: 0.05, clearProps: "opacity,visibility,transform" }, 0.22)
        .to(net.nodes, { s: 1, duration: 0.45, ease: "back.out(2.2)", stagger: (_i: number, node: { order: number }) => node.order * 0.4 }, 0.05)
        .to(net.edges, { p: 1, duration: 0.45, ease: "power2.out", stagger: (_i: number, edge: { order: number }) => 0.08 + edge.order * 0.4 }, 0.05);
      timeline.play();
    };
    void fontsReady().then(start, start);
  }

  // Ambient drift and pointer attraction share one ticker.
  const pointer = { x: 0, y: 0, active: false };
  const amplitude = c.fine ? 2.5 : 5;
  const radius = 130;
  const tick = (time: number) => {
    for (const node of net.nodes) {
      let tx = Math.sin(time * 0.45 + node.seed) * amplitude;
      let ty = Math.cos(time * 0.38 + node.seed * 1.3) * amplitude;
      if (pointer.active) {
        const ddx = pointer.x - node.x;
        const ddy = pointer.y - node.y;
        const d = Math.hypot(ddx, ddy);
        if (d < radius) {
          const pull = (1 - d / radius) ** 2 * 0.38;
          tx += ddx * pull;
          ty += ddy * pull;
        }
      }
      node.dx += (tx - node.dx) * 0.08;
      node.dy += (ty - node.dy) * 0.08;
    }
    net.render();
  };

  const stopVisible = whileVisible(
    svg,
    () => {
      svg.classList.remove("hc-paused");
      gsap.ticker.add(tick);
    },
    () => {
      svg.classList.add("hc-paused");
      gsap.ticker.remove(tick);
    },
  );

  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    const box = svg.getBoundingClientRect();
    const view = svg.viewBox.baseVal;
    // preserveAspectRatio "meet": one scale, centred.
    const scale = Math.min(box.width / view.width, box.height / view.height);
    const offsetX = (box.width - view.width * scale) / 2;
    const offsetY = (box.height - view.height * scale) / 2;
    pointer.x = (event.clientX - box.left - offsetX) / scale;
    pointer.y = (event.clientY - box.top - offsetY) / scale;
    pointer.active = true;
  };
  const onLeave = () => {
    pointer.active = false;
  };
  if (c.fine) {
    hero.addEventListener("pointermove", onMove);
    hero.addEventListener("pointerleave", onLeave);
  }

  return () => {
    disposed = true;
    stopVisible();
    timeline.kill();
    hero.querySelector("h1")?.classList.remove("hc-revealing");
    hero.removeEventListener("pointermove", onMove);
    hero.removeEventListener("pointerleave", onLeave);
    html.classList.remove("hc-intro");
  };
}
