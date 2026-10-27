/**
 * Deterministic constellation layouts for homepage candidate C.
 *
 * Everything is generated from fixed seeds so the server renders the same
 * picture on every request and the client can animate exactly what was drawn.
 * Coordinates are in SVG user units of each network's own viewBox.
 *
 * Node vocabulary, used across every section so the shapes read as a legend:
 *   builder  filled peach circle
 *   live     filled peach circle with a pulsing halo (Cohort 04, running now)
 *   mentor   teal ring
 *   partner  warm-ink diamond
 *   alum     teal ring around a builder (an alumnus who came back to mentor)
 *   hub      small ring at the centre of the cohorts
 */

export type NodeKind = "builder" | "live" | "mentor" | "partner" | "alum" | "hub";
export type EdgeKind = "peer" | "mentor" | "partner" | "network" | "hub";

export interface NetNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  r: number;
  /** 0..1, used to stagger intros outward from the centre. */
  order: number;
}

export interface NetEdge {
  id: string;
  a: string;
  b: string;
  kind: EdgeKind;
  order: number;
}

export interface NetLabel {
  x: number;
  y: number;
  text: string;
  anchor: "start" | "middle" | "end";
  tone: "strong" | "quiet" | "live";
  /** Staged networks only: the first step at which the label shows. */
  from?: number;
}

/** A camera framing: the part of the network's space a viewBox shows. */
export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NetRing {
  cx: number;
  cy: number;
  r: number;
  /** Share of the circumference left open, 0..1. */
  gap: number;
  tone: "peach" | "teal";
}

export interface Net {
  width: number;
  height: number;
  nodes: NetNode[];
  edges: NetEdge[];
  labels: NetLabel[];
  rings: NetRing[];
  /** Optional camera; without it the viewBox is 0 0 width height. */
  view?: View;
}

export interface NodeState {
  x: number;
  y: number;
  o: number;
}

export interface StagedNet extends Net {
  /** Per node id, one state per story step. */
  nodeStates: Record<string, NodeState[]>;
  /** Per edge id, visibility (0 or 1) per story step. */
  edgeStates: Record<string, number[]>;
  ringStates: Array<Array<{ r: number; gap: number }>>;
  /** The camera for each step: close on the ring first, pulling back as it grows. */
  views: View[];
}

type Point = { x: number; y: number };

/** mulberry32: tiny, fast and good enough for layout jitter. */
export function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const round = (n: number) => Math.round(n * 10) / 10;
const rad = (deg: number) => (deg * Math.PI) / 180;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Scatter n points in a disc, keeping them at least minGap apart. */
function scatter(rand: () => number, centre: Point, n: number, radius: number, minGap: number, squash = 1): Point[] {
  const points: Point[] = [];
  for (let attempt = 0; points.length < n && attempt < 4000; attempt += 1) {
    const angle = rand() * Math.PI * 2;
    const r = radius * Math.sqrt(0.08 + rand() * 0.92);
    const p = { x: centre.x + Math.cos(angle) * r, y: centre.y + Math.sin(angle) * r * squash };
    const gap = attempt > 3000 ? minGap * 0.6 : minGap;
    if (points.every((q) => dist(p, q) >= gap)) points.push(p);
  }
  return points;
}

/** Connect every node to its k nearest neighbours, without duplicates. */
function nearestEdges(ids: string[], at: (id: string) => Point, k: number, kind: EdgeKind, prefix: string): NetEdge[] {
  const seen = new Set<string>();
  const edges: NetEdge[] = [];
  for (const id of ids) {
    const nearest = ids
      .filter((other) => other !== id)
      .toSorted((p, q) => dist(at(id), at(p)) - dist(at(id), at(q)))
      .slice(0, k);
    for (const other of nearest) {
      const key = [id, other].toSorted().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ id: `${prefix}${edges.length}`, a: id, b: other, kind, order: 0 });
    }
  }
  return edges;
}

