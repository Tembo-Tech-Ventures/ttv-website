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
  /** 0..1, how close the pointer is (hero only). */
  glow: number;
  /** Last values written, so unchanged nodes cost nothing. */
  written: { transform: string; opacity: string };
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
  written: { x1: string; y1: string; x2: string; y2: string; opacity: string; width: string };
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
  /** The camera: written to the viewBox when it moves. */
  readonly view: { x: number; y: number; w: number; h: number };
  private writtenView = "";
  private byId = new Map<string, LiveNode>();

  constructor(svg: SVGSVGElement) {
    this.svg = svg;
    const box = svg.viewBox.baseVal;
    this.view = { x: box.x, y: box.y, w: box.width, h: box.height };
    this.writtenView = svg.getAttribute("viewBox") ?? "";
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
        glow: 0,
        written: { transform: "", opacity: "" },
      };
      el.style.setProperty("--hc-i", String(index % 7));
      this.nodes.push(node);
      this.byId.set(node.id, node);
    });
    svg.querySelectorAll<SVGLineElement>("[data-e]").forEach((el) => {
      const a = this.byId.get(el.dataset.a ?? "");
      const b = this.byId.get(el.dataset.b ?? "");
      if (!a || !b) return;
      this.edges.push({ id: el.dataset.e ?? "", kind: el.classList[1]?.replace("hc-e--", "") ?? "", el, a, b, p: 1, o: 1, order: num(el.dataset.order), written: { x1: "", y1: "", x2: "", y2: "", opacity: "", width: "" } });
    });
    svg.querySelectorAll<SVGCircleElement>("[data-ring]").forEach((el) => {
      const dash = (el.getAttribute("stroke-dasharray") ?? "100 0").split(/\s+/).map((part) => num(part));
      this.rings.push({ el, r: num(el.getAttribute("r")), gap: (dash[1] ?? 0) / 100 });
    });
  }

  node(id: string) {
    return this.byId.get(id);
  }

  /**
   * Write the model back to the SVG. Values are rounded to a tenth of a unit
   * and only written when they change, so a resting network costs nothing.
   */
  render() {
    for (const node of this.nodes) {
      const x = (node.x + node.dx).toFixed(1);
      const y = (node.y + node.dy).toFixed(1);
      const s = Math.max(node.s, 0.001);
      const transform = Math.abs(s - 1) < 0.005 ? `translate(${x} ${y})` : `translate(${x} ${y}) scale(${s.toFixed(3)})`;
      const opacity = node.o.toFixed(2);
      set(node.el, "transform", transform, node.written, "transform");
      set(node.el, "opacity", opacity, node.written, "opacity");
    }
    for (const edge of this.edges) {
      const ax = edge.a.x + edge.a.dx;
      const ay = edge.a.y + edge.a.dy;
      const bx = edge.b.x + edge.b.dx;
      const by = edge.b.y + edge.b.dy;
      const w = edge.written;
      set(edge.el, "x1", ax.toFixed(1), w, "x1");
      set(edge.el, "y1", ay.toFixed(1), w, "y1");
      set(edge.el, "x2", (ax + (bx - ax) * edge.p).toFixed(1), w, "x2");
      set(edge.el, "y2", (ay + (by - ay) * edge.p).toFixed(1), w, "y2");
      // An edge is only as visible as the fainter of its two ends.
      set(edge.el, "opacity", (edge.o * Math.min(edge.a.o, edge.b.o, 1) * (edge.p > 0.001 ? 1 : 0)).toFixed(2), w, "opacity");
      const glow = Math.max(edge.a.glow, edge.b.glow);
      set(edge.el, "stroke-width", glow > 0.02 ? (1 + glow * 1.6).toFixed(2) : "", w, "width");
    }
    const view = `${this.view.x.toFixed(1)} ${this.view.y.toFixed(1)} ${this.view.w.toFixed(1)} ${this.view.h.toFixed(1)}`;
    if (view !== this.writtenView) {
      this.writtenView = view;
      this.svg.setAttribute("viewBox", view);
    }
    for (const ring of this.rings) {
      ring.el.setAttribute("r", ring.r.toFixed(1));
      ring.el.setAttribute("stroke-dasharray", `${(100 - ring.gap * 100).toFixed(2)} ${(ring.gap * 100).toFixed(2)}`);
    }
  }
}

function set<K extends string>(el: SVGElement, attr: string, value: string, cache: Record<K, string>, key: K) {
  if (cache[key] === value) return;
  cache[key] = value;
  // Stroke width is set in CSS, which outranks presentation attributes.
  if (attr === "stroke-width") el.style.setProperty(attr, value);
  else if (value === "") el.removeAttribute(attr);
  else el.setAttribute(attr, value);
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
