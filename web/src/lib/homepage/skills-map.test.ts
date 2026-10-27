import { describe, expect, it } from "vitest";
import {
  CENTRE,
  LABELS,
  MAX_LABEL_LENGTH,
  RING_CAPS,
  adjacency,
  buildSkillsGraph,
  columnLayout,
  drawnAt,
  nodeStates,
  overlaps,
  pathFractions,
  pillSize,
  pointAlong,
  profileTags,
  radialLayout,
  signature,
  walkerAt,
  ringSizes,
  skillKey,
  tallySkills,
  type SkillProfile,
} from "./skills-map";

const profile = (skills: string[], language: string | null = null): SkillProfile => ({
  skills,
  project: language === null ? null : { language },
});

/** The eight fictional builders from scripts/homepage-lab/seed-builders.sql. */
const FIXTURE: SkillProfile[] = [
  profile(["TypeScript", "PostgreSQL", "Node.js"], "TypeScript"),
  profile(["Kotlin", "Android", "SQLite"], "Kotlin"),
  profile(["React", "Accessibility", "CSS"], "TypeScript"),
  profile(["Python", "Pandas", "Data viz"], "Python"),
  profile(["Astro", "SQLite", "Tailwind"], "Astro"),
  profile(["Go", "Docker", "GitHub Actions"], "Go"),
  profile(["Twilio", "Node.js", "UX research"], "JavaScript"),
  profile(["JavaScript", "Git", "Writing"], "JavaScript"),
];

/** Many distinct, long labels: the worst case for fitting the rings. */
const CROWDED: SkillProfile[] = Array.from({ length: 12 }, (_, i) =>
  profile([`Infrastructure as code ${i}`, `Distributed systems ${i}`, `Observability ${i}`], `Language ${i}`),
);

const keysOf = (items: Array<{ key: string }>) => items.map((item) => item.key);

describe("skillKey", () => {
  it("merges case, spacing and punctuation variants", () => {
    expect(skillKey("Node.js")).toBe(skillKey("nodejs"));
    expect(skillKey("NodeJS")).toBe(skillKey(" node js "));
    expect(skillKey("GitHub Actions")).toBe(skillKey("github-actions"));
    expect(skillKey("Data viz")).toBe(skillKey("data_viz"));
  });

  it("merges common aliases", () => {
    expect(skillKey("JS")).toBe(skillKey("JavaScript"));
    expect(skillKey("ts")).toBe(skillKey("TypeScript"));
    expect(skillKey("Golang")).toBe(skillKey("Go"));
    expect(skillKey("Postgres")).toBe(skillKey("PostgreSQL"));
    expect(skillKey("Node")).toBe(skillKey("Node.js"));
  });

  it("keeps symbols that change the meaning", () => {
    expect(skillKey("C#")).not.toBe(skillKey("C"));
    expect(skillKey("C++")).not.toBe(skillKey("C"));
    expect(skillKey("C++")).not.toBe(skillKey("C#"));
  });
});