function nearestTo(ids: string[], at: (id: string) => Point, target: Point, count: number): string[] {
  return ids.toSorted((p, q) => dist(at(p), target) - dist(at(q), target)).slice(0, count);
}

/** Order from 0 (centre) to 1 (edge), so intros can radiate outward. */
function withOrder(net: Net, centre: Point): Net {
  const at = new Map(net.nodes.map((n) => [n.id, n]));
  const far = Math.max(...net.nodes.map((n) => dist(n, centre)), 1);
  for (const node of net.nodes) node.order = round(dist(node, centre) / far);
  for (const edge of net.edges) {
    const a = at.get(edge.a)!;
    const b = at.get(edge.b)!;
    edge.order = round(Math.min(dist(a, centre), dist(b, centre)) / far);
  }
  for (const node of net.nodes) {
    node.x = round(node.x);
    node.y = round(node.y);
  }
  return net;
}

/** Shrink the viewBox to what is drawn, so the picture uses all its space. */
function fitToContent(net: Net, pad: number): Net {
  const xs = [...net.nodes.map((n) => n.x - n.r * 2.4), ...net.nodes.map((n) => n.x + n.r * 2.4), ...net.labels.map((l) => l.x - 40), ...net.labels.map((l) => l.x + 40)];
  const ys = [...net.nodes.map((n) => n.y - n.r * 2.4), ...net.nodes.map((n) => n.y + n.r * 2.4), ...net.labels.map((l) => l.y - 16), ...net.labels.map((l) => l.y + (l.tone === "quiet" ? 30 : 6))];
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const shift = <T extends { x: number; y: number }>(p: T) => ({ ...p, x: round(p.x - minX), y: round(p.y - minY) });
  return {
    ...net,
    width: Math.ceil(Math.max(...xs) + pad - minX),
    height: Math.ceil(Math.max(...ys) + pad - minY),
    nodes: net.nodes.map(shift),
    labels: net.labels.map(shift),
    rings: net.rings.map((ring) => ({ ...ring, cx: round(ring.cx - minX), cy: round(ring.cy - minY) })),
  };
}

/* ------------------------------------------------------------------ hero */

/** What the hero needs from each cohort in the shared timeline. */
export interface CohortMark {
  number: string;
  status: string;
  running: boolean;
}

/**
 * The four cohorts as clusters around a centre. "square" sits beside the
 * heading on wide screens; "wide" is a band above it on phones and tablets,
 * read left to right as a timeline.
 */
