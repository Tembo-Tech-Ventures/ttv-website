/**
 * A live view of one server-rendered constellation. Tweens and tickers change
 * plain numbers on these objects; `render()` writes them back as SVG
 * attributes in one pass. No layout is read here.
 */
export interface LiveNode {
  id: string;
  kind: string;
  el: SVGGElement;
  x: number;
  y: number;
  /** Offsets from drift or pointer attraction. */
  dx: number;
  dy: number;
  s: number;
  o: number;
  order: number;
  seed: number;
}

export interface LiveEdge {
  id: string;
  kind: string;
  el: SVGLineElement;
  a: LiveNode;
  b: LiveNode;
  /** How much of the line is drawn, 0..1, from a towards b. */
  p: number;
  o: number;
  order: number;
}

export interface LiveRing {
  el: SVGCircleElement;
  r: number;
  gap: number;
}

const num = (value: string | null | undefined, fallback = 0) => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
};

function translateOf(el: Element): { x: number; y: number } {
  const match = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(el.getAttribute("transform") ?? "");
  return { x: num(match?.[1]), y: num(match?.[2]) };
}

export class LiveNet {
  readonly svg: SVGSVGElement;
  readonly nodes: LiveNode[] = [];
  readonly edges: LiveEdge[] = [];
  readonly rings: LiveRing[] = [];
  private byId = new Map<string, LiveNode>();

  constructor(svg: SVGSVGElement) {
    this.svg = svg;
    svg.querySelectorAll<SVGGElement>("[data-n]").forEach((el, index) => {
      const { x, y } = translateOf(el);
      const node: LiveNode = {
        id: el.dataset.n ?? String(index),
        kind: el.dataset.kind ?? "builder",
        el,
        x,
        y,
        dx: 0,
        dy: 0,
        s: 1,
        o: num(el.getAttribute("opacity"), 1),
        order: num(el.dataset.order),
        seed: index * 1.7,
      };
      el.style.setProperty("--hc-i", String(index % 7));
      this.nodes.push(node);
      this.byId.set(node.id, node);
    });
    svg.querySelectorAll<SVGLineElement>("[data-e]").forEach((el) => {
      const a = this.byId.get(el.dataset.a ?? "");
      const b = this.byId.get(el.dataset.b ?? "");
      if (!a || !b) return;
      this.edges.push({ id: el.dataset.e ?? "", kind: el.classList[1]?.replace("hc-e--", "") ?? "", el, a, b, p: 1, o: 1, order: num(el.dataset.order) });
    });
    svg.querySelectorAll<SVGCircleElement>("[data-ring]").forEach((el) => {
      const dash = (el.getAttribute("stroke-dasharray") ?? "100 0").split(/\s+/).map((part) => num(part));
      this.rings.push({ el, r: num(el.getAttribute("r")), gap: (dash[1] ?? 0) / 100 });
    });
  }

  node(id: string) {
    return this.byId.get(id);
  }

  render() {
    for (const node of this.nodes) {
      const x = node.x + node.dx;
      const y = node.y + node.dy;
      node.el.setAttribute("transform", node.s === 1 ? `translate(${x.toFixed(2)} ${y.toFixed(2)})` : `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${Math.max(node.s, 0.001).toFixed(3)})`);
      node.el.setAttribute("opacity", node.o.toFixed(3));
    }
    for (const edge of this.edges) {
      const ax = edge.a.x + edge.a.dx;
      const ay = edge.a.y + edge.a.dy;
      const bx = edge.b.x + edge.b.dx;
      const by = edge.b.y + edge.b.dy;
      edge.el.setAttribute("x1", ax.toFixed(2));
      edge.el.setAttribute("y1", ay.toFixed(2));
      edge.el.setAttribute("x2", (ax + (bx - ax) * edge.p).toFixed(2));
      edge.el.setAttribute("y2", (ay + (by - ay) * edge.p).toFixed(2));
      // An edge is only as visible as the fainter of its two ends.
      edge.el.setAttribute("opacity", (edge.o * Math.min(edge.a.o, edge.b.o, 1) * (edge.p > 0.001 ? 1 : 0)).toFixed(3));
    }
    for (const ring of this.rings) {
      ring.el.setAttribute("r", ring.r.toFixed(2));
      ring.el.setAttribute("stroke-dasharray", `${(100 - ring.gap * 100).toFixed(2)} ${(ring.gap * 100).toFixed(2)}`);
    }
  }
}

/** Runs `fn` on every frame only while `el` is on screen and the tab is visible. */
export function whileVisible(el: Element, start: () => void, stop: () => void): () => void {
  let onScreen = false;
  let running = false;
  const sync = () => {
    const should = onScreen && document.visibilityState === "visible";
    if (should && !running) start();
    if (!should && running) stop();
    running = should;
  };
  const observer = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    sync();
  });
  observer.observe(el);
  document.addEventListener("visibilitychange", sync);
  return () => {
    observer.disconnect();
    document.removeEventListener("visibilitychange", sync);
    if (running) stop();
    running = false;
  };
}
