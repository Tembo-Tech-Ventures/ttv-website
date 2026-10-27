/**
 * The skills map (homepage candidate D): a radial picture of how the skills on
 * published builder profiles connect, in the spirit of École 42's "holy graph".
 *
 * It is an illustration, not a feature. TTV does not track anyone's progress
 * through a map, so nothing here models a person: the graph is built only
 * from which skills (and project languages) appear on published profiles, and
 * which appear together on the same profile. A cohort "walking" the map is
 * drawn by the page, from the path chosen here.
 *
 * Everything is deterministic (no randomness, stable tie-breaks) so the server
 * renders the same picture on every request and the client animates exactly
 * what was drawn.
 */

/** The parts of a published profile the map reads. */
export interface SkillProfile {
  skills: readonly string[];
  project: { language: string | null } | null;
}

export interface SkillTag {
  /** Normalised identity, used to merge "Node.js", "nodejs" and "NodeJS". */
  key: string;
  /** The most common spelling on profiles. */
  label: string;
  /** How many published profiles list it, as a skill or project language. */
  count: number;
}

/** 0 is the inner ring (most common skills), 2 the outer ring. */
export type Ring = 0 | 1 | 2;

export interface MapSkill extends SkillTag {
  ring: Ring;
  /** The node one ring in that it hangs from; `null` only on the inner ring. */
  parent: string | null;
  /** Position around its ring, 0 first. */
  order: number;
}

export type LinkKind = "spoke" | "branch" | "shared";

export interface MapLink {
  /** `CENTRE` or a skill key. */
  a: string;
  b: string;
  kind: LinkKind;
  /** Profiles that list both ends (0 for spokes and structural branches). */
  weight: number;
}

export interface SkillsGraph {
  skills: MapSkill[];
  links: MapLink[];
  /** The skills the drawn walk visits, centre outwards. */
  path: string[];
}

export const CENTRE = "~centre";

/** Most skills a ring can hold; the map stays calm and every label fits. */
export const RING_CAPS: readonly [number, number, number] = [5, 7, 9];

/** Longer labels are left off the map rather than cropped. */
export const MAX_LABEL_LENGTH = 24;

/** Common spellings of the same thing, after punctuation is stripped. */
const ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  golang: "go",
  node: "nodejs",
  postgres: "postgresql",
  reactjs: "react",
  py: "python",
};

/**
 * Case-insensitive identity for a skill. Whitespace, dots, hyphens and
 * underscores are ignored ("Node.js" = "nodejs"), symbols that change meaning
 * ("C#", "C++") are kept, and a few common aliases are merged.
 */
export function skillKey(raw: string): string {
  const key = raw
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, "");
  return ALIASES[key] ?? key;
}