describe("tallySkills", () => {
  it("counts a skill once per profile, even when it is also the project language", () => {
    const { tags } = tallySkills([profile(["TypeScript", "typescript"], "TypeScript")]);
    expect(tags).toEqual([{ key: "typescript", label: "TypeScript", count: 1 }]);
  });

  it("counts project languages as tags", () => {
    const { tags } = tallySkills(FIXTURE);
    const byKey = Object.fromEntries(tags.map((tag) => [tag.key, tag.count]));
    expect(byKey.typescript).toBe(2);
    expect(byKey.javascript).toBe(2);
    expect(byKey.nodejs).toBe(2);
    expect(byKey.sqlite).toBe(2);
    expect(byKey.kotlin).toBe(1);
    expect(tags).toHaveLength(22);
  });

  it("sorts by count, then by first appearance", () => {
    const { tags } = tallySkills(FIXTURE);
    expect(keysOf(tags.slice(0, 4))).toEqual(["typescript", "nodejs", "sqlite", "javascript"]);
    expect(tags[4].key).toBe("postgresql");
  });

  it("labels each tag with its most common spelling", () => {
    const { tags } = tallySkills([profile(["node.js"]), profile(["Node.js"]), profile(["Node.js"])]);
    expect(tags[0]).toMatchObject({ label: "Node.js", count: 3 });
  });

  it("tidies whitespace in labels and ignores blank skills", () => {
    const { tags } = tallySkills([profile(["  Data   viz ", "", "   "])]);
    expect(tags).toEqual([{ key: "dataviz", label: "Data viz", count: 1 }]);
  });

  it("counts pairs listed on the same profile", () => {
    const { pairs } = tallySkills(FIXTURE);
    expect(pairs.get("nodejs|typescript")).toBe(1);
    expect(pairs.get("android|kotlin")).toBe(1);
    expect(pairs.get("javascript|nodejs")).toBe(1);
    expect(pairs.get("kotlin|python")).toBeUndefined();
  });
});

describe("ringSizes", () => {
  it("is empty with nothing to show", () => {
    expect(ringSizes(0)).toEqual([0, 0, 0]);
  });

  it("always puts something on the inner ring", () => {
    expect(ringSizes(1)).toEqual([1, 0, 0]);
    expect(ringSizes(2)).toEqual([1, 1, 0]);
  });

  it("fills all three rings once there are a few skills", () => {
    for (let n = 3; n <= 40; n += 1) {
      const sizes = ringSizes(n);
      expect({ n, empty: sizes.filter((size) => size === 0).length }).toEqual({ n, empty: 0 });
      expect(sizes.reduce((a, b) => a + b)).toBeLessThanOrEqual(n);
      sizes.forEach((size, ring) => expect(size).toBeLessThanOrEqual(RING_CAPS[ring]));
    }
  });

  it("uses every skill until the caps are reached", () => {
    expect(ringSizes(10).reduce((a, b) => a + b)).toBe(10);
    expect(ringSizes(100)).toEqual([...RING_CAPS]);
  });
});

