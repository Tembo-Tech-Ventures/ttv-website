import { drawnAt, pathFractions, walkerAt, type Point } from "@/lib/homepage/skills-map";
import { clamp01, navHeight, type Scene } from "./scenes";

const FINE_POINTER = "(hover: hover) and (pointer: fine)";

type State = "lit" | "reachable" | "later";

interface Pill {
  el: HTMLElement;
  key: string;
  /** Path fraction at which the walk reaches it (radial map only). */
  at: number | null;
  near: string[];
  inner: boolean;
  station: boolean;
  state: State;
  /** The finished picture's state, from the server. */
  final: State;
}

function stateOf(el: HTMLElement): State {
  if (el.classList.contains("is-lit")) return "lit";
  return el.classList.contains("is-reachable") ? "reachable" : "later";
}

function readPills(scope: Element): Pill[] {
  return [...scope.querySelectorAll<HTMLElement>("[data-hd-skill]")].map((el) => {
    const state = stateOf(el);
    return {
      el,
      key: el.dataset.hdSkill ?? "",
      at: el.dataset.at ? Number(el.dataset.at) : null,
      near: (el.dataset.near ?? "").split(" ").filter(Boolean),
      inner: el.classList.contains("hd-sk--ring0"),
      station: el.hasAttribute("data-station"),
      state,
      final: state,
    };
  });
}

function setState(pill: Pill, state: State) {
  if (pill.state === state) return;
  pill.el.classList.replace(`is-${pill.state}`, `is-${state}`);
  pill.state = state;
}

/** 42's states as far as the walk has got: walked skills lit, their neighbours (and the inner ring) reachable. */
function applyWalk(pills: Pill[], visited: Set<string>) {
  for (const pill of pills) {
    if (visited.has(pill.key)) setState(pill, "lit");
    else if (pill.inner || pill.near.some((key) => visited.has(key))) setState(pill, "reachable");
    else setState(pill, "later");
  }
}

/**
 * The nodes' details, with or without motion. Each skill becomes a button
 * (only now that JS can honour it) whose name says how many published
 * profiles list it; pointing at it (fine pointers), focusing it or tapping it
 * shows the same in a tip and lights its links and neighbours. Each list is
 * one Tab stop; arrow keys move along it.
 */
