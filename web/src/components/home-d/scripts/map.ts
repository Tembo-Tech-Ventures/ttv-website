import { drawnAt, pathFractions, walkerAt, type Point } from "@/lib/homepage/skills-map";
import { clamp01, navHeight, type Scene } from "./scenes";

const FINE_POINTER = "(hover: hover) and (pointer: fine)";

type State = "done" | "reachable" | "later";

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
  if (el.classList.contains("is-done")) return "done";
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

/** 42's states as far as the walk has got: walked skills done, their neighbours (and the inner ring) reachable. */
function applyWalk(pills: Pill[], visited: Set<string>) {
  for (const pill of pills) {
    if (visited.has(pill.key)) setState(pill, "done");
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
    const box = list.parentElement!;
    const tip = box.querySelector<HTMLElement>(":scope > [data-hd-tip]");
    const pills = [...list.querySelectorAll<HTMLElement>("[data-hd-skill]")];
    if (!tip || pills.length === 0) continue;
    const label = tip.querySelector<HTMLElement>("[data-hd-tip-label]")!;
    const detail = tip.querySelector<HTMLElement>("[data-hd-tip-detail]")!;
    const lines = [...box.querySelectorAll<SVGElement>("line[data-a]")];
    const radial = box.hasAttribute("data-hd-map-stage");
    let current = 0;

    const clear = () => {
      box.classList.remove("has-active");
      for (const pill of pills) pill.classList.remove("is-active", "is-near");
      for (const line of lines) line.classList.remove("is-lit");
      tip.hidden = true;
    };

    const show = (pill: HTMLElement) => {
      clear();
      const key = pill.dataset.hdSkill ?? "";
      const near = new Set((pill.dataset.near ?? "").split(" "));
      box.classList.add("has-active");
      pill.classList.add("is-active");
      for (const other of pills) if (near.has(other.dataset.hdSkill ?? "")) other.classList.add("is-near");
      for (const line of lines) if (line.dataset.a === key || line.dataset.b === key) line.classList.add("is-lit");
      label.textContent = pill.textContent?.trim() ?? "";
      detail.textContent = pill.dataset.detail ?? "";
      // Radial nodes are centred on their point; phone rows start at theirs.
      const node = pill.closest<HTMLElement>("[data-hd-node]")!;
      const along = radial ? 0 : (pill.parentElement as HTMLElement).offsetLeft;
      tip.style.left = along ? `calc(${node.style.left} + ${along}px)` : node.style.left;
      tip.style.top = node.style.top;
      tip.classList.toggle("is-below", Number.parseFloat(node.style.top) < (radial ? 22 : 40));
      tip.hidden = false;
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

  return () => {
    document.removeEventListener("pointerdown", onOutside);
    map.classList.remove("hd-map--live");
    for (const cleanup of cleanups) cleanup();
  };
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
 * The walk, scroll-linked (motion only). A reading line sits at 62% of the
 * screen: each step's mark crossing it starts that step's stage, and the map
 * answers. On the radial map the peach path draws outward through the
 * skills, the small group of builders walks its head, the engineers join
 * during the second step, and in the third the path leaves the cohort's ring.
 * On phones the trunk lights down the page and its stations fill as it
 * passes. Tablets, whose map is above the steps, play the walk as the map
 * crosses the screen.
 */
export function mapScene(root: HTMLElement): Scene | null {
  const map = root.querySelector<HTMLElement>("[data-hd-map]");
  const way = map?.querySelector<HTMLElement>("[data-hd-way]");
  if (!map || !way) return null;
  const figure = map.querySelector<HTMLElement>("[data-hd-map-figure]")!;
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

  let mode: "wide" | "tablet" | "column" = "column";
  let vh = window.innerHeight;
  let markOffsets: number[] = [];
  let stationOffsets: number[] = [];
  let wayHeight = 0;
  let stageHeight = 0;
  let stage3 = 0;
  let litY = 0;
  let lastWrite = "";

  return {
    measure() {
      vh = window.innerHeight;
      mode = stage.offsetWidth === 0 ? "column" : getComputedStyle(figure).position === "sticky" ? "wide" : "tablet";
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
      if (mode === "tablet") {
        const top = stage.getBoundingClientRect().top;
        const start = vh * 0.82;
        const end = Math.max(navHeight() + 16, (vh - stageHeight) / 2);
        stage3 = 3 * clamp01((start - top) / Math.max(1, start - end));
      } else {
        stage3 = markOffsets.reduce((sum, offset) => sum + clamp01((line - (wayTop + offset)) / (vh * 0.3)), 0);
      }
    },
    write() {
      const s = stage3;
      const key = `${s.toFixed(3)}|${Math.round(litY)}|${mode}`;
      if (key === lastWrite) return;
      lastWrite = key;

      steps.forEach((step, index) => {
        const reached = s > index + 0.02;
        step.classList.toggle("is-reached", reached);
        step.classList.toggle("is-ahead", !reached);
      });

      if (mode !== "column") {
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
      }

      if (mode !== "tablet") {
        if (wayLit) wayLit.style.transform = `scaleY(${(wayHeight > 0 ? litY / wayHeight : 1).toFixed(4)})`;
        if (wayWalk) {
          wayWalk.style.transform = `translateY(${Math.max(16, litY).toFixed(1)}px)`;
          wayWalk.classList.toggle("is-joined", s >= 1.3);
        }
      }

      if (mode === "column") {
        const visited = new Set(stationPills.filter((_, index) => stationOffsets[index] <= litY).map((pill) => pill.key));
        applyWalk(columnPills, visited);
        for (const circle of stations) circle.classList.toggle("is-done", visited.has(circle.dataset.station ?? ""));
      }
    },
    destroy() {
      map.classList.remove("hd-map--walking");
      for (const step of steps) {
        step.classList.add("is-reached");
        step.classList.remove("is-ahead");
      }
      if (lit) lit.style.strokeDashoffset = "";
      if (tail) tail.style.strokeDashoffset = "";
      if (walk) {
        const end = walkerAt(points, fractions, 1, centre);
        walk.setAttribute("transform", `translate(${end.x.toFixed(1)} ${end.y.toFixed(1)})`);
        walk.classList.add("is-joined", "is-home");
      }
      for (const pill of [...radialPills, ...columnPills]) setState(pill, pill.final);
      for (const circle of stations) circle.classList.add("is-done");
      if (wayLit) wayLit.style.transform = "";
      if (wayWalk) wayWalk.style.transform = "";
    },
  };
}
