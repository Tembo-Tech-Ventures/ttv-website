import { clamp01, navHeight, type Scene } from "./scenes";

const SVG_NS = "http://www.w3.org/2000/svg";
const WIDE = "(min-width: 80rem)";

interface Piece {
  /** A straight vertical run (scaled, so it costs no repaint) or a short curve (drawn by dash). */
  el: HTMLElement | SVGPathElement;
  kind: "run" | "curve";
  /** Sheet-relative y span this piece draws over as the head passes. */
  from: number;
  to: number;
}

interface Segment {
  sheet: HTMLElement;
  box: HTMLElement;
  pieces: Piece[];
  stations: Array<{ el: HTMLElement; y: number }>;
}

/**
 * "The map keeps going": on wide screens the skills map's peach tail leaves
 * the map and runs down the page's right margin, one thread through every
 * sheet after it, with a small station level with each section's heading,
 * until it ties off in a knot above "Propose a project". Each sheet draws its
 * own stretch (so the thread survives the stacking: it tips and dims with
 * its sheet), starting where the previous one ended.
 *
 * Straight runs are 1.5px boxes scaled from the top, so drawing them while
 * scrolling is compositor work only; the two short curves (out of the map,
 * into the knot) are small SVGs drawn by dash offset. Geometry is rebuilt on
 * resize. Without motion the thread is drawn whole; with motion `scene` draws
 * its head along the same reading line as the phone trunk. Decorative and
 * aria-hidden; nothing here is text.
 */