export function heroNetwork(layout: "square" | "wide", cohorts: readonly CohortMark[]): Net {
  const rand = seeded(layout === "square" ? 4104 : 2604);
  const square = layout === "square";
  const width = square ? 600 : 640;
  const height = square ? 600 : 330;
  const centre = { x: width / 2, y: height / 2 };
  const clusterRadius = square ? 64 : 50;
  const count = Math.max(cohorts.length, 1);
  // Hand-tuned wobble so the ring of cohorts never reads as a perfect polygon.
  const wobble = [0, 2, -6, 4, -3, 5];
  const centres: Point[] = cohorts.map((_, i) => {
    if (square) {
      const deg = -148 + (360 / count) * i + wobble[i % wobble.length] * 2;
      const r = [182, 196, 170, 186][i % 4];
      return { x: centre.x + Math.cos(rad(deg)) * r, y: centre.y + Math.sin(rad(deg)) * r };
    }
    const x = 92 + (count === 1 ? 0 : (458 / (count - 1)) * i);
    return { x, y: (i % 2 === 0 ? 196 : 120) + wobble[i % wobble.length] * 1.5 };
  });

  const nodes: NetNode[] = [];
  const edges: NetEdge[] = [];
  const labels: NetLabel[] = [];
  const clusters: string[][] = [];

  centres.forEach((c, index) => {
    const cohort = cohorts[index];
    const live = cohort.running;
    const size = live ? 5 : 6 + (index % 2);
    const ids: string[] = [];
    scatter(rand, c, size, clusterRadius, square ? 30 : 25, square ? 1 : 0.86).forEach((p, i) => {
      const id = `c${index}n${i}`;
      ids.push(id);
      nodes.push({ id, kind: live ? "live" : "builder", x: p.x, y: p.y, r: live ? 5.5 : 3.6 + rand() * 2.2, order: 0 });
    });
    clusters.push(ids);
    const at = (id: string) => nodes.find((n) => n.id === id)!;
    edges.push(...nearestEdges(ids, at, 2, "peer", `p${index}-`));

    const away = Math.hypot(c.x - centre.x, c.y - centre.y) || 1;
    const outward = square
      ? { x: c.x + ((c.x - centre.x) / away) * (clusterRadius + 30), y: c.y + ((c.y - centre.y) / away) * (clusterRadius + 30) + 5 }
      : { x: c.x, y: c.y + (index % 2 === 0 ? clusterRadius + 34 : -clusterRadius - 22) };
    labels.push({ x: round(outward.x), y: round(outward.y), text: cohort.number, anchor: "middle", tone: live ? "live" : "strong" });
    if (live) labels.push({ x: round(outward.x), y: round(outward.y), text: cohort.status.toLowerCase(), anchor: "middle", tone: "quiet" });
  });

  const at = (id: string) => nodes.find((n) => n.id === id)!;

  // Mentors sit between neighbouring cohorts and work across them.
  const mentorPairs = clusters.flatMap((_, i) => (square || i < count - 1 ? [[i, (i + 1) % count]] : [])).filter(([a, b]) => a !== b);
  mentorPairs.forEach(([from, to], i) => {
    const a = centres[from];
    const b = centres[to];
    const mid = square
      ? { x: centre.x + ((a.x + b.x) / 2 - centre.x) * 1.08, y: centre.y + ((a.y + b.y) / 2 - centre.y) * 1.08 }
      : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + (i % 2 === 0 ? 46 : -40) };
    const id = `m${i}`;
    nodes.push({ id, kind: "mentor", x: mid.x + (rand() - 0.5) * 14, y: mid.y + (rand() - 0.5) * 14, r: 7.5, order: 0 });
    for (const target of [...nearestTo(clusters[from], at, mid, 2), ...nearestTo(clusters[to], at, mid, 2)]) {
      edges.push({ id: `e-m${i}-${target}`, a: id, b: target, kind: "mentor", order: 0 });
    }
  });

  // One partner school, linked to the two most recent cohorts.
  const partner = square ? { x: centre.x - 6, y: height - 46 } : { x: 470, y: 300 };
  nodes.push({ id: "partner", kind: "partner", x: partner.x, y: partner.y, r: 8, order: 0 });
  const recent = clusters.slice(-2).flatMap((ids) => nearestTo(ids, at, partner, 2));
  for (const target of recent) {
    edges.push({ id: `e-pt-${target}`, a: "partner", b: target, kind: "partner", order: 0 });
  }

  const rings: NetRing[] = [];
  if (square) {
    nodes.push({ id: "hub", kind: "hub", x: centre.x, y: centre.y, r: 5, order: 0 });
    clusters.forEach((ids, i) => {
      const [nearest] = nearestTo(ids, at, centre, 1);
      edges.push({ id: `e-hub-${i}`, a: "hub", b: nearest, kind: "hub", order: 0 });
    });
    rings.push({ cx: centre.x, cy: centre.y, r: 178, gap: 0, tone: "teal" });
  } else {
    // A quiet thread through time, cohort to cohort.
    for (let i = 0; i < count - 1; i += 1) {
      const [from] = nearestTo(clusters[i], at, centres[i + 1], 1);
      const [to] = nearestTo(clusters[i + 1], at, centres[i], 1);
      edges.push({ id: `e-time-${i}`, a: from, b: to, kind: "hub", order: 0 });
    }
  }

  return fitToContent(withOrder({ width, height, nodes, edges, labels, rings }, square ? centre : { x: 0, y: height / 2 }), 8);
}