export function initSkillsMap(root: HTMLElement): () => void {
  const map = root.querySelector<HTMLElement>("[data-hd-map]");
  if (!map) return () => {};
  const fine = window.matchMedia(FINE_POINTER);
  const cleanups: Array<() => void> = [];
  let pinned: HTMLElement | null = null;
  /** Clears whichever list holds the pinned node. */
  let unpin: (() => void) | null = null;

  for (const list of map.querySelectorAll<HTMLElement>("[data-hd-skills]")) {
    const stage = list.closest<HTMLElement>("[data-hd-map-stage]");
    const step = list.closest<HTMLElement>("[data-hd-step]");
    // The radial map has a floating tip; a phone band shows the details in a line under it.
    const box = stage ?? step;
    const tip = stage ? stage.querySelector<HTMLElement>(":scope > [data-hd-tip]") : step?.querySelector<HTMLElement>("[data-hd-detail]");
    const pills = [...list.querySelectorAll<HTMLElement>("[data-hd-skill]")];
    if (!box || !tip || pills.length === 0) continue;
    const label = tip.querySelector<HTMLElement>("[data-hd-tip-label]")!;
    const detail = tip.querySelector<HTMLElement>("[data-hd-tip-detail]")!;
    const lines = [...box.querySelectorAll<SVGElement>("line[data-a]")];
    const others = stage ? [...stage.querySelectorAll<HTMLElement>("[data-hd-skill]")] : [];
    // The tip may not cover other skills, the hub (the cohort) or the walking group.
    const fixed = stage ? [...stage.querySelectorAll<SVGGraphicsElement>("[data-hd-walk], .hd-map__hub")] : [];
    let current = 0;

    const clear = () => {
      box.classList.remove("has-active");
      for (const pill of box.querySelectorAll(".is-active, .is-near")) pill.classList.remove("is-active", "is-near");
      for (const line of lines) line.classList.remove("is-lit");
      tip.hidden = true;
      box.querySelector("[data-hd-leader]")?.classList.remove("is-shown");
    };

    const leader = stage?.querySelector<SVGSVGElement>("[data-hd-leader]") ?? null;
    const leaderLine = leader?.querySelector<SVGLineElement>("line") ?? null;

    /**
     * Where the tip goes, in the stage's px: beside the node away from the
     * centre, above, below, on the inner side, then the four diagonals (and
     * the same eight a little further out). The first spot that touches no
     * other skill, the hub or the walking group wins. If all of them do, the
     * tip docks at a clear spot on the map's edge (whose leader crosses no
     * label, if any does not), with a thin leader line to its node. A spot that
     * covers anything is never used.
     */
    const place = (pill: HTMLElement) => {
      if (!stage) return;
      const node = pill.closest<HTMLElement>("[data-hd-node]")!;
      const frame = stage.getBoundingClientRect();
      const W = frame.width;
      const H = frame.height;
      const cx = (Number.parseFloat(node.style.left) / 100) * W;
      const cy = (Number.parseFloat(node.style.top) / 100) * H;
      const out = node.dataset.side === "right" ? 1 : -1;
      const half = pill.offsetWidth / 2;
      const ph = pill.offsetHeight / 2;
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      // Two rings of eight spots: close to the node first, then a little further out.
      const spots = [10, 34].flatMap((g) => {
        const side = (dir: number) => (dir > 0 ? cx + half + g + 2 : cx - half - g - 2 - tw);
        const above = cy - ph - g - th;
        const below = cy + ph + g;
        return [
          { x: side(out), y: cy - th / 2 },
          { x: cx - tw / 2, y: above },
          { x: cx - tw / 2, y: below },
          { x: side(-out), y: cy - th / 2 },
          { x: out > 0 ? cx : cx - tw, y: above },
          { x: out > 0 ? cx : cx - tw, y: below },
          { x: out > 0 ? cx - tw : cx, y: above },
          { x: out > 0 ? cx - tw : cx, y: below },
        ];
      });
      const blockers = [...others.filter((other) => other !== pill), ...fixed].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left - frame.left - 4, y: r.top - frame.top - 4, w: r.width + 8, h: r.height + 8 };
      });
      const self = { x: cx - half - 4, y: cy - ph - 4, w: half * 2 + 8, h: ph * 2 + 8 };
      const hits = (spot: { x: number; y: number }, also: Array<typeof self> = []) =>
        [...blockers, ...also].some((b) => spot.x < b.x + b.w && spot.x + tw > b.x && spot.y < b.y + b.h && spot.y + th > b.y);
      const inside = (spot: { x: number; y: number }) => spot.x >= -24 && spot.x + tw <= W + 24 && spot.y >= -24;
      let spot = spots.find((candidate) => inside(candidate) && !hits(candidate));
      let docked = false;
      if (!spot) {
        const clampX = (x: number) => Math.max(8, Math.min(W - tw - 8, x));
        const clampY = (y: number) => Math.max(8, Math.min(H - th - 8, y));
        // The map's corners, its edges in line with the node, and just under the map.
        const corners = [
          { x: 8, y: 8 },
          { x: W - tw - 8, y: 8 },
          { x: 8, y: H - th - 8 },
          { x: W - tw - 8, y: H - th - 8 },
          { x: clampX(cx - tw / 2), y: H - th - 8 },
          { x: clampX(cx - tw / 2), y: 8 },
          { x: out > 0 ? W - tw - 8 : 8, y: clampY(cy - th / 2) },
          { x: clampX(cx - tw / 2), y: H + 12 },
        ]
          .filter((corner) => !hits(corner, [self]))
          // A leader that crosses no label first, then the nearest.
          .map((corner) => {
            // The leader runs to the tip's nearest point, as drawn below.
            const tx = Math.min(Math.max(cx, corner.x), corner.x + tw);
            const ty = Math.min(Math.max(cy, corner.y), corner.y + th);
            return { corner, crosses: blockers.filter((b) => crossesBox(cx, cy, tx, ty, b)).length };
          })
          .toSorted((p, q) => p.crosses - q.crosses || Math.hypot(p.corner.x - cx, p.corner.y - cy) - Math.hypot(q.corner.x - cx, q.corner.y - cy))
          .map(({ corner }) => corner);
        spot = corners[0] ?? { x: Math.max(0, Math.min(W - tw, cx - tw / 2)), y: H + 12 };
        docked = true;
      }
      tip.style.left = `${spot.x.toFixed(1)}px`;
      tip.style.top = `${spot.y.toFixed(1)}px`;
      tip.style.translate = "0 0";
      if (leader && leaderLine) {
        leader.classList.toggle("is-shown", docked);
        if (docked) {
          leader.setAttribute("viewBox", `0 0 ${W.toFixed(0)} ${H.toFixed(0)}`);
          // From the node's edge to the nearest point of the docked tip.
          const tx = Math.min(Math.max(cx, spot.x), spot.x + tw);
          const ty = Math.min(Math.max(cy, spot.y), spot.y + th);
          const angle = Math.atan2(ty - cy, tx - cx);
          leaderLine.setAttribute("x1", (cx + Math.cos(angle) * (half + 2) * 0.9).toFixed(1));
          leaderLine.setAttribute("y1", (cy + Math.sin(angle) * (ph + 2)).toFixed(1));
          leaderLine.setAttribute("x2", tx.toFixed(1));
          leaderLine.setAttribute("y2", ty.toFixed(1));
        }
      }
    };

    const show = (pill: HTMLElement) => {
      clear();
      const key = pill.dataset.hdSkill ?? "";
      const near = new Set((pill.dataset.near ?? "").split(" "));
      box.classList.add("has-active");
      pill.classList.add("is-active");
      for (const other of box.querySelectorAll<HTMLElement>("[data-hd-skill]")) if (near.has(other.dataset.hdSkill ?? "")) other.classList.add("is-near");
      for (const line of lines) if (line.dataset.a === key || line.dataset.b === key) line.classList.add("is-lit");
      label.textContent = pill.textContent?.trim() ?? "";
      detail.textContent = pill.dataset.detail ?? "";
      tip.hidden = false;
      if (stage) place(pill);
    };

    const hide = (pill: HTMLElement) => {
      if (pinned === pill) return;
      if (pill.classList.contains("is-active")) clear();
    };

    const focusAt = (index: number) => {
      current = (index + pills.length) % pills.length;
      pills.forEach((pill, i) => {
        pill.tabIndex = i === current ? 0 : -1;
      });
      pills[current].focus();
    };

    const onEnter = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && fine.matches && !pinned) show(event.currentTarget as HTMLElement);
    };
    const onLeave = (event: PointerEvent) => {
      if (event.pointerType === "mouse") hide(event.currentTarget as HTMLElement);
    };
    const onFocus = (event: FocusEvent) => {
      const pill = event.currentTarget as HTMLElement;
      current = pills.indexOf(pill);
      if (pinned && pinned !== pill) pinned = null;
      show(pill);
    };
    const onBlur = (event: FocusEvent) => hide(event.currentTarget as HTMLElement);
    const onClick = (event: MouseEvent) => {
      const pill = event.currentTarget as HTMLElement;
      if (pinned === pill) {
        pinned = null;
        clear();
        return;
      }
      pinned = pill;
      unpin = clear;
      show(pill);
    };
    const onKey = (event: KeyboardEvent) => {
      const moves: Record<string, number> = {
        ArrowRight: current + 1,
        ArrowDown: current + 1,
        ArrowLeft: current - 1,
        ArrowUp: current - 1,
        Home: 0,
        End: pills.length - 1,
      };
      if (event.key === "Escape") {
        pinned = null;
        clear();
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        (event.currentTarget as HTMLElement).click();
        return;
      }
      if (!(event.key in moves)) return;
      event.preventDefault();
      focusAt(moves[event.key]);
    };

    pills.forEach((pill, index) => {
      pill.setAttribute("role", "button");
      pill.tabIndex = index === 0 ? 0 : -1;
      pill.setAttribute("aria-label", `${pill.textContent?.trim()}, ${(pill.dataset.detail ?? "").toLowerCase()}`);
      pill.addEventListener("pointerenter", onEnter);
      pill.addEventListener("pointerleave", onLeave);
      pill.addEventListener("focus", onFocus);
      pill.addEventListener("blur", onBlur);
      pill.addEventListener("click", onClick);
      pill.addEventListener("keydown", onKey);
    });

    cleanups.push(() => {
      clear();
      for (const pill of pills) {
        pill.removeAttribute("role");
        pill.removeAttribute("tabindex");
        pill.removeAttribute("aria-label");
        pill.removeEventListener("pointerenter", onEnter);
        pill.removeEventListener("pointerleave", onLeave);
        pill.removeEventListener("focus", onFocus);
        pill.removeEventListener("blur", onBlur);
        pill.removeEventListener("click", onClick);
        pill.removeEventListener("keydown", onKey);
      }
    });
  }

  // A tap anywhere else lets go of a pinned node.
  const onOutside = (event: PointerEvent) => {
    if (!pinned || pinned.contains(event.target as Node)) return;
    pinned = null;
    unpin?.();
    unpin = null;
  };
  document.addEventListener("pointerdown", onOutside);
  map.classList.add("hd-map--live");

  // "+N more" reveals the rest of a phone band's ring (shown whole without JS).
  const toggles = [...map.querySelectorAll<HTMLButtonElement>("[data-hd-more]")];
  const onToggle = (event: Event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const rest = document.getElementById(button.getAttribute("aria-controls") ?? "");
    if (!rest) return;
    const open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    button.textContent = open ? "Show fewer" : (button.dataset.closed ?? button.textContent);
    rest.hidden = !open;
  };
  for (const button of toggles) {
    const rest = document.getElementById(button.getAttribute("aria-controls") ?? "");
    if (rest) rest.hidden = true;
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", onToggle);
  }
  // The hub's halo only animates while the map is on screen.
  const onscreen = new IntersectionObserver(([entry]) => map.classList.toggle("hd-map--onscreen", entry.isIntersecting));
  onscreen.observe(map);

  return () => {
    for (const button of toggles) button.removeEventListener("click", onToggle);
    onscreen.disconnect();
    document.removeEventListener("pointerdown", onOutside);
    map.classList.remove("hd-map--live", "hd-map--onscreen");
    for (const cleanup of cleanups) cleanup();
  };
}

