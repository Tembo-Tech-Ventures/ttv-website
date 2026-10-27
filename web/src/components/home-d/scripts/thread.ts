import { clamp01, navHeight, type Scene } from "./scenes";
import { LEAD } from "./stack";

const SVG_NS = "http://www.w3.org/2000/svg";
/** From here the margin beside the content is at least ~64px. */
const WIDE = "(min-width: 88rem)";
/** Length of the soft head, px. */
const FADE = 64;
/** How close (px) the group must be to a station to step into it. */
const AT_STATION = 18;

interface Piece {
  kind: "run" | "curve";
  /** Run: the clipping box and the strip slid inside it. Curve: the path. */
  el: HTMLElement | SVGPathElement;
  ink?: HTMLElement;
  length: number;
  /** Sheet-relative y span this piece draws over as the head passes. */
  from: number;
  to: number;
  x: number;
}

interface Station {
  el: HTMLElement;
  y: number;
}

interface Segment {
  sheet: HTMLElement;
  next: HTMLElement | null;
  box: HTMLElement;
  pieces: Piece[];
  stations: Station[];
  walk: HTMLElement;
  from: number;
  to: number;
  knot: HTMLElement | null;
}

/**
 * "The map keeps going": on wide screens the skills map's path leaves the
 * map and carries on down the right margin, just outside the content, through
 * every later sheet until it ties off on the "Propose a project" card. The
 * map's walking group (four builders, two engineers) steps off the map onto
 * it and rides its head, stepping into a small station level with each
 * section's heading. Each sheet draws its own stretch, so the thread tips with
 * its sheet; a receding sheet's stretch fades as the next one covers it, so
 * the seams never jog.
 *
 * Straight runs are a strip slid inside a clipping box (the head fades out
 * over 64px) and the two short curves are small SVGs drawn by dash, so
 * drawing costs no repaint of anything large. Without motion the thread is
 * drawn whole and the group stays on the map. Decorative and aria-hidden.
 */