/* ---------------------------------------------------------------- rhythm */

/**
 * The cohort rhythm told in three states of one network:
 *   0 Build together       a small ring of builders connects up
 *   1 Engineers alongside  mentors step in among them
 *   2 Stay in touch        the ring opens into the wider community
 */
export function rhythmNetwork(cohorts: readonly CohortMark[]): StagedNet {
  const rand = seeded(904);
  const width = 640;
  const height = 480;
  const c = { x: 320, y: 240 };
  const nodes: NetNode[] = [];
  const edges: NetEdge[] = [];
  const nodeStates: Record<string, NodeState[]> = {};
  const edgeStates: Record<string, number[]> = {};
  const polar = (deg: number, r: number, sx = 1, sy = 1): Point => ({ x: c.x + Math.cos(rad(deg)) * r * sx, y: c.y + Math.sin(rad(deg)) * r * sy });

  const BUILDERS = 7;
  const builderIds: string[] = [];
  for (let i = 0; i < BUILDERS; i += 1) {
    const id = `b${i}`;
    builderIds.push(id);
    const base = -90 + (360 / BUILDERS) * i + (rand() - 0.5) * 14;
    const s0 = polar(base, 112 + rand() * 14);
    const s1 = polar(base + 6, 124 + rand() * 10);
    const s2 = polar(base + 4, 138 + rand() * 16, 1.12, 0.96);
    nodes.push({ id, kind: "builder", x: s2.x, y: s2.y, r: 6.5, order: 0 });
    nodeStates[id] = [s0, s1, s2].map((p) => ({ x: round(p.x), y: round(p.y), o: 1 }));
  }

  // Peers: ring neighbours plus a few chords across the table.
  const peerPairs: Array<[number, number]> = [];
  for (let i = 0; i < BUILDERS; i += 1) peerPairs.push([i, (i + 1) % BUILDERS]);
  peerPairs.push([0, 3], [1, 5], [2, 6], [4, 0]);
  peerPairs.forEach(([a, b], i) => {
    const id = `peer${i}`;
    edges.push({ id, a: builderIds[a], b: builderIds[b], kind: "peer", order: i / peerPairs.length });
    edgeStates[id] = [1, 1, 1];
  });

  // Mentors: come in from the edges and sit among the builders.
  const mentorAngles = [-38, 90, 205];
  mentorAngles.forEach((deg, i) => {
    const id = `m${i}`;
    const s0 = polar(deg, 340, 1.1, 1);
    const s1 = polar(deg, 58 + i * 8);
    const s2 = polar(deg + 8, 80, 1.1, 1);
    nodes.push({ id, kind: "mentor", x: s2.x, y: s2.y, r: 10, order: 0 });
    nodeStates[id] = [
      { x: round(s0.x), y: round(s0.y), o: 0 },
      { x: round(s1.x), y: round(s1.y), o: 1 },
      { x: round(s2.x), y: round(s2.y), o: 1 },
    ];
    const targets = builderIds.toSorted((p, q) => dist(nodeStates[p][1], s1) - dist(nodeStates[q][1], s1)).slice(0, 3);
    targets.forEach((target, j) => {
      const edgeId = `me${i}-${j}`;
      edges.push({ id: edgeId, a: id, b: target, kind: "mentor", order: 0.3 + i * 0.2 });
      edgeStates[edgeId] = [0, 1, 1];
    });
  });

  // An alumnus who came back as a mentor: a teal ring around builder 2.
  nodes.push({ id: "alum", kind: "alum", x: nodeStates.b2[2].x, y: nodeStates.b2[2].y, r: 12, order: 0.6 });
  nodeStates.alum = nodeStates.b2.map((s, step) => ({ ...s, o: step === 2 ? 1 : 0 }));

  // The wider network: earlier cohorts, other mentors, partners.
  const outer: Array<{ id: string; kind: NodeKind; at: Point; r: number }> = [];
  // Earlier cohorts sit around the running one, as in the hero, seen from inside.
  const current = cohorts.find((cohort) => cohort.running) ?? cohorts.at(-1);
  const earlier = cohorts.filter((cohort) => cohort !== current);
  const groupAngles = [-150, -20, 140, 75, -95];
  const labels: NetLabel[] = [];
  if (current) labels.push({ x: c.x, y: 52, text: current.number, anchor: "middle", tone: "live", from: 0 });
  if (current) labels.push({ x: c.x, y: 52, text: current.status.toLowerCase(), anchor: "middle", tone: "quiet", from: 0 });
  earlier.slice(0, groupAngles.length).forEach((cohort, g) => {
    const deg = groupAngles[g];
    const centre = polar(deg, 212, 1.28, 0.9);
    labels.push({ x: round(centre.x), y: round(centre.y + (Math.sin(rad(deg)) < 0 ? -36 : 50)), text: cohort.number, anchor: "middle", tone: "strong", from: 2 });
    scatter(rand, centre, 3, 26, 18).forEach((p, i) => {
      outer.push({ id: `o${g}-${i}`, kind: "builder", at: p, r: 4.2 });
    });
  });
  outer.push({ id: "op0", kind: "partner", at: polar(62, 200, 1.42, 0.98), r: 8 });
  outer.push({ id: "op1", kind: "partner", at: polar(-60, 206, 1.05, 0.98), r: 8 });
  outer.push({ id: "om0", kind: "mentor", at: polar(30, 214, 1.38, 0.92), r: 8 });
  outer.push({ id: "om1", kind: "mentor", at: polar(178, 214, 1.34, 0.9), r: 8 });

  for (const node of outer) {
    nodes.push({ id: node.id, kind: node.kind, x: node.at.x, y: node.at.y, r: node.r, order: 0.8 });
    const inward = { x: c.x + (node.at.x - c.x) * 0.82, y: c.y + (node.at.y - c.y) * 0.82 };
    nodeStates[node.id] = [
      { x: round(inward.x), y: round(inward.y), o: 0 },
      { x: round(inward.x), y: round(inward.y), o: 0 },
      { x: round(node.at.x), y: round(node.at.y), o: 1 },
    ];
  }

  const at = (id: string) => {
    const s = nodeStates[id];
    return s[2];
  };
  const outerIds = outer.map((o) => o.id);
  // Each outer node reaches back to the nearest member of the cohort, and to its
  // nearest outer neighbour, so the ring visibly opens outward.
  outerIds.forEach((id, i) => {
    const [inner] = nearestTo([...builderIds, "alum"].filter((x) => x !== "alum"), at, at(id), 1);
    const edgeId = `net${i}`;
    edges.push({ id: edgeId, a: inner, b: id, kind: outer[i].kind === "partner" ? "partner" : outer[i].kind === "mentor" ? "mentor" : "network", order: 0.7 });
    edgeStates[edgeId] = [0, 0, 1];
  });
  nearestEdges(outerIds, at, 1, "network", "onet").forEach((edge) => {
    edges.push(edge);
    edgeStates[edge.id] = [0, 0, 1];
  });

  const rings: NetRing[] = [{ cx: c.x, cy: c.y, r: 160, gap: 0.26, tone: "peach" }];
  const ringStates = [[{ r: 156, gap: 0 }, { r: 166, gap: 0 }, { r: 186, gap: 0.26 }]];

  const views = [0, 1, 2].map((step) => {
    const points: Point[] = [];
    for (const node of nodes) {
      const state = nodeStates[node.id][step];
      if (state.o > 0) points.push({ x: state.x - node.r, y: state.y - node.r }, { x: state.x + node.r, y: state.y + node.r });
    }
    const ring = ringStates[0][step];
    points.push({ x: c.x - ring.r, y: c.y - ring.r }, { x: c.x + ring.r, y: c.y + ring.r });
    for (const label of labels) {
      if ((label.from ?? 0) <= step) points.push({ x: label.x - 30, y: label.y - 18 }, { x: label.x + 30, y: label.y + 22 });
    }
    return frame(points, 4 / 3, 22);
  });

  const net = withOrder({ width, height, nodes, edges, labels, rings }, c);
  return { ...net, nodeStates, edgeStates, ringStates, views, view: views[2] };
}