describe("buildSkillsGraph", () => {
  it("is empty without profiles", () => {
    expect(buildSkillsGraph([])).toEqual({ skills: [], links: [], path: [] });
  });

  it("puts the most listed skills on the inner ring", () => {
    const graph = buildSkillsGraph(FIXTURE);
    const inner = graph.skills.filter((skill) => skill.ring === 0);
    expect(keysOf(inner).toSorted()).toEqual(["javascript", "nodejs", "postgresql", "sqlite", "typescript"]);
    const minInner = Math.min(...inner.map((skill) => skill.count));
    for (const skill of graph.skills.filter((s) => s.ring > 0)) expect(skill.count).toBeLessThanOrEqual(minInner);
  });

  it("respects the ring caps", () => {
    const graph = buildSkillsGraph(CROWDED);
    for (const ring of [0, 1, 2] as const) {
      expect(graph.skills.filter((skill) => skill.ring === ring).length).toBeLessThanOrEqual(RING_CAPS[ring]);
    }
    expect(graph.skills.length).toBe(RING_CAPS.reduce((a, b) => a + b));
  });

  it("leaves off labels too long to show whole", () => {
    const long = "x".repeat(MAX_LABEL_LENGTH + 1);
    const graph = buildSkillsGraph([profile([long, "Go"])]);
    expect(keysOf(graph.skills)).toEqual(["go"]);
  });

  it("hangs every outer skill from a skill one ring in", () => {
    const graph = buildSkillsGraph(FIXTURE);
    const ringOf = new Map(graph.skills.map((skill) => [skill.key, skill.ring]));
    for (const skill of graph.skills) {
      if (skill.ring === 0) expect(skill.parent).toBeNull();
      else expect(ringOf.get(skill.parent!)).toBeLessThan(skill.ring);
    }
  });

  it("prefers a parent the skill is listed with", () => {
    const graph = buildSkillsGraph(FIXTURE);
    const pg = graph.skills.find((skill) => skill.key === "postgresql");
    // PostgreSQL is listed beside TypeScript and Node.js; both are inner.
    expect(pg?.ring).toBe(0);
    const android = graph.skills.find((skill) => skill.key === "android");
    if (android && android.ring > 0) expect(["sqlite", "kotlin"]).toContain(android.parent);
  });

  it("links the centre to the inner ring and every other skill to its parent", () => {
    const graph = buildSkillsGraph(FIXTURE);
    for (const skill of graph.skills) {
      const inward = graph.links.find((link) => link.b === skill.key && link.kind !== "shared");
      expect({ skill: skill.key, from: inward?.a }).toEqual({ skill: skill.key, from: skill.ring === 0 ? CENTRE : skill.parent });
    }
  });

  it("links skills listed together, at most two extra links each", () => {
    const graph = buildSkillsGraph(FIXTURE);
    const { pairs } = tallySkills(FIXTURE);
    const shared = graph.links.filter((link) => link.kind === "shared");
    expect(shared.length).toBeGreaterThan(0);
    const extra = new Map<string, number>();
    for (const link of shared) {
      const key = [link.a, link.b].toSorted().join("|");
      expect({ key, weight: pairs.get(key) }).toEqual({ key, weight: link.weight });
      extra.set(link.a, (extra.get(link.a) ?? 0) + 1);
      extra.set(link.b, (extra.get(link.b) ?? 0) + 1);
    }
    for (const count of extra.values()) expect(count).toBeLessThanOrEqual(2);
  });

  it("never links the same pair twice", () => {
    const graph = buildSkillsGraph(FIXTURE);
    const keys = graph.links.map((link) => [link.a, link.b].toSorted().join("|"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("walks from the most listed skill outwards, never back in", () => {
    const graph = buildSkillsGraph(FIXTURE);
    const ringOf = new Map(graph.skills.map((skill) => [skill.key, skill.ring]));
    // The most listed skill is one of the first two, beside a skill it is listed with.
    expect(graph.path.slice(0, 2)).toContain("typescript");
    expect(tallySkills(FIXTURE).pairs.get([graph.path[0], graph.path[1]].toSorted().join("|"))).toBeGreaterThan(0);
    const rings = graph.path.map((key) => ringOf.get(key)!);
    expect(rings).toEqual(rings.toSorted((a, b) => a - b));
    expect(rings.at(-1)).toBe(2);
    expect(new Set(graph.path).size).toBe(graph.path.length);
  });

  it("walks along the tree where it can", () => {
    const graph = buildSkillsGraph(FIXTURE);
    const byKey = new Map(graph.skills.map((skill) => [skill.key, skill]));
    for (const key of graph.path.slice(1)) {
      const skill = byKey.get(key)!;
      if (skill.ring === 0) continue;
      expect(graph.path).toContain(skill.parent);
    }
  });

  it("copes with one profile", () => {
    const graph = buildSkillsGraph([profile(["Go", "Docker", "GitHub Actions"], "Go")]);
    expect(graph.skills).toHaveLength(3);
    expect(graph.skills.map((skill) => skill.ring)).toEqual([0, 1, 2]);
    expect(graph.path.toSorted()).toEqual(["docker", "githubactions", "go"]);
  });

  it("is deterministic", () => {
    expect(buildSkillsGraph(FIXTURE)).toEqual(buildSkillsGraph(FIXTURE.map((p) => ({ ...p, skills: [...p.skills] }))));
  });
});

describe("nodeStates", () => {
  it("marks walked skills done, their neighbours reachable and the rest for later", () => {
    const graph = buildSkillsGraph(FIXTURE);
    const near = adjacency(graph);
    const keys = keysOf(graph.skills);
    const none = nodeStates(keys, near, new Set());
    for (const skill of graph.skills) expect(none[skill.key]).toBe(skill.ring === 0 ? "reachable" : "later");
    const all = nodeStates(keys, near, new Set(graph.path));
    for (const key of graph.path) expect(all[key]).toBe("done");
    for (const key of keys) {
      if (all[key] !== "reachable") continue;
      expect([CENTRE, ...graph.path].some((done) => near.get(done)?.has(key))).toBe(true);
    }
    expect(Object.values(all)).toContain("later");
  });
});

describe("path geometry", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 30, y: 40 },
    { x: 30, y: 90 },
  ];

  it("measures cumulative fractions", () => {
    expect(pathFractions(points)).toEqual([0, 0.5, 1]);
    expect(pathFractions([{ x: 1, y: 1 }])).toEqual([0]);
  });

  it("finds points along the path", () => {
    const fractions = pathFractions(points);
    expect(pointAlong(points, fractions, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAlong(points, fractions, 0.25)).toEqual({ x: 15, y: 20 });
    expect(pointAlong(points, fractions, 0.75)).toEqual({ x: 30, y: 65 });
    expect(pointAlong(points, fractions, 2)).toEqual({ x: 30, y: 90 });
  });

  it("keeps the walking group beside the path and off the centre", () => {
    const fractions = pathFractions(points);
    const centre = { x: 0, y: 0, r: 10 };
    const start = walkerAt(points, fractions, 0, centre, 12);
    expect(Math.hypot(start.x, start.y)).toBeGreaterThanOrEqual(10);
    // Halfway down the vertical segment, 12 to the side of x = 30.
    const mid = walkerAt(points, fractions, 0.75, centre, 12);
    expect(mid.y).toBeCloseTo(65);
    expect(Math.abs(mid.x - 30)).toBeCloseTo(12);
  });

  it("maps the three rhythm stages onto the path", () => {
    const waypoints: [number, number, number] = [0.2, 0.6, 1];
    expect(drawnAt(0, waypoints)).toBe(0);
    expect(drawnAt(0.5, waypoints)).toBeCloseTo(0.1);
    expect(drawnAt(1, waypoints)).toBeCloseTo(0.2);
    expect(drawnAt(1.5, waypoints)).toBeCloseTo(0.4);
    expect(drawnAt(2, waypoints)).toBeCloseTo(0.6);
    expect(drawnAt(3, waypoints)).toBe(1);
    expect(drawnAt(9, waypoints)).toBe(1);
    expect(drawnAt(-1, waypoints)).toBe(0);
  });
});

describe("radialLayout", () => {
  const cases: Array<[string, SkillProfile[]]> = [
    ["one builder", FIXTURE.slice(0, 1)],
    ["three builders", FIXTURE.slice(0, 3)],
    ["eight builders", FIXTURE],
    ["a crowded map of long labels", CROWDED],
  ];

  describe.each(cases)("%s", (_name, profiles) => {
    const graph = buildSkillsGraph(profiles);
    const map = radialLayout(graph);

    it("places every skill that fits, dropping the least listed first", () => {
      if (profiles !== CROWDED) expect(keysOf(map.skills).toSorted()).toEqual(keysOf(graph.skills).toSorted());
      else expect(map.skills.length).toBeGreaterThanOrEqual(8);
      const placed = new Set(keysOf(map.skills));
      expect(map.skills.filter((skill) => skill.parent && !placed.has(skill.parent)).map((skill) => skill.label)).toEqual([]);
    });

    it("keeps every label clear of every other label and of the centre", () => {
      const centre = { x: map.centre.x, y: map.centre.y, w: map.centre.r * 2, h: map.centre.r * 2 };
      const clashes: string[] = [];
      map.skills.forEach((a, i) => {
        if (overlaps(a, centre)) clashes.push(`${a.label} on the centre`);
        for (const b of map.skills.slice(i + 1)) if (overlaps(a, b)) clashes.push(`${a.label} / ${b.label}`);
      });
      expect(clashes).toEqual([]);
    });

    it("keeps every label inside the drawing", () => {
      const outside = map.skills.filter(
        (skill) => skill.x - skill.w / 2 < 0 || skill.x + skill.w / 2 > map.width || skill.y - skill.h / 2 < 0 || skill.y + skill.h / 2 > map.height,
      );
      expect(outside.map((skill) => skill.label)).toEqual([]);
    });

    it("starts the walk at the centre and ends it past the outer ring", () => {
      const { points, fractions, waypoints } = map.path;
      expect(points[0]).toEqual({ x: map.centre.x, y: map.centre.y });
      const walked = graph.path.filter((key) => map.skills.some((skill) => skill.key === key));
      expect(points).toHaveLength(walked.length + 2);
      const end = points.at(-1)!;
      const reach = Math.hypot((end.x - map.centre.x) / map.rings[2].rx, (end.y - map.centre.y) / map.rings[2].ry);
      expect(reach).toBeGreaterThan(1);
      expect(fractions[0]).toBe(0);
      expect(fractions.at(-1)).toBe(1);
      expect(fractions).toEqual(fractions.toSorted((a, b) => a - b));
      expect(waypoints[0]).toBeGreaterThan(0);
      expect(waypoints[0]).toBeLessThanOrEqual(waypoints[1]);
      expect(waypoints[1]).toBeLessThan(1);
      expect(waypoints[2]).toBe(1);
    });

    it("finishes with the walked skills done", () => {
      for (const skill of map.skills) {
        if (map.path.points.some((point) => point.x === skill.x && point.y === skill.y)) {
          expect(skill.state).toBe("done");
          expect(skill.at).toBeGreaterThan(0);
        } else {
          expect(skill.at).toBeNull();
          expect(skill.state).not.toBe("done");
        }
      }
    });

    it("draws only links between placed nodes, and marks the route", () => {
      const placed = new Set([CENTRE, ...keysOf(map.skills)]);
      for (const link of map.links) {
        expect(placed.has(link.a) && placed.has(link.b)).toBe(true);
      }
      const routed = map.links.filter((link) => link.route).length;
      expect(routed).toBeGreaterThan(0);
      expect(routed).toBeLessThanOrEqual(graph.path.length);
    });
  });

  it("draws an unlabelled structure with no skills", () => {
    const map = radialLayout(buildSkillsGraph([]));
    expect(map.skills).toEqual([]);
    expect(map.links).toEqual([]);
    expect(map.path.points).toHaveLength(2);
    expect(map.dust.length).toBeGreaterThan(10);
  });

  it("turns the map so the walk heads out towards the requested side", () => {
    const graph = buildSkillsGraph(FIXTURE);
    for (const heading of [0, Math.PI / 2, Math.PI]) {
      const map = radialLayout(graph, { heading });
      const end = map.path.points.at(-1)!;
      const angle = Math.atan2((end.y - map.centre.y) / map.rings[2].ry, (end.x - map.centre.x) / map.rings[2].rx);
      const off = Math.abs(Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading)));
      expect({ heading, close: off < 0.7 }).toEqual({ heading, close: true });
    }
  });

  it("is deterministic", () => {
    expect(radialLayout(buildSkillsGraph(FIXTURE))).toEqual(radialLayout(buildSkillsGraph(FIXTURE)));
  });

  it("sizes labels for the smallest scale they are shown at", () => {
    const small = pillSize("TypeScript", { ...LABELS, minScale: 0.5 });
    const large = pillSize("TypeScript", { ...LABELS, minScale: 1 });
    expect(small.w).toBeCloseTo(large.w * 2, 0);
  });
});