/** Whether the segment (x1,y1)-(x2,y2) passes through a box (sampled finely enough for labels). */
function crossesBox(x1: number, y1: number, x2: number, y2: number, b: { x: number; y: number; w: number; h: number }): boolean {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 4);
  for (let i = 1; i < steps; i += 1) {
    const x = x1 + ((x2 - x1) * i) / steps;
    const y = y1 + ((y2 - y1) * i) / steps;
    if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return true;
  }
  return false;
}

/** Layout offset of `el` inside `ancestor`, ignoring transforms (sheets tip and scale). */
function offsetWithin(el: HTMLElement, ancestor: HTMLElement): number {
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== ancestor) {
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return y;
}

function parsePoints(value: string | null): Point[] {
  return (value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x, y };
    });
}

/**
 * The walk, scroll-linked (motion only).
 *
 * Wide screens and tablets play it as the map's sheet arrives: from the map
 * being a fifth on screen to it sitting under the nav, the peach path draws
 * outward through the skills, the small group of builders walks its head,
 * the engineers join during the second step, and in the third the path
 * leaves the cohort's ring. The steps light in time with it.
 *
 * Phones read it down the page: a reading line at 62% of the screen lights
 * the trunk, its stations fill as it passes, and the walking group steps
 * into each step's mark (hidden there, the mark pulses) rather than sitting
 * on it.
 */