export function initThread(root: HTMLElement): { scene: Scene; stop: () => void } | null {
  const sheets = [...root.querySelectorAll<HTMLElement>("[data-hd-sheet]")];
  const mapSheet = sheets.find((sheet) => sheet.querySelector("[data-hd-map-stage]"));
  const hireSheet = sheets.find((sheet) => sheet.querySelector("[data-hd-hire]"));
  if (!mapSheet || !hireSheet) return null;
  const run = sheets.slice(sheets.indexOf(mapSheet), sheets.indexOf(hireSheet) + 1);
  const wide = window.matchMedia(WIDE);
  let segments: Segment[] = [];

  const clear = () => {
    for (const segment of segments) segment.box.remove();
    segments = [];
  };

  const runPiece = (box: HTMLElement, x: number, from: number, to: number): Piece => {
    const el = document.createElement("span");
    el.className = "hd-thread__run";
    el.style.cssText = `left:${x - 0.75}px;top:${from}px;height:${Math.max(0, to - from)}px`;
    box.appendChild(el);
    return { el, kind: "run", from, to };
  };

  /** A curve in its own small SVG; `d` uses sheet coordinates. */
  const curvePiece = (box: HTMLElement, d: string, bounds: { x: number; y: number; w: number; h: number }, from: number, to: number): Piece => {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "hd-thread__curve");
    svg.setAttribute("width", String(bounds.w));
    svg.setAttribute("height", String(bounds.h));
    svg.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`);
    svg.style.cssText = `left:${bounds.x}px;top:${bounds.y}px`;
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("pathLength", "1");
    svg.appendChild(path);
    box.appendChild(svg);
    return { el: path, kind: "curve", from, to };
  };

  const dot = (box: HTMLElement, x: number, y: number, kind: "station" | "knot") => {
    const el = document.createElement("span");
    el.className = `hd-thread__${kind}`;
    el.style.cssText = `left:${x}px;top:${Math.round(y)}px`;
    box.appendChild(el);
    return { el, y: Math.round(y) };
  };

  const build = () => {
    clear();
    if (!wide.matches || root.querySelector(".hd-map--empty")) return;
    for (const sheet of run) {
      const width = sheet.offsetWidth;
      const height = sheet.offsetHeight;
      // Halfway into the margin beside the content (max-w 80rem, 2rem padding), at least 16px in.
      const x = Math.round(width / 2 + 608 + Math.max(16, (width / 2 - 608) / 2));
      const heading = sheet.querySelector<HTMLElement>("h2");
      const box = document.createElement("div");
      box.className = `hd-thread${sheet === hireSheet ? " hd-thread--on-peach" : ""}`;
      box.setAttribute("aria-hidden", "true");
      const pieces: Piece[] = [];
      const stations: Segment["stations"] = [];
      let end = height;

      if (sheet === mapSheet) {
        const start = tailEnd(sheet);
        if (!start) continue;
        // Out of the map to the margin, then straight down.
        const bend = start.y + 90;
        const d = `M${start.x} ${start.y} C${x} ${start.y} ${x} ${start.y} ${x} ${bend}`;
        pieces.push(curvePiece(box, d, { x: start.x - 4, y: start.y - 4, w: x - start.x + 8, h: bend - start.y + 8 }, start.y, bend));
        pieces.push(runPiece(box, x, bend, height));
      } else if (sheet === hireSheet) {
        const card = sheet.querySelector<HTMLElement>(".hd-hcard--primary");
        if (!card) continue;
        const top = offsetWithin(card, sheet) - 18;
        const knotX = offsetLeftWithin(card, sheet) + card.offsetWidth - 64;
        end = top;
        pieces.push(runPiece(box, x, 0, top - 70));
        const d = `M${x} ${top - 70} C${x} ${top} ${x} ${top} ${knotX} ${top}`;
        pieces.push(curvePiece(box, d, { x: knotX - 4, y: top - 74, w: x - knotX + 8, h: 78 }, top - 70, top));
        stations.push(dot(box, knotX, top, "knot"));
      } else {
        pieces.push(runPiece(box, x, 0, height));
      }
      if (heading && sheet !== mapSheet) {
        const y = offsetWithin(heading, sheet) + heading.offsetHeight / 2;
        if (y < end) stations.unshift(dot(box, x, y, "station"));
      }
      sheet.insertBefore(box, sheet.firstChild);
      segments.push({ sheet, box, pieces, stations });
    }
  };

  const observer = new ResizeObserver(() => build());
  observer.observe(root);
  wide.addEventListener("change", build);
  void document.fonts.ready.then(build);
  build();

  const heads = new Map<Segment, number>();
  const drawnOf = new Map<Piece, string>();
  const scene: Scene = {
    read() {
      // The head follows the reading line, never above the nav.
      const line = Math.max(window.innerHeight * 0.62, navHeight());
      for (const segment of segments) heads.set(segment, line - segment.sheet.getBoundingClientRect().top);
    },
    write() {
      for (const segment of segments) {
        // Class writes only on change: even a no-op classList write can invalidate style.
        if (!segment.box.classList.contains("is-live")) segment.box.classList.add("is-live");
        const head = heads.get(segment) ?? 0;
        for (const piece of segment.pieces) {
          const drawn = clamp01((head - piece.from) / Math.max(1, piece.to - piece.from)).toFixed(3);
          if (drawnOf.get(piece) === drawn) continue;
          drawnOf.set(piece, drawn);
          if (piece.kind === "run") (piece.el as HTMLElement).style.transform = `scaleY(${drawn})`;
          else piece.el.style.strokeDashoffset = (1 - Number(drawn)).toFixed(3);
        }
        for (const station of segment.stations) {
          const on = head >= station.y - 2;
          if (station.el.classList.contains("is-on") !== on) station.el.classList.toggle("is-on", on);
        }
      }
    },
    destroy() {
      drawnOf.clear();
      for (const segment of segments) {
        segment.box.classList.remove("is-live");
        for (const piece of segment.pieces) {
          if (piece.kind === "run") (piece.el as HTMLElement).style.transform = "";
          else piece.el.style.strokeDashoffset = "";
        }
        for (const station of segment.stations) station.el.classList.remove("is-on");
      }
    },
  };

  return {
    scene,
    stop() {
      observer.disconnect();
      wide.removeEventListener("change", build);
      clear();
    },
  };
}

/** Layout offsets inside `ancestor`, ignoring transforms (sheets tip and scale). */
function offsetWithin(el: HTMLElement, ancestor: HTMLElement): number {
  let y = 0;
  for (let node: HTMLElement | null = el; node && node !== ancestor; node = node.offsetParent as HTMLElement | null) y += node.offsetTop;
  return y;
}

function offsetLeftWithin(el: HTMLElement, ancestor: HTMLElement): number {
  let x = 0;
  for (let node: HTMLElement | null = el; node && node !== ancestor; node = node.offsetParent as HTMLElement | null) x += node.offsetLeft;
  return x;
}

/** The end of the map's path, in its sheet's coordinates. */
function tailEnd(sheet: HTMLElement): { x: number; y: number } | null {
  const stage = sheet.querySelector<HTMLElement>("[data-hd-map-stage]");
  const svg = stage?.querySelector<SVGSVGElement>("svg");
  const tail = stage?.querySelector<SVGLineElement>("[data-hd-tail]");
  if (!stage || !svg || !tail || stage.offsetWidth === 0) return null;
  const scale = stage.offsetWidth / svg.viewBox.baseVal.width;
  return {
    x: Math.round(offsetLeftWithin(stage, sheet) + Number(tail.getAttribute("x2")) * scale),
    y: Math.round(offsetWithin(stage, sheet) + Number(tail.getAttribute("y2")) * scale),
  };
}