export function initThread(root: HTMLElement): { scene: Scene; stop: () => void } | null {
  const sheets = [...root.querySelectorAll<HTMLElement>("[data-hd-sheet]")];
  const mapSheet = sheets.find((sheet) => sheet.querySelector("[data-hd-map-stage]"));
  const hireSheet = sheets.find((sheet) => sheet.querySelector("[data-hd-hire]"));
  if (!mapSheet || !hireSheet) return null;
  const run = sheets.slice(sheets.indexOf(mapSheet), sheets.indexOf(hireSheet) + 1);
  const mapWalk = mapSheet.querySelector<SVGGElement>("[data-hd-walk]");
  const wide = window.matchMedia(WIDE);
  let segments: Segment[] = [];

  const clear = () => {
    for (const segment of segments) segment.box.remove();
    segments = [];
  };

  const runPiece = (box: HTMLElement, x: number, from: number, to: number): Piece => {
    const height = Math.max(0, to - from);
    const el = document.createElement("span");
    el.className = "hd-thread__run";
    el.style.cssText = `left:${x - 0.75}px;top:${from}px;height:${height}px`;
    const ink = document.createElement("span");
    ink.className = "hd-thread__ink";
    ink.style.height = `${height + FADE}px`;
    el.appendChild(ink);
    box.appendChild(el);
    return { kind: "run", el, ink, length: height, from, to, x };
  };

  /** A curve in its own small SVG; `d` is in sheet coordinates. */
  const curvePiece = (box: HTMLElement, d: string, bounds: { x: number; y: number; w: number; h: number }, from: number, to: number): Piece => {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "hd-thread__curve");
    svg.setAttribute("width", String(bounds.w));
    svg.setAttribute("height", String(bounds.h));
    svg.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`);
    svg.style.cssText = `left:${bounds.x}px;top:${bounds.y}px`;
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
    box.appendChild(svg);
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length} ${length}`;
    return { kind: "curve", el: path, length, from, to, x: 0 };
  };

  const station = (box: HTMLElement, x: number, y: number): Station => {
    const el = document.createElement("span");
    el.className = "hd-thread__station";
    el.style.cssText = `left:${x}px;top:${Math.round(y)}px`;
    box.appendChild(el);
    return { el, y: Math.round(y) };
  };

  /** The group that rides the head: the map's walking group, smaller. */
  const walker = (box: HTMLElement) => {
    const el = document.createElement("span");
    el.className = "hd-thread__walk";
    el.innerHTML =
      '<svg viewBox="-20 -14 40 28" width="34" height="24"><circle class="hd-walk__mentor" cx="-12" cy="2" r="5"/><circle class="hd-walk__mentor" cx="12" cy="-3" r="5"/><circle class="hd-walk__dot" cx="-4" cy="-5" r="3.6"/><circle class="hd-walk__dot" cx="4" cy="5" r="3.6"/><circle class="hd-walk__dot" cx="-4" cy="6" r="3.6"/><circle class="hd-walk__dot" cx="4" cy="-5" r="3.6"/></svg>';
    box.appendChild(el);
    return el;
  };

  const build = () => {
    clear();
    if (!wide.matches || root.querySelector(".hd-map--empty")) return;
    for (const sheet of run) {
      const width = sheet.offsetWidth;
      const height = sheet.offsetHeight;
      // Just outside the content (max-w 80rem with 2rem padding): close enough to belong to it.
      const x = Math.round(width / 2 + 608 + Math.min(48, Math.max(20, window.innerWidth * 0.025)));
      // Below the sheet's rounded corner, so the line never leaves the sheet.
      const top = Math.ceil(Number.parseFloat(getComputedStyle(sheet).borderTopRightRadius) || 0);
      const heading = sheet.querySelector<HTMLElement>("h2");
      const box = document.createElement("div");
      box.className = `hd-thread${sheet === hireSheet ? " hd-thread--on-peach" : ""}`;
      box.setAttribute("aria-hidden", "true");
      // In the document first: curve lengths are measured as they are built.
      sheet.insertBefore(box, sheet.firstChild);
      const pieces: Piece[] = [];
      const stations: Station[] = [];
      let from = top;
      let to = height;
      let knot: HTMLElement | null = null;

      if (sheet === mapSheet) {
        const start = tailEnd(sheet);
        if (!start) {
          box.remove();
          continue;
        }
        // Out of the map to the margin, then straight down.
        const bend = start.y + 90;
        const d = `M${start.x} ${start.y} C${x} ${start.y} ${x} ${start.y} ${x} ${bend}`;
        from = start.y;
        pieces.push(curvePiece(box, d, { x: start.x - 4, y: start.y - 4, w: x - start.x + 8, h: bend - start.y + 8 }, start.y, bend));
        pieces.push(runPiece(box, x, bend, height));
      } else if (sheet === hireSheet) {
        const card = sheet.querySelector<HTMLElement>(".hd-hcard--primary");
        knot = card?.querySelector<HTMLElement>("[data-hd-knot]") ?? null;
        if (!card || !knot) {
          box.remove();
          continue;
        }
        // The knot sits on the card's top edge, 64px from its right; the card is turned -2deg.
        const along = card.offsetWidth / 2 - 64;
        const knotX = Math.round(offsetLeftWithin(card, sheet) + card.offsetWidth - 64);
        const knotY = Math.round(offsetWithin(card, sheet) - along * Math.sin((2 * Math.PI) / 180));
        to = knotY;
        pieces.push(runPiece(box, x, top, knotY - 70));
        const d = `M${x} ${knotY - 70} C${x} ${knotY} ${x} ${knotY} ${knotX} ${knotY}`;
        pieces.push(curvePiece(box, d, { x: knotX - 4, y: knotY - 74, w: x - knotX + 8, h: 78 }, knotY - 70, knotY));
      } else {
        pieces.push(runPiece(box, x, top, height));
      }
      if (heading && sheet !== mapSheet) {
        const y = offsetWithin(heading, sheet) + heading.offsetHeight / 2;
        if (y > from && y < to) stations.push(station(box, x, y));
      }
      const walk = walker(box);
      const index = sheets.indexOf(sheet);
      segments.push({ sheet, next: sheets[index + 1] ?? null, box, pieces, stations, walk, from, to, knot });
    }
  };

  const observer = new ResizeObserver(() => build());
  observer.observe(root);
  wide.addEventListener("change", build);
  void document.fonts.ready.then(build);
  build();

  const state = new Map<Segment, { head: number; cover: number }>();
  const written = new WeakMap<Element, Record<string, string>>();
  /** Write a style value only when it changes (unchanged writes still invalidate style). */
  const put = (el: HTMLElement | SVGElement, prop: "transform" | "opacity" | "strokeDashoffset" | "willChange", value: string) => {
    const cache = written.get(el) ?? {};
    if (cache[prop] === value) return;
    cache[prop] = value;
    written.set(el, cache);
    el.style[prop] = value;
  };
  const toggle = (el: Element, name: string, on: boolean) => {
    if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
  };

  /** Draws one piece as far as the head; returns where the head is, if it is on this piece. */
  const draw = (piece: Piece, head: number): { x: number; y: number } | null => {
    const drawn = clamp01((head - piece.from) / Math.max(1, piece.to - piece.from));
    const active = drawn > 0 && drawn < 1;
    if (piece.kind === "run" && piece.ink) {
      put(piece.ink, "transform", `translateY(${((drawn - 1) * (piece.length + FADE)).toFixed(1)}px)`);
      put(piece.ink, "willChange", active ? "transform" : "");
      return active ? { x: piece.x, y: piece.from + drawn * piece.length - FADE * 0.35 } : null;
    }
    const path = piece.el as SVGPathElement;
    put(path, "strokeDashoffset", ((1 - drawn) * piece.length).toFixed(1));
    if (!active) return null;
    const point = path.getPointAtLength(drawn * piece.length);
    return { x: point.x, y: point.y };
  };

  const scene: Scene = {
    read() {
      const vh = window.innerHeight;
      const nav = navHeight();
      // The head follows the same reading line as the phone trunk.
      const line = Math.max(vh * 0.62, nav);
      const stick = vh - Math.round(vh * LEAD);
      for (const segment of segments) {
        const head = line - segment.sheet.getBoundingClientRect().top;
        const nextTop = segment.next ? segment.next.getBoundingClientRect().top : vh;
        state.set(segment, { head, cover: clamp01((stick - nextTop) / Math.max(1, stick - nav)) });
      }
    },
    write() {
      for (const segment of segments) {
        toggle(segment.box, "is-live", true);
        const { head, cover } = state.get(segment) ?? { head: 0, cover: 0 };
        // As the next sheet covers this one and it tips back, its stretch fades out.
        put(segment.box, "opacity", (1 - clamp01(cover * 4)).toFixed(3));
        let at: { x: number; y: number } | null = null;
        for (const piece of segment.pieces) at = draw(piece, head) ?? at;
        const atStation = at !== null && segment.stations.some((s) => Math.abs(s.y - at!.y) < AT_STATION);
        for (const s of segment.stations) toggle(s.el, "is-on", head >= s.y - 2);
        const showWalk = at !== null && !atStation && cover < 0.25;
        if (showWalk && at) put(segment.walk, "transform", `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`);
        toggle(segment.walk, "is-on", showWalk);
        if (segment.knot) toggle(segment.knot, "is-tied", head >= segment.to - 1);
      }
      // The map's own group steps off the map once the thread has it.
      const mapSegment = segments.find((segment) => segment.sheet === mapSheet);
      const off = mapSegment ? (state.get(mapSegment)?.head ?? 0) > mapSegment.from + 12 : false;
      if (mapWalk) toggle(mapWalk, "is-gone", off);
    },
    destroy() {
      if (mapWalk) mapWalk.classList.remove("is-gone");
      for (const segment of segments) {
        segment.box.classList.remove("is-live");
        segment.box.style.opacity = "";
        segment.walk.classList.remove("is-on");
        if (segment.knot) segment.knot.classList.remove("is-tied");
        for (const piece of segment.pieces) {
          if (piece.ink) {
            piece.ink.style.transform = "";
            piece.ink.style.willChange = "";
          } else piece.el.style.strokeDashoffset = "";
        }
        for (const s of segment.stations) s.el.classList.remove("is-on");
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