export function mapScene(root: HTMLElement): Scene | null {
  const map = root.querySelector<HTMLElement>("[data-hd-map]");
  const way = map?.querySelector<HTMLElement>("[data-hd-way]");
  if (!map || !way) return null;
  const stage = map.querySelector<HTMLElement>("[data-hd-map-stage]")!;
  const lit = stage.querySelector<SVGPolylineElement>("[data-hd-lit]");
  const tail = stage.querySelector<SVGLineElement>("[data-hd-tail]");
  const walk = stage.querySelector<SVGGElement>("[data-hd-walk]");
  const steps = [...way.querySelectorAll<HTMLElement>("[data-hd-step]")];
  const marks = steps.map((step) => step.querySelector<HTMLElement>("[data-hd-mark]")!);
  const wayLit = way.querySelector<HTMLElement>("[data-hd-way-lit]");
  const wayWalk = way.querySelector<HTMLElement>("[data-hd-way-walk]");
  const radialPills = readPills(stage);
  const columnPills = readPills(way);
  const stations = [...way.querySelectorAll<SVGCircleElement>("circle[data-station]")];
  const stationPills = columnPills.filter((pill) => pill.station);

  const points = [...parsePoints(lit?.getAttribute("points") ?? null)];
  if (tail) points.push({ x: Number(tail.getAttribute("x2")), y: Number(tail.getAttribute("y2")) });
  const fractions = pathFractions(points);
  const hub = stage.querySelector<SVGCircleElement>(".hd-map__hub");
  const centre = { ...(points[0] ?? { x: 0, y: 0 }), r: Number(hub?.getAttribute("r") ?? 0) };
  const lastSkill = fractions.at(-2) ?? 0;
  const walked = radialPills.filter((pill) => pill.at !== null).toSorted((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const atOf = (ring: string) => walked.findLast((pill) => pill.el.classList.contains(ring))?.at ?? null;
  const w1 = atOf("hd-sk--ring0") ?? fractions[1] ?? 1 / 3;
  const w2 = Math.max(w1, atOf("hd-sk--ring1") ?? (w1 + 1) / 2);
  const waypoints: [number, number, number] = [w1, w2, 1];

  let radial = true;
  let vh = window.innerHeight;
  let markOffsets: number[] = [];
  let stationOffsets: number[] = [];
  let wayHeight = 0;
  let stageHeight = 0;
  let stage3 = 0;
  let litY = 0;
  let lastWrite = "";
  const arrived = marks.map(() => false);

  return {
    measure() {
      vh = window.innerHeight;
      radial = stage.offsetWidth > 0;
      markOffsets = marks.map((mark) => offsetWithin(mark, way) + mark.offsetHeight / 2);
      stationOffsets = stationPills.map((pill) => offsetWithin(pill.el, way) + pill.el.offsetHeight / 2);
      wayHeight = way.offsetHeight;
      stageHeight = stage.offsetHeight;
      map.classList.add("hd-map--walking");
      lastWrite = "";
    },
    read() {
      const line = vh * 0.62;
      const wayTop = way.getBoundingClientRect().top;
      litY = Math.min(wayHeight, Math.max(0, line - wayTop));
      if (radial) {
        const top = stage.getBoundingClientRect().top;
        const start = vh - stageHeight * 0.2;
        const end = Math.max(navHeight() + 24, (vh - stageHeight) / 2 - vh * 0.08);
        stage3 = 3 * clamp01((start - top) / Math.max(1, start - end));
      } else {
        stage3 = markOffsets.reduce((sum, offset) => sum + clamp01((line - (wayTop + offset)) / (vh * 0.3)), 0);
      }
    },
    write() {
      const s = stage3;
      const key = `${s.toFixed(3)}|${Math.round(litY)}|${radial}`;
      if (key === lastWrite) return;
      lastWrite = key;

      steps.forEach((step, index) => {
        const reached = s > index + 0.02;
        step.classList.toggle("is-reached", reached);
        step.classList.toggle("is-ahead", !reached);
      });

      if (radial) {
        const drawn = drawnAt(s, waypoints);
        const main = lastSkill > 0 ? clamp01(drawn / lastSkill) : 1;
        const beyond = lastSkill < 1 ? clamp01((drawn - lastSkill) / (1 - lastSkill)) : 0;
        if (lit) lit.style.strokeDashoffset = (1 - main).toFixed(4);
        if (tail) tail.style.strokeDashoffset = (1 - beyond).toFixed(4);
        if (walk) {
          const head = walkerAt(points, fractions, drawn, centre);
          walk.setAttribute("transform", `translate(${head.x.toFixed(1)} ${head.y.toFixed(1)})`);
          walk.classList.toggle("is-joined", s >= 1.3);
          walk.classList.toggle("is-home", s >= 2.85);
        }
        applyWalk(radialPills, new Set(walked.filter((pill) => (pill.at ?? 2) <= drawn + 0.002).map((pill) => pill.key)));
        // The trunk beside the steps lights in step with the map.
        if (wayLit) wayLit.style.transform = `scaleY(${(s / 3).toFixed(4)})`;
        return;
      }

      if (wayLit) wayLit.style.transform = `scaleY(${(wayHeight > 0 ? litY / wayHeight : 1).toFixed(4)})`;
      if (wayWalk) {
        wayWalk.style.transform = `translateY(${Math.max(16, litY).toFixed(1)}px)`;
        wayWalk.classList.toggle("is-joined", s >= 1.3);
        // Into the mark (or past a station), not on top of it.
        const atMark = markOffsets.findIndex((offset) => Math.abs(offset - litY) < 30);
        const atStation = stationOffsets.some((offset) => Math.abs(offset - litY) < 18);
        wayWalk.classList.toggle("is-hidden", atMark >= 0 || atStation);
        marks.forEach((mark, index) => {
          const here = index === atMark;
          if (here && !arrived[index]) mark.classList.add("is-arrived");
          if (!here && Math.abs(markOffsets[index] - litY) > 60) mark.classList.remove("is-arrived");
          arrived[index] = here || (arrived[index] && Math.abs(markOffsets[index] - litY) <= 60);
        });
      }
      const visited = new Set(stationPills.filter((_, index) => stationOffsets[index] <= litY).map((pill) => pill.key));
      // Lit skills in a row light with their station.
      for (const pill of columnPills) if (pill.final === "lit" && !pill.station) {
        const band = pill.el.closest("[data-hd-band]");
        const own = stationPills.find((station) => station.el.closest("[data-hd-band]") === band);
        if (own && visited.has(own.key)) visited.add(pill.key);
      }
      applyWalk(columnPills, visited);
      for (const circle of stations) circle.classList.toggle("is-lit", visited.has(circle.dataset.station ?? ""));
    },
    destroy() {
      map.classList.remove("hd-map--walking");
      for (const step of steps) {
        step.classList.add("is-reached");
        step.classList.remove("is-ahead");
      }
      for (const mark of marks) mark.classList.remove("is-arrived");
      if (lit) lit.style.strokeDashoffset = "";
      if (tail) tail.style.strokeDashoffset = "";
      if (walk) {
        const end = walkerAt(points, fractions, 1, centre);
        walk.setAttribute("transform", `translate(${end.x.toFixed(1)} ${end.y.toFixed(1)})`);
        walk.classList.add("is-joined", "is-home");
      }
      for (const pill of [...radialPills, ...columnPills]) setState(pill, pill.final);
      for (const circle of stations) circle.classList.add("is-lit");
      if (wayLit) wayLit.style.transform = "";
      if (wayWalk) {
        wayWalk.style.transform = "";
        wayWalk.classList.remove("is-hidden");
      }
    },
  };
}