/** The smallest view of a given aspect ratio that holds every point, centred. */
function frame(points: Point[], aspect: number, pad: number): View {
  const minX = Math.min(...points.map((p) => p.x)) - pad;
  const maxX = Math.max(...points.map((p) => p.x)) + pad;
  const minY = Math.min(...points.map((p) => p.y)) - pad;
  const maxY = Math.max(...points.map((p) => p.y)) + pad;
  let w = maxX - minX;
  let h = maxY - minY;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  return { x: round((minX + maxX) / 2 - w / 2), y: round((minY + maxY) / 2 - h / 2), w: round(w), h: round(h) };
}

/** The staged network flattened to one step, for static rendering. */
export function atStep(net: StagedNet, step: number): Net & { opacity: Record<string, number> } {
  const opacity: Record<string, number> = {};
  const nodes = net.nodes.map((node) => {
    const s = net.nodeStates[node.id][step];
    opacity[node.id] = s.o;
    return { ...node, x: s.x, y: s.y };
  });
  const edges = net.edges.filter((edge) => net.edgeStates[edge.id][step] === 1);
  const rings = net.rings.map((ring, i) => ({ ...ring, ...net.ringStates[i][step] }));
  const labels = net.labels.filter((label) => (label.from ?? 0) <= step);
  return { ...net, nodes, edges, rings, labels, opacity, view: net.views[step] };
}