/** Collapse internal whitespace so " Data  viz " reads "Data viz". */
function cleanLabel(raw: string): string {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ");
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Each profile's distinct tags (skills plus project language), in listed order. */
export function profileTags(profile: SkillProfile): Array<{ key: string; label: string }> {
  const seen = new Map<string, string>();
  const raws = [...profile.skills, ...(profile.project?.language ? [profile.project.language] : [])];
  for (const raw of raws) {
    const label = cleanLabel(raw);
    const key = skillKey(label);
    if (!key || seen.has(key)) continue;
    seen.set(key, label);
  }
  return [...seen].map(([key, label]) => ({ key, label }));
}

export interface Tally {
  /** Most listed first; ties by first appearance, so the order is stable. */
  tags: SkillTag[];
  /** Profiles listing both tags, by `a|b` (alphabetical keys). */
  pairs: Map<string, number>;
}

/** Counts every tag once per profile and every pair of tags listed together. */
export function tallySkills(profiles: readonly SkillProfile[]): Tally {
  const counts = new Map<string, { count: number; first: number; spellings: Map<string, number> }>();
  const pairs = new Map<string, number>();
  let seq = 0;
  for (const profile of profiles) {
    const tags = profileTags(profile);
    for (const { key, label } of tags) {
      let entry = counts.get(key);
      if (!entry) {
        entry = { count: 0, first: seq, spellings: new Map() };
        counts.set(key, entry);
      }
      seq += 1;
      entry.count += 1;
      entry.spellings.set(label, (entry.spellings.get(label) ?? 0) + 1);
    }
    for (let i = 0; i < tags.length; i += 1) {
      for (let j = i + 1; j < tags.length; j += 1) {
        const key = pairKey(tags[i].key, tags[j].key);
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }
  const tags = [...counts]
    .toSorted(([, a], [, b]) => b.count - a.count || a.first - b.first)
    .map(([key, entry]) => {
      // The spelling most profiles use; the first one seen wins a tie.
      const [label] = [...entry.spellings].reduce((best, next) => (next[1] > best[1] ? next : best));
      return { key, label, count: entry.count };
    });
  return { tags, pairs };
}

/** How many of `n` tags go on each ring: roughly a quarter in, a third in the middle, the rest out. */
export function ringSizes(n: number, caps: readonly [number, number, number] = RING_CAPS): [number, number, number] {
  if (n <= 0) return [0, 0, 0];
  const inner = Math.min(caps[0], Math.max(1, Math.round(n * 0.25)));
  const middle = Math.min(caps[1], n - inner, Math.round(n * 0.35));
  const outer = Math.min(caps[2], n - inner - middle);
  return [inner, middle, outer];
}

/**
 * Builds the map: which skills sit on which ring, what hangs from what, which
 * skills are linked because profiles list them together, and the walk the
 * page draws from the centre outwards.
 */
export function buildSkillsGraph(
  profiles: readonly SkillProfile[],
  caps: readonly [number, number, number] = RING_CAPS,
): SkillsGraph {
  const { tags: all, pairs } = tallySkills(profiles);
  const tags = all.filter((tag) => tag.label.length <= MAX_LABEL_LENGTH);
  const weight = (a: string, b: string) => pairs.get(pairKey(a, b)) ?? 0;
  const sizes = ringSizes(tags.length, caps);

  // Fill the rings from the centre out: the most listed skill first, and on a
  // tie, the one listed most often beside skills already placed, so each ring
  // grows out of the one inside it. Remaining ties keep first appearance.
  const byRing: SkillTag[][] = [[], [], []];
  const pool = [...tags];
  const chosen: SkillTag[] = [];
  sizes.forEach((size, ring) => {
    for (let n = 0; n < size; n += 1) {
      let pick = 0;
      let bestTie = -1;
      pool.forEach((tag, index) => {
        if (tag.count < pool[pick].count) return;
        const tie = chosen.reduce((sum, other) => sum + weight(tag.key, other.key), 0);
        if (tag.count > pool[pick].count || tie > bestTie) {
          pick = index;
          bestTie = tie;
        }
      });
      const [tag] = pool.splice(pick, 1);
      chosen.push(tag);
      byRing[ring].push(tag);
    }
  });

  // Inner ring order: a chain that keeps skills listed together side by side.
  const inner: SkillTag[] = [];
  const rest = [...byRing[0]];
  while (rest.length > 0) {
    const last = inner.at(-1);
    let pick = 0;
    if (last) {
      let best = 0;
      rest.forEach((tag, index) => {
        const w = weight(last.key, tag.key);
        if (w > best) {
          best = w;
          pick = index;
        }
      });
    }
    inner.push(...rest.splice(pick, 1));
  }

  const skills: MapSkill[] = inner.map((tag, order) => ({ ...tag, ring: 0, parent: null, order }));
  const children = new Map<string, number>(skills.map((skill) => [skill.key, 0]));

  // Outer rings hang each skill from the inner node it is most often listed
  // with (one ring in first). A skill listed with nothing further in follows
  // a skill on its own ring it is listed with, so clusters stay together;
  // failing that it hangs from the least busy node one ring in.
  ([1, 2] as const).forEach((ring) => {
    const parents = skills.filter((skill) => skill.ring === ring - 1);
    const fallback = skills.filter((skill) => skill.ring < ring);
    const placed: MapSkill[] = [];
    for (const tag of byRing[ring]) {
      let parent: MapSkill | null = null;
      let best = 0;
      for (const candidates of [parents, fallback]) {
        for (const candidate of candidates) {
          const w = weight(tag.key, candidate.key);
          if (w > best) {
            best = w;
            parent = candidate;
          }
        }
        if (parent) break;
      }
      if (!parent) {
        const sibling = placed.find((other) => weight(tag.key, other.key) > 0);
        parent = sibling ? (skills.find((skill) => skill.key === sibling.parent) ?? null) : null;
      }
      if (!parent && parents.length > 0) {
        parent = parents.reduce((least, candidate) => ((children.get(candidate.key) ?? 0) < (children.get(least.key) ?? 0) ? candidate : least));
      }
      if (!parent) continue;
      children.set(parent.key, (children.get(parent.key) ?? 0) + 1);
      children.set(tag.key, 0);
      placed.push({ ...tag, ring, parent: parent.key, order: 0 });
    }
    // Siblings sit together, in their parent's order around the ring.
    const rank = new Map(skills.map((skill) => [skill.key, skill.order]));
    placed
      .toSorted((a, b) => (rank.get(a.parent!) ?? 0) - (rank.get(b.parent!) ?? 0))
      .forEach((skill, order) => skills.push({ ...skill, order }));
  });

  const links: MapLink[] = [];
  for (const skill of skills) {
    if (skill.ring === 0) links.push({ a: CENTRE, b: skill.key, kind: "spoke", weight: 0 });
    else links.push({ a: skill.parent!, b: skill.key, kind: "branch", weight: weight(skill.parent!, skill.key) });
  }

  // Skills listed together on a profile, beyond the tree: the strongest first,
  // at most two extra links per skill so the picture stays calm.
  const extra = new Map<string, number>();
  const linked = new Set(links.map((link) => pairKey(link.a, link.b)));
  const ringOf = new Map(skills.map((skill) => [skill.key, skill.ring]));
  const candidates: MapLink[] = [];
  for (let i = 0; i < skills.length; i += 1) {
    for (let j = i + 1; j < skills.length; j += 1) {
      const [a, b] = [skills[i], skills[j]];
      const w = weight(a.key, b.key);
      if (w === 0 || linked.has(pairKey(a.key, b.key)) || Math.abs(a.ring - b.ring) > 1) continue;
      candidates.push({ a: a.key, b: b.key, kind: "shared", weight: w });
    }
  }
  for (const link of candidates.toSorted((p, q) => q.weight - p.weight || (ringOf.get(p.a) ?? 0) - (ringOf.get(q.a) ?? 0))) {
    if ((extra.get(link.a) ?? 0) >= 2 || (extra.get(link.b) ?? 0) >= 2) continue;
    extra.set(link.a, (extra.get(link.a) ?? 0) + 1);
    extra.set(link.b, (extra.get(link.b) ?? 0) + 1);
    links.push(link);
  }

  return { skills, links, path: walk(skills, weight) };
}

/**
 * The walk the page draws, centre outwards: two neighbouring skills on the
 * inner ring (one of them the most listed), then a skill on the middle ring
 * hanging from one of them, then one on the outer ring hanging from that.
 * Of all such walks it takes the one that follows the most real links
 * (skills listed together on a profile), so the picture's path runs along
 * the map's own lines; ties go to skills earlier around their rings. The
 * inner pair is ordered so the walk steps outward from the second.
 */
function walk(skills: MapSkill[], weight: (a: string, b: string) => number): string[] {
  const ring = (r: Ring) => skills.filter((skill) => skill.ring === r);
  const [inner, middle, outer] = [ring(0), ring(1), ring(2)];
  if (inner.length === 0) return [];
  const first = inner[0];
  const partners: Array<MapSkill | null> = inner.length > 1 ? inner.slice(1) : [null];
  const middles: Array<MapSkill | null> = middle.length > 0 ? middle : [null];
  const outers: Array<MapSkill | null> = outer.length > 0 ? outer : [null];
  const linked = (a: MapSkill | null, b: MapSkill | null) => (a && b && weight(a.key, b.key) > 0 ? 1 : 0);
  const hangs = (child: MapSkill | null, parent: MapSkill | null) => (child && parent && child.parent === parent.key ? 1 : 0);
  /** The walk through one choice of skills, and how well it follows the map's own lines. */
  const score = (partner: MapSkill | null, mid: MapSkill | null, out: MapSkill | null) => {
    // The middle skill hangs from one of the inner pair; that one goes second.
    const via = mid && hangs(mid, partner) ? partner : first;
    const other = via === first ? partner : first;
    const midFits = mid ? hangs(mid, via) : 1;
    const outFits = !out ? 1 : mid ? hangs(out, mid) : hangs(out, via);
    const value = 3 * linked(first, partner) + 3 * midFits + 2 * linked(via, mid) + 3 * outFits + 2 * linked(mid, out) + (via === partner ? 0.5 : 0);
    return { value, walk: [other, via, mid, out] };
  };

  let best: { value: number; walk: Array<MapSkill | null> } | null = null;
  for (const partner of partners) {
    for (const mid of middles) {
      for (const out of outers) {
        const candidate = score(partner, mid, out);
        if (!best || candidate.value > best.value) best = candidate;
      }
    }
  }
  return (best?.walk ?? []).filter((skill): skill is MapSkill => skill !== null).map((skill) => skill.key);
}

/** Undirected neighbours of every node, the centre included. */
export function adjacency(graph: Pick<SkillsGraph, "links">): Map<string, Set<string>> {
  const near = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!near.has(a)) near.set(a, new Set());
    near.get(a)!.add(b);
  };
  for (const link of graph.links) {
    add(link.a, link.b);
    add(link.b, link.a);
  }
  return near;
}

/**
 * How a node is drawn as the walk passes, after 42's three states but with
 * nothing marked as completed by anyone: skills the drawn path has passed
 * are lit (on the path), skills linked to the centre or to a lit skill are
 * reachable, everything else is for later.
 */
export type NodeState = "lit" | "reachable" | "later";

export function nodeStates(
  keys: readonly string[],
  near: Map<string, Set<string>>,
  visited: ReadonlySet<string>,
): Record<string, NodeState> {
  const states: Record<string, NodeState> = {};
  const from = [CENTRE, ...visited];
  for (const key of keys) {
    if (visited.has(key)) states[key] = "lit";
    else if (from.some((lit) => near.get(lit)?.has(key))) states[key] = "reachable";
    else states[key] = "later";
  }
  return states;
}

/* ------------------------------------------------------------- geometry */

export interface Point {
  x: number;
  y: number;
}

const round = (n: number) => Math.round(n * 10) / 10;
const TAU = Math.PI * 2;
const norm = (angle: number) => ((angle % TAU) + TAU) % TAU;
/** Signed shortest difference b - a, in (-π, π]. */
const delta = (a: number, b: number) => {
  const d = norm(b - a);
  return d > Math.PI ? d - TAU : d;
};

/** Cumulative fraction of the polyline's length at each point. */
export function pathFractions(points: readonly Point[]): number[] {
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const total = lengths.at(-1) ?? 0;
  return lengths.map((length) => (total > 0 ? length / total : 0));
}

/** The point a fraction `t` of the way along a polyline. */
export function pointAlong(points: readonly Point[], fractions: readonly number[], t: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (t <= 0 || points.length === 1) return { ...points[0] };
  if (t >= 1) return { ...points.at(-1)! };
  let i = 1;
  while (i < fractions.length - 1 && fractions[i] < t) i += 1;
  const span = fractions[i] - fractions[i - 1] || 1;
  const k = (t - fractions[i - 1]) / span;
  return {
    x: points[i - 1].x + (points[i].x - points[i - 1].x) * k,
    y: points[i - 1].y + (points[i].y - points[i - 1].y) * k,
  };
}

/**
 * Where the small group walking the path stands when the path's head is at
 * `t`: beside the path rather than on it (so it never sits on a label), and
 * never on the centre.
 */
export function walkerAt(points: readonly Point[], fractions: readonly number[], t: number, centre: Point & { r: number }, beside = 30): Point {
  const head = pointAlong(points, fractions, t);
  if (points.length < 2) return head;
  let i = 1;
  while (i < fractions.length - 1 && fractions[i] < t) i += 1;
  const dx = points[i].x - points[i - 1].x;
  const dy = points[i].y - points[i - 1].y;
  const length = Math.hypot(dx, dy) || 1;
  // To the right of the direction of travel.
  const p = { x: head.x - (dy / length) * beside, y: head.y + (dx / length) * beside };
  const out = Math.hypot(p.x - centre.x, p.y - centre.y);
  const clear = centre.r + beside * 0.6;
  if (out >= clear) return p;
  const ux = out > 0 ? (p.x - centre.x) / out : dx / length;
  const uy = out > 0 ? (p.y - centre.y) / out : dy / length;
  return { x: centre.x + ux * clear, y: centre.y + uy * clear };
}

/**
 * Maps the three waypoint stages (0..3, one per cohort rhythm step) to how
 * much of the path is drawn: stage 1 ends at the first waypoint, stage 2 at
 * the second, stage 3 at the end of the path.
 */
export function drawnAt(stage: number, waypoints: readonly [number, number, number]): number {
  const s = Math.min(3, Math.max(0, stage));
  const stops = [0, ...waypoints];
  const step = Math.min(2, Math.floor(s));
  return stops[step] + (stops[step + 1] - stops[step]) * (s - step);
}

/** How the page sizes skill labels, so layouts can keep them apart. */
export interface LabelMetrics {
  /** Label font size in CSS px. */
  fontPx: number;
  /** Average advance per character, in em (generous, so estimates err wide). */
  charEm: number;
  /** Horizontal and vertical padding inside a pill, CSS px. */
  padX: number;
  padY: number;
  /** Smallest CSS px per viewBox unit the drawing is shown at. */
  minScale: number;
}

export const LABELS: LabelMetrics = { fontPx: 13, charEm: 0.6, padX: 11, padY: 7, minScale: 0.84 };

/** A label pill's size in viewBox units at the smallest scale it is shown at. */
export function pillSize(label: string, metrics: LabelMetrics = LABELS): { w: number; h: number } {
  const w = label.length * metrics.charEm * metrics.fontPx + metrics.padX * 2;
  const h = metrics.fontPx * 1.25 + metrics.padY * 2;
  return { w: round(w / metrics.minScale), h: round(h / metrics.minScale) };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function overlaps(a: Box, b: Box, gap = 0): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w + gap * 2 && Math.abs(a.y - b.y) * 2 < a.h + b.h + gap * 2;
}

/* --------------------------------------------------------------- radial */

export interface Ellipse {
  rx: number;
  ry: number;
}

export interface PlacedSkill extends MapSkill {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Fraction of the path at which the walk reaches it, if it is on the path. */
  at: number | null;
  /** The finished picture's state (the walk complete). */
  state: NodeState;
}

export interface PlacedLink extends MapLink {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** On the walk's route. */
  route: boolean;
}

export interface RadialMap {
  width: number;
  height: number;
  centre: Point & { r: number };
  rings: [Ellipse, Ellipse, Ellipse];
  /** Where the cohort ends: between the middle and outer rings. */
  cohortRing: Ellipse;
  skills: PlacedSkill[];
  links: PlacedLink[];
  path: {
    points: Point[];
    fractions: number[];
    /** Path fractions of the three waypoints (the rhythm steps). */
    waypoints: [number, number, number];
  };
  /** Unlabelled faint dots: empty ring slots and the map beyond the outer ring. */
  dust: Array<Point & { r: number }>;
}

export interface RadialOptions {
  width?: number;
  height?: number;
  rings?: [Ellipse, Ellipse, Ellipse];
  /** Screen angle (radians, clockwise from 3 o'clock) the walk heads out towards. */
  heading?: number;
  metrics?: LabelMetrics;
}

const RADIAL_DEFAULTS = {
  width: 800,
  height: 600,
  rings: [
    { rx: 128, ry: 94 },
    { rx: 232, ry: 168 },
    { rx: 326, ry: 240 },
  ] as [Ellipse, Ellipse, Ellipse],
  heading: Math.PI / 7,
};

const at = (centre: Point, ellipse: Ellipse, angle: number): Point => ({
  x: centre.x + Math.cos(angle) * ellipse.rx,
  y: centre.y + Math.sin(angle) * ellipse.ry,
});

/**
 * Lays the graph out as 42-style rings around the cohort. Inner skills are
 * spread evenly; each outer skill starts at its parent's angle and is pushed
 * along its ring until its label clears every other label, the centre and
 * the edges. The whole map is turned so the walk heads out towards `heading`,
 * leaving room for the path to carry on past the outer ring.
 */
export function radialLayout(graph: SkillsGraph, options: RadialOptions = {}): RadialMap {
  const heading = options.heading ?? RADIAL_DEFAULTS.heading;
  // Lay out once untouched, then turn everything so the walk ends at `heading`.
  const last = graph.path.at(-1);
  let turn = 0;
  let placed = placeRadial(graph, options, turn);
  if (last === undefined) return placed.map;
  // Labels settle differently once turned, so correct the turn a few times.
  for (let pass = 0; pass < 4; pass += 1) {
    const off = delta(placed.angles.get(last) ?? heading, heading);
    if (Math.abs(off) < 0.05) break;
    turn += off;
    placed = placeRadial(graph, options, turn);
  }
  return placed.map;
}

function placeRadial(graph: SkillsGraph, options: RadialOptions, turn: number): { map: RadialMap; angles: Map<string, number> } {
  const width = options.width ?? RADIAL_DEFAULTS.width;
  const height = options.height ?? RADIAL_DEFAULTS.height;
  const rings = options.rings ?? RADIAL_DEFAULTS.rings;
  const metrics = options.metrics ?? LABELS;
  const centre = { x: width / 2, y: height / 2, r: Math.round(rings[0].ry * 0.56) };
  const centreBox: Box = { x: centre.x, y: centre.y, w: centre.r * 2.2, h: centre.r * 2.2 };
  const cohortRing = { rx: round((rings[1].rx + rings[2].rx) / 2), ry: round((rings[1].ry + rings[2].ry) / 2) };
  const angles = new Map<string, number>();
  const placed: PlacedSkill[] = [];
  const edge = 4;

  const boxAt = (skill: MapSkill, angle: number): Box => {
    const size = pillSize(skill.label, metrics);
    // A long label beside the centre moves out along its spoke until it clears it.
    let reach = 1;
    let p = at(centre, rings[skill.ring], angle);
    while (reach < 1.6 && overlaps({ x: p.x, y: p.y, ...size }, centreBox, 8)) {
      reach += 0.02;
      p = at(centre, { rx: rings[skill.ring].rx * reach, ry: rings[skill.ring].ry * reach }, angle);
    }
    // Long labels at the far left and right are nudged in, never cut off.
    const x = Math.min(width - edge - size.w / 2, Math.max(edge + size.w / 2, p.x));
    const y = Math.min(height - edge - size.h / 2, Math.max(edge + size.h / 2, p.y));
    return { x, y, ...size };
  };

  // Skills least listed (and latest on the ring) give way first when a ring is full.
  const keep = new Map(graph.skills.map((skill, index) => [skill.key, skill.count * 1000 - index]));
  for (const ring of [0, 1, 2] as const) {
    const has = new Set(placed.map((skill) => skill.key));
    // A skill whose parent did not fit goes too, so nothing floats unattached.
    let onRing = graph.skills
      .filter((skill) => skill.ring === ring && (ring === 0 || has.has(skill.parent!)))
      .toSorted((a, b) => a.order - b.order);
    while (onRing.length > 0) {
      const want = onRing.map((skill, index) => {
        if (ring === 0) return -Math.PI / 2 + turn + (TAU / onRing.length) * index;
        // Siblings fan out around their parent's angle.
        const siblings = onRing.filter((other) => other.parent === skill.parent);
        const spread = Math.min(0.42, (TAU / onRing.length) * 0.8);
        const k = siblings.indexOf(skill) - (siblings.length - 1) / 2;
        const near = (angles.get(skill.parent!) ?? turn) + k * spread;
        // Pulled a little towards an even spread, so a sparse ring is not lopsided.
        const even = (angles.get(onRing[0].parent!) ?? turn) + (TAU / onRing.length) * index;
        return near + delta(near, even) * 0.3;
      });
      // Settle in angular order, so neighbours on the ring are neighbours in the list.
      const sorted = onRing.map((skill, index) => ({ skill, want: want[index] })).toSorted((a, b) => a.want - b.want);
      const result = settleRing(
        sorted.map((entry) => entry.skill),
        sorted.map((entry) => entry.want),
        boxAt,
        [...placed],
        centre,
      );
      const boxes = sorted.map(({ skill }, index) => boxAt(skill, result[index]));
      const clash = boxes.some(
        (box, i) => overlaps(box, centreBox) || placed.some((other) => overlaps(box, other, 2)) || boxes.some((other, j) => j > i && overlaps(box, other, 2)),
      );
      if (clash && onRing.length > 1) {
        const least = onRing.reduce((a, b) => ((keep.get(b.key) ?? 0) < (keep.get(a.key) ?? 0) ? b : a));
        onRing = onRing.filter((skill) => skill !== least);
        continue;
      }
      if (clash) break;
      sorted.forEach(({ skill }, index) => {
        angles.set(skill.key, result[index]);
        placed.push({ ...skill, x: round(boxes[index].x), y: round(boxes[index].y), w: boxes[index].w, h: boxes[index].h, at: null, state: "later" });
      });
      break;
    }
  }

  const byKey = new Map(placed.map((skill) => [skill.key, skill]));
  const pointOf = (key: string): Point => (key === CENTRE ? centre : byKey.get(key)!);

  // The route: centre, the walked skills, then on past the outer ring.
  const walked = graph.path.filter((key) => byKey.has(key));
  const points: Point[] = [
    { x: centre.x, y: centre.y },
    ...walked.map((key) => ({ x: byKey.get(key)!.x, y: byKey.get(key)!.y })),
    tailEnd(centre, rings, walked.length > 0 ? byKey.get(walked.at(-1)!)! : null, turn, width, height),
  ];
  const fractions = pathFractions(points);
  walked.forEach((key, index) => {
    byKey.get(key)!.at = round(fractions[index + 1] * 1000) / 1000;
  });

  // Waypoints: the inner ring's last walked skill, the middle ring's, the end.
  const lastOn = (ring: Ring) => {
    const index = walked.findLastIndex((key) => byKey.get(key)!.ring === ring);
    return index < 0 ? null : fractions[index + 1];
  };
  const w1 = lastOn(0) ?? fractions[1] ?? 1 / 3;
  const w2 = Math.max(w1, lastOn(1) ?? (w1 + 1) / 2);
  const waypoints: [number, number, number] = [round(w1 * 1000) / 1000, round(w2 * 1000) / 1000, 1];

  const route = new Set<string>();
  [CENTRE, ...walked].forEach((key, index, list) => {
    if (index > 0) route.add(pairKey(list[index - 1], key));
  });

  const links: PlacedLink[] = graph.links
    .filter((link) => (link.a === CENTRE || byKey.has(link.a)) && byKey.has(link.b))
    .filter((link) => {
      // A shared link across the map would run under other labels: keep near ones.
      if (link.kind !== "shared") return true;
      return Math.abs(delta(angles.get(link.a)!, angles.get(link.b)!)) <= Math.PI / 3;
    })
    .map((link) => {
      const a = pointOf(link.a);
      const b = pointOf(link.b);
      return { ...link, x1: round(a.x), y1: round(a.y), x2: round(b.x), y2: round(b.y), route: route.has(pairKey(link.a, link.b)) };
    });

  const near = adjacency({ links });
  const states = nodeStates(
    placed.map((skill) => skill.key),
    near,
    new Set(walked),
  );
  for (const skill of placed) skill.state = states[skill.key];

  const map: RadialMap = {
    width,
    height,
    centre,
    rings,
    cohortRing,
    skills: placed,
    links,
    path: { points, fractions: fractions.map((f) => round(f * 1000) / 1000), waypoints },
    dust: dust(centre, rings, placed, turn),
  };
  return { map, angles };
}

/** Space between the last label's edge and the end of the path, viewBox units. */
export const TAIL_CLEARANCE = 56;

/**
 * Where the path ends: on past the last walked label, outward from the
 * centre, far enough that the walking group resting there never touches it,
 * and never off the drawing.
 */
function tailEnd(centre: Point, rings: [Ellipse, Ellipse, Ellipse], last: PlacedSkill | null, turn: number, width: number, height: number): Point {
  const edge = 8;
  const clampPoint = (p: Point) => ({
    x: round(Math.min(width - edge, Math.max(edge, p.x))),
    y: round(Math.min(height - edge, Math.max(edge, p.y))),
  });
  if (!last) return clampPoint(at(centre, { rx: rings[2].rx * 1.2, ry: rings[2].ry * 1.2 }, turn));
  const dx = last.x - centre.x;
  const dy = last.y - centre.y;
  const length = Math.hypot(dx, dy) || 1;
  // Along the outward ray, the label's own half-extent plus the clearance.
  const half = Math.abs(dx / length) * (last.w / 2) + Math.abs(dy / length) * (last.h / 2);
  const reach = half + TAIL_CLEARANCE;
  return clampPoint({ x: last.x + (dx / length) * reach, y: last.y + (dy / length) * reach });
}

/**
 * Pushes the labels on one ring apart until none overlaps another label on
 * the ring, a label already placed further in, or the centre. Angles keep
 * their order around the ring.
 */
function settleRing(
  skills: MapSkill[],
  want: number[],
  boxAt: (skill: MapSkill, angle: number) => Box,
  inner: Box[],
  origin: Point,
): number[] {
  const angles = [...want];
  const step = 0.012;
  const n = skills.length;
  for (let pass = 0; pass < 900; pass += 1) {
    let moved = false;
    const boxes = skills.map((skill, i) => boxAt(skill, angles[i]));
    for (let i = 0; i < n; i += 1) {
      for (const other of inner) {
        if (!overlaps(boxes[i], other, 6)) continue;
        // Move along the ring away from the obstacle.
        const away = Math.sign(delta(Math.atan2(other.y - origin.y, other.x - origin.x), Math.atan2(boxes[i].y - origin.y, boxes[i].x - origin.x))) || 1;
        angles[i] += away * step;
        moved = true;
      }
      for (let j = i + 1; j < n; j += 1) {
        if (!overlaps(boxes[i], boxes[j], 8)) continue;
        // Apart along the ring, the shorter way round.
        const way = Math.sign(delta(angles[i], angles[j])) || 1;
        angles[i] -= way * step;
        angles[j] += way * step;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return angles;
}

/** Faint unlabelled dots: open slots on rings with few skills, and a scatter past the outer ring. */
function dust(centre: Point, rings: [Ellipse, Ellipse, Ellipse], placed: PlacedSkill[], turn: number): Array<Point & { r: number }> {
  const dots: Array<Point & { r: number }> = [];
  const slots = [6, 10, 14];
  rings.forEach((ellipse, ring) => {
    for (let i = 0; i < slots[ring]; i += 1) {
      const angle = turn - Math.PI / 2 + (TAU / slots[ring]) * (i + 0.5);
      const p = at(centre, ellipse, angle);
      const box = { x: p.x, y: p.y, w: 14, h: 14 };
      if (placed.some((skill) => overlaps(skill, box, 10))) continue;
      dots.push({ x: round(p.x), y: round(p.y), r: ring === 2 ? 2.5 : 3 });
    }
  });
  // The map keeps going: a few dots past the outer ring, thinning out.
  for (let i = 0; i < 9; i += 1) {
    const angle = turn + 0.1 + (i - 4) * 0.2;
    const reach = 1.1 + (i % 3) * 0.06;
    const p = at(centre, { rx: rings[2].rx * reach, ry: rings[2].ry * reach }, angle);
    if (p.x < 8 || p.y < 8 || p.x > centre.x * 2 - 8 || p.y > centre.y * 2 - 8) continue;
    if (placed.some((skill) => overlaps(skill, { x: p.x, y: p.y, w: 10, h: 10 }, 8))) continue;
    dots.push({ x: round(p.x), y: round(p.y), r: 2 });
  }
  return dots;
}

/* --------------------------------------------------------------- column */

/**
 * The phone version: the walk becomes a vertical line (the trunk). Each ring
 * is one band: a station on the trunk (the last skill the walk passes on that
 * ring) and one short row of skills branching off it, the rest counted in a
 * "+N more" chip, so the whole path stays about a screen long. Bands are laid
 * out in CSS px (trunk at `trunk`) and shown 1:1 on a 358px column.
 */
export interface ColumnSkill extends MapSkill {
  /** Left edge and vertical centre of the label pill. */
  x: number;
  y: number;
  w: number;
  h: number;
  station: boolean;
  state: NodeState;
}

export interface ColumnBand {
  ring: Ring;
  height: number;
  /** The station first (when the walk passes this ring), then the branch row left to right. */
  skills: ColumnSkill[];
  /** Skills on this ring left out of the row. */
  more: number;
  /** Those skills, in order, for a "+N more" control to reveal. */
  rest: Array<MapSkill & { state: NodeState }>;
  /** Where the "+N more" chip starts (left edge, vertical centre), when `more` > 0. */
  moreAt: Point | null;
  /**
   * The branch line from the station on the trunk to the first pill in the
   * row ("branch"), then pill to pill along the row ("chain"; the page may
   * draw these as ticks between pills laid out at their real widths).
   */
  lines: Array<{ x1: number; y1: number; x2: number; y2: number; a: string; b: string; kind: "branch" | "chain" }>;
}

export interface ColumnOptions {
  width?: number;
  trunk?: number;
  rowHeight?: number;
  /** Most pills in a branch row. */
  perRow?: number;
  metrics?: LabelMetrics;
}

export const COLUMN_LABELS: LabelMetrics = { ...LABELS, minScale: 1 };

/** Room the "+N more" chip needs at the end of a row, CSS px. */
const MORE_WIDTH = 84;

/** As many skills as fit one row (at most `perRow`), leaving room for "+N more" when some are left out. */
function packRow(
  others: MapSkill[],
  spot: { start: number; y: number; width: number; gap: number; perRow: number; metrics: LabelMetrics; states: Record<string, NodeState> },
): ColumnSkill[] {
  const row: ColumnSkill[] = [];
  let x = spot.start;
  for (const [index, skill] of others.entries()) {
    if (row.length >= spot.perRow) break;
    const size = pillSize(skill.label, spot.metrics);
    const left = others.length - index - 1;
    if (x + size.w + (left > 0 ? spot.gap + MORE_WIDTH : 0) > spot.width) break;
    row.push({ ...skill, x, y: spot.y, w: size.w, h: size.h, station: false, state: spot.states[skill.key] });
    x += size.w + spot.gap;
  }
  return row;
}

/** "+N more" ends the branch row, or the station's row when the branch row is full. */
function placeMore(row: ColumnSkill[], station: ColumnSkill | undefined, spot: { start: number; y: number; width: number; gap: number }): Point {
  const last = row.at(-1);
  const rowEnd = last ? last.x + last.w + spot.gap : spot.start;
  if (!last || rowEnd + MORE_WIDTH <= spot.width) return { x: rowEnd, y: last ? last.y : spot.y };
  if (station) return { x: station.x + station.w + spot.gap, y: station.y };
  return { x: spot.start, y: spot.y };
}

export function columnLayout(graph: SkillsGraph, options: ColumnOptions = {}): ColumnBand[] {
  const width = options.width ?? 358;
  const trunk = options.trunk ?? 20;
  const rowHeight = options.rowHeight ?? 46;
  const perRow = options.perRow ?? 3;
  const metrics = options.metrics ?? COLUMN_LABELS;
  const gap = 10;
  const branchStart = trunk + 40;
  const stationStart = trunk + 18;
  const near = adjacency(graph);
  const states = nodeStates(
    graph.skills.map((skill) => skill.key),
    near,
    new Set(graph.path),
  );
  const rank: Record<NodeState, number> = { lit: 0, reachable: 1, later: 2 };
  const bands: ColumnBand[] = [];

  for (const ring of [0, 1, 2] as const) {
    const onRing = graph.skills.filter((skill) => skill.ring === ring).toSorted((a, b) => a.order - b.order);
    if (onRing.length === 0) continue;
    const station = graph.path.toReversed().map((key) => onRing.find((skill) => skill.key === key)).find(Boolean) ?? null;
    // Lit skills first, then those linked to the station, then the rest.
    const linked = (skill: MapSkill) => (station && near.get(station.key)?.has(skill.key) ? 0 : 1);
    const others = onRing
      .filter((skill) => skill !== station)
      .toSorted((a, b) => rank[states[a.key]] - rank[states[b.key]] || linked(a) - linked(b) || b.count - a.count || a.order - b.order);

    const skills: ColumnSkill[] = [];
    const lines: ColumnBand["lines"] = [];
    let y = rowHeight / 2 + 4;
    if (station) {
      const size = pillSize(station.label, metrics);
      skills.push({ ...station, x: stationStart, y, w: size.w, h: size.h, station: true, state: states[station.key] });
      y += rowHeight;
    }
    const row = packRow(others, { start: branchStart, y, width, gap, perRow, metrics, states });
    if (row.length > 0) {
      const from = skills[0];
      lines.push({ x1: trunk, y1: from ? from.y : y, x2: row[0].x, y2: y, a: from ? from.key : CENTRE, b: row[0].key, kind: "branch" });
      for (let i = 1; i < row.length; i += 1) {
        lines.push({ x1: row[i - 1].x + row[i - 1].w, y1: y, x2: row[i].x, y2: y, a: row[i - 1].key, b: row[i].key, kind: "chain" });
      }
      skills.push(...row);
      y += rowHeight;
    }
    const more = others.length - row.length;
    const rest = others.slice(row.length).map((skill) => ({ ...skill, state: states[skill.key] }));
    const moreAt = more > 0 ? placeMore(row, skills.find((skill) => skill.station), { start: branchStart, y, width, gap }) : null;
    if (row.length === 0 && more > 0) y += rowHeight;
    bands.push({ ring, height: Math.round(y - rowHeight / 2 + 4), skills, more, rest, moreAt, lines });
  }
  return bands;
}

/* ------------------------------------------------------------ signature */

function hashKey(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface Signature {
  nodes: Array<Point & { key: string }>;
  /** Arcs along the orbit joining the nodes in clock order. */
  arcs: string[];
  centre: number;
  orbit: number;
}

/**
 * A builder's skills as a tiny constellation: each tag sits on an orbit at a
 * clock position fixed by its name, so the same skill sits in the same place
 * on every builder's signature and shared skills line up down a list.
 */
export function signature(keys: readonly string[], size = 28, slots = 12): Signature {
  const centre = size / 2;
  const orbit = round(size * 0.36);
  const used = new Set<number>();
  const nodes = [...new Set(keys)].slice(0, slots).map((key) => {
    let slot = hashKey(key) % slots;
    while (used.has(slot)) slot = (slot + 1) % slots;
    used.add(slot);
    const angle = (slot / slots) * TAU - Math.PI / 2;
    return { key, slot, x: round(centre + Math.cos(angle) * orbit), y: round(centre + Math.sin(angle) * orbit) };
  });
  const ordered = nodes.toSorted((a, b) => a.slot - b.slot);
  const arcs = ordered.slice(1).map((node, i) => {
    const prev = ordered[i];
    const large = (node.slot - prev.slot) / slots > 0.5 ? 1 : 0;
    return `M${prev.x} ${prev.y}A${orbit} ${orbit} 0 ${large} 1 ${node.x} ${node.y}`;
  });
  return { nodes: nodes.map(({ key, x, y }) => ({ key, x, y })), arcs, centre, orbit };
}
