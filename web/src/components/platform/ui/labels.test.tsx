import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Card from "./Card";
import Chip from "./Chip";
import Pill from "./Pill";
import { ReactionKind, RoleBadgeKind } from "@/lib/platform/contracts";
import { people } from "@/lib/platform/fixtures";
import RoleBadge from "./RoleBadge";
import TextReaction, { REACTIONS } from "./TextReaction";
import { CHIP_TONES } from "./tones";

describe("RoleBadge", () => {
  const badge = (kind: RoleBadgeKind, label: string) => ({ kind, label });

  it("renders every contract kind with the server's own wording", () => {
    for (const kind of RoleBadgeKind.options) {
      const html = renderToStaticMarkup(<RoleBadge badge={badge(kind, `Label for ${kind}`)} />);
      expect(html).toContain(`data-role-badge="${kind}"`);
      expect(html).toContain(`Label for ${kind}`);
    }
  });

  it("gives mentors their ring, in ring ink", () => {
    const html = renderToStaticMarkup(<RoleBadge badge={badge("MENTOR", "Mentor")} />);
    expect(html).toContain('data-person-marker="mentor"');
    expect(html).toContain(CHIP_TONES.ring);
    expect(html).toMatch(/Mentor<\/span>$/);
  });

  it("gives institutions their diamond", () => {
    const html = renderToStaticMarkup(<RoleBadge badge={badge("INSTITUTION", "Institution partner")} />);
    expect(html).toContain('data-person-marker="institution"');
    expect(html).toContain(CHIP_TONES.neutral);
  });

  it("marks Tembo's answers as AI in peach", () => {
    const html = renderToStaticMarkup(<RoleBadge badge={badge("AI", "AI")} />);
    expect(html).toContain(CHIP_TONES.peach);
    expect(html).toContain(">AI<");
  });

  it.each(["COHORT", "ALUMNI", "COMMUNITY", "TA", "INSTRUCTOR", "STAFF", "ADMIN"] as const)(
    "labels %s quietly, with no marker",
    (kind) => {
      const html = renderToStaticMarkup(<RoleBadge badge={badge(kind, "x")} />);
      expect(html).toContain(CHIP_TONES.neutral);
      expect(html).not.toContain("data-person-marker");
    },
  );

  it("spells out TA for screen readers", () => {
    const html = renderToStaticMarkup(<RoleBadge badge={badge("TA", "TA")} />);
    expect(html).toContain('<span aria-hidden="true">TA</span>');
    expect(html).toContain('<span class="sr-only">Teaching assistant</span>');
  });

  it("takes a fixture person's badge as is", () => {
    const html = renderToStaticMarkup(<RoleBadge badge={people.achieng.roleBadges[0]} />);
    expect(html).toContain(">Alumni · Cohort 02<");
  });
});

describe("Chip", () => {
  it.each(Object.entries(CHIP_TONES))("draws the %s tone", (tone, classes) => {
    const html = renderToStaticMarkup(<Chip tone={tone as keyof typeof CHIP_TONES}>D1</Chip>);
    expect(html).toContain(`data-chip="${tone}"`);
    expect(html).toContain(classes);
  });

  it("is a static label, not a control", () => {
    const html = renderToStaticMarkup(<Chip icon={<svg />}>TypeScript</Chip>);
    expect(html).toMatch(/^<span/);
    expect(html).not.toContain("<button");
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("Pill", () => {
  it("is a filter toggle that says whether it is on", () => {
    const on = renderToStaticMarkup(
      <Pill pressed count={3}>
        Needs a decision
      </Pill>,
    );
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain("bg-ink-primary text-dark");
    expect(on).toContain(">3<");
    const off = renderToStaticMarkup(<Pill pressed={false}>Decided</Pill>);
    expect(off).toContain('aria-pressed="false"');
    expect(off).not.toContain("bg-ink-primary text-dark");
  });

  it("is a 44px target on touch screens", () => {
    expect(renderToStaticMarkup(<Pill pressed={false}>Decided</Pill>)).toContain("pointer-coarse:min-h-11");
  });
});

describe("Card", () => {
  it("is a faint lift with a hairline edge, as the element asked for", () => {
    const html = renderToStaticMarkup(
      <Card as="article" aria-labelledby="t">
        x
      </Card>,
    );
    expect(html).toMatch(/^<article aria-labelledby="t" data-card/);
    expect(html).toContain("bg-ink-primary/4");
    expect(html).toContain("border-hairline");
  });
});

describe("TextReaction", () => {
  it("offers the five reactions in words", () => {
    expect(Object.values(REACTIONS)).toEqual(["Useful", "Learned something", "Thanks", "Agree", "Congrats"]);
  });

  it("is a read-only tally without a handler, so it never looks pressable for nothing", () => {
    const html = renderToStaticMarkup(<TextReaction kind="useful" count={6} />);
    expect(html).toMatch(/^<span/);
    expect(html).not.toContain("<button");
    expect(html).toContain('<span aria-hidden="true" class="tabular-nums">· 6</span>');
    expect(html).toContain('<span class="sr-only">, 6 people</span>');
  });

  it("says when you are among the people who reacted", () => {
    const html = renderToStaticMarkup(<TextReaction kind="thanks" count={1} mine />);
    expect(html).toContain('data-mine="true"');
    expect(html).toContain("text-peach-ink");
    expect(html).toContain('<span class="sr-only">, 1 person, including you</span>');
  });

  it("becomes a pressed/unpressed toggle with a handler", () => {
    const onChange = vi.fn();
    const mine = renderToStaticMarkup(<TextReaction kind="agree" count={3} mine onChange={onChange} />);
    expect(mine).toMatch(/^<button type="button" aria-pressed="true"/);
    expect(mine).toContain('<span class="sr-only">, 3 people</span>');
    const theirs = renderToStaticMarkup(<TextReaction kind="agree" count={3} onChange={onChange} />);
    expect(theirs).toContain('aria-pressed="false"');
    expect(theirs).toContain("pointer-coarse:min-h-11");
  });

  it("asks for the membership it wants, never a bare flip", () => {
    const onChange = vi.fn();
    TextReaction({ kind: "congrats", count: 11, onChange }).props.onClick();
    expect(onChange).toHaveBeenLastCalledWith(true);
    TextReaction({ kind: "congrats", count: 12, mine: true, onChange }).props.onClick();
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("names every contract reaction kind", () => {
    expect(Object.keys(REACTIONS).toSorted()).toEqual([...ReactionKind.options].toSorted());
  });

  it("drops the tally at zero but still says so", () => {
    const html = renderToStaticMarkup(<TextReaction kind="agree" count={0} />);
    expect(html).not.toContain("tabular-nums");
    expect(html).toContain(", 0 people");
  });
});