/* ------------------------------------------------------------- community */

/**
 * The open community around the cohorts: builders, mentors and partners each
 * plug in differently. Highlighting a role lights its nodes and edges.
 */
export function communityNetwork(layout: "square" | "wide" = "square"): Net {
  const rand = seeded(7331);
  const width = 560;
  const height = 560;
  const c = { x: 280, y: 280 };
  const nodes: NetNode[] = [];
  const edges: NetEdge[] = [];

  // The cohorts at the centre.
  const core = scatter(rand, c, 6, 40, 22);
  core.forEach((p, i) => nodes.push({ id: `k${i}`, kind: "live", x: p.x, y: p.y, r: 4.6, order: 0 }));
  const coreIds = core.map((_, i) => `k${i}`);
  const at = (id: string) => nodes.find((n) => n.id === id)!;
  edges.push(...nearestEdges(coreIds, at, 2, "hub", "kc"));

  // Builders spread through the middle band.
  const builderIds: string[] = [];
  const ringPoints: Point[] = [];
  for (let attempt = 0; ringPoints.length < 13 && attempt < 3000; attempt += 1) {
    const angle = rand() * Math.PI * 2;
    const r = 104 + rand() * 96;
    const p = { x: c.x + Math.cos(angle) * r, y: c.y + Math.sin(angle) * r };
    if (ringPoints.every((q) => dist(p, q) > 46)) ringPoints.push(p);
  }
  ringPoints.forEach((p, i) => {
    const id = `b${i}`;
    builderIds.push(id);
    nodes.push({ id, kind: "builder", x: p.x, y: p.y, r: 4.2 + rand() * 2, order: 0 });
  });
  edges.push(...nearestEdges(builderIds, at, 2, "peer", "bp"));
  builderIds.forEach((id, i) => {
    if (i % 3 !== 0) return;
    const [k] = nearestTo(coreIds, at, at(id), 1);
    edges.push({ id: `bk${i}`, a: id, b: k, kind: "peer", order: 0 });
  });

  // Mentors: placed between builders, each reviewing a few.
  const mentorIds: string[] = [];
  [-70, 8, 96, 172, 250].forEach((deg, i) => {
    const r = 150 + (i % 2) * 36;
    const p = { x: c.x + Math.cos(rad(deg + 18)) * r, y: c.y + Math.sin(rad(deg + 18)) * r };
    const id = `m${i}`;
    mentorIds.push(id);
    nodes.push({ id, kind: "mentor", x: p.x, y: p.y, r: 8.5, order: 0 });
    nearestTo(builderIds, at, p, 3).forEach((target, j) => {
      edges.push({ id: `me${i}-${j}`, a: id, b: target, kind: "mentor", order: 0 });
    });
  });

  // Institutional partners on the outside, looking in at the work.
  [-120, -10, 75, 165].forEach((deg, i) => {
    const p = { x: c.x + Math.cos(rad(deg)) * 246, y: c.y + Math.sin(rad(deg)) * 246 };
    const id = `pt${i}`;
    nodes.push({ id, kind: "partner", x: p.x, y: p.y, r: 9, order: 0 });
    nearestTo(builderIds, at, p, 3).forEach((target, j) => {
      edges.push({ id: `pe${i}-${j}`, a: id, b: target, kind: "partner", order: 0 });
    });
  });

  // Phones show the network in a wide band: stretch the community around the
  // cohorts (never the cohorts' own ring) to about 2.1:1 so it fills the band.
  if (layout === "wide") {
    for (const node of nodes) {
      if (node.id.startsWith("k")) continue;
      node.x = c.x + (node.x - c.x) * 1.85;
      node.y = c.y + (node.y - c.y) * 0.86;
    }
  }

  const rings: NetRing[] = [{ cx: c.x, cy: c.y, r: 62, gap: 0, tone: "peach" }];
  return fitToContent(withOrder({ width, height, nodes, edges, labels: [], rings }, c), 6);
}