describe("columnLayout", () => {
  const width = 358;

  for (const [name, profiles] of [
    ["one builder", FIXTURE.slice(0, 1)],
    ["eight builders", FIXTURE],
    ["a crowded map", CROWDED],
  ] as const) {
    it(`fits the phone column without overlaps (${name})`, () => {
      const graph = buildSkillsGraph(profiles);
      const bands = columnLayout(graph, { width });
      expect(bands.length).toBeGreaterThan(0);
      for (const band of bands) {
        const outside = band.skills.filter(
          (skill) => skill.x <= 20 || skill.x + skill.w > width || skill.y - skill.h / 2 < 0 || skill.y + skill.h / 2 > band.height,
        );
        expect(outside.map((skill) => skill.label)).toEqual([]);
        const boxes = band.skills.map((skill) => ({ x: skill.x + skill.w / 2, y: skill.y, w: skill.w, h: skill.h }));
        boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
      }
    });
  }

  it("puts the walked skills on the trunk as stations, in walk order", () => {
    const graph = buildSkillsGraph(FIXTURE);
    const bands = columnLayout(graph);
    const stations = bands.flatMap((band) => band.skills.filter((skill) => skill.station));
    expect(keysOf(stations)).toEqual(graph.path);
    for (const station of stations) expect(station.state).toBe("done");
  });

  it("keeps each band short on phones", () => {
    const bands = columnLayout(buildSkillsGraph(CROWDED), { caps: [4, 5, 5] });
    bands.forEach((band, ring) => expect(band.skills.length).toBeLessThanOrEqual([4, 5, 5][ring]));
  });

  it("connects each branch row back to a station", () => {
    const graph = buildSkillsGraph(FIXTURE);
    for (const band of columnLayout(graph)) {
      const stations = new Set(keysOf(band.skills.filter((skill) => skill.station)));
      const loose = band.skills.filter((skill) => !skill.station && !band.lines.some((line) => line.b === skill.key));
      expect(loose.map((skill) => skill.label)).toEqual([]);
      for (const line of band.lines.filter((l) => l.kind === "branch")) {
        expect(line.x1).toBe(20);
        expect(stations.has(line.a)).toBe(true);
      }
      for (const line of band.lines.filter((l) => l.kind === "chain")) expect(line.y1).toBe(line.y2);
    }
  });
});