/* ------------------------------------------------------------- signature */

export interface Signature {
  nodes: Array<{ x: number; y: number; tag: string; kind: "skill" | "language" }>;
  arcs: Array<{ d: string }>;
}

const SLOTS = 12;

/** Tags are compared case-insensitively across cards. */
export const tagKey = (value: string) => value.trim().toLowerCase();

/**
 * A builder's skill signature: each skill always lands on the same clock
 * position on the orbit, so shared skills line up across cards.
 */
export function signature(skills: string[], language: string | null, size = 112): Signature {
  const centre = size / 2;
  const orbit = size * 0.4;
  const used = new Set<number>();
  const place = (tag: string) => {
    let slot = hashString(tagKey(tag)) % SLOTS;
    while (used.has(slot)) slot = (slot + 1) % SLOTS;
    used.add(slot);
    const angle = rad(slot * (360 / SLOTS) - 90);
    return { x: round(centre + Math.cos(angle) * orbit), y: round(centre + Math.sin(angle) * orbit) };
  };
  const nodes: Signature["nodes"] = skills.map((skill) => ({ ...place(skill), tag: tagKey(skill), kind: "skill" as const }));
  if (language && !nodes.some((n) => n.tag === tagKey(language))) {
    nodes.push({ ...place(language), tag: tagKey(language), kind: "language" });
  }
  const arcs = nodes.slice(1).map((node, i) => {
    const prev = nodes[i];
    return { d: `M${prev.x} ${prev.y} A${orbit} ${orbit} 0 0 1 ${node.x} ${node.y}` };
  });
  return { nodes, arcs };
}

/* ------------------------------------------------------------------ hire */

/** Many threads converging on one point: the network resolving into a single line. */
export function convergence(count = 13, width = 1200, height = 240): Array<{ d: string; tone: "peach" | "teal" | "ink" }> {
  const rand = seeded(1201);
  const tones = ["peach", "teal", "ink"] as const;
  return Array.from({ length: count }, (_, i) => {
    const x = round(30 + (i / (count - 1)) * (width - 60) + (rand() - 0.5) * 30);
    const y0 = round(rand() * 34);
    const bend = round(height * (0.42 + rand() * 0.2));
    return { d: `M${x} ${y0} C${x} ${bend} ${width / 2} ${round(height * 0.55)} ${width / 2} ${height}`, tone: tones[i % 3] };
  });
}