describe("profileTags", () => {
  it("lists skills then the project language, once each", () => {
    expect(profileTags(profile(["TypeScript", "Node.js", "typescript"], "TypeScript")).map((tag) => tag.key)).toEqual(["typescript", "nodejs"]);
    expect(profileTags(profile(["Go"], "Python")).map((tag) => tag.key)).toEqual(["go", "python"]);
    expect(profileTags(profile([], null))).toEqual([]);
  });
});

describe("signature", () => {
  it("puts each tag on the orbit, inside the box", () => {
    const sig = signature(["typescript", "nodejs", "postgresql"], 28);
    expect(sig.nodes).toHaveLength(3);
    for (const node of sig.nodes) {
      expect(Math.hypot(node.x - sig.centre, node.y - sig.centre)).toBeCloseTo(sig.orbit, 0);
      expect(node.x).toBeGreaterThan(0);
      expect(node.x).toBeLessThan(28);
    }
    expect(sig.arcs).toHaveLength(2);
  });

  it("places the same skill in the same spot on every signature", () => {
    const a = signature(["react", "css"]);
    const b = signature(["react", "go"]);
    expect(a.nodes.find((node) => node.key === "react")).toEqual(b.nodes.find((node) => node.key === "react"));
  });

  it("never stacks two tags on one spot", () => {
    const sig = signature(Array.from({ length: 12 }, (_, i) => `skill${i}`));
    const spots = sig.nodes.map((node) => `${node.x},${node.y}`);
    expect(new Set(spots).size).toBe(12);
  });

  it("ignores repeats and copes with none", () => {
    expect(signature(["go", "go"]).nodes).toHaveLength(1);
    expect(signature([])).toMatchObject({ nodes: [], arcs: [] });
  });
});
