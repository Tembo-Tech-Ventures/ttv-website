import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Card from "./Card";
import Chip from "./Chip";
import Pill from "./Pill";
import RoleBadge, { cohortName } from "./RoleBadge";
import TextReaction, { REACTIONS } from "./TextReaction";
import { CHIP_TONES } from "./tones";

describe("RoleBadge", () => {
  it("writes cohorts as two digits", () => {
    expect(cohortName(4)).toBe("Cohort 04");
    expect(cohortName(12)).toBe("Cohort 12");
    expect(renderToStaticMarkup(<RoleBadge kind="cohort" cohort={4} />)).toContain(">Cohort 04<");
  });

  it("names alumni with or without their cohort", () => {
    expect(renderToStaticMarkup(<RoleBadge kind="alumni" cohort={2} />)).toContain(">Alumni · Cohort 02<");
    expect(renderToStaticMarkup(<RoleBadge kind="alumni" />)).toContain(">Alumni<");
  });

  it("gives mentors their ring, in ring ink", () => {
    const html = renderToStaticMarkup(<RoleBadge kind="mentor" />);
    expect(html).toContain('data-person-marker="mentor"');
    expect(html).toContain(CHIP_TONES.ring);
    expect(html).toMatch(/Mentor<\/span>$/);
  });

  it("spells out TA for screen readers", () => {
    const html = renderToStaticMarkup(<RoleBadge kind="ta" />);
    expect(html).toContain('<span aria-hidden="true">TA</span>');
    expect(html).toContain('<span class="sr-only">Teaching assistant</span>');
  });

  it("marks Tembo's answers as AI in peach", () => {
    const html = renderToStaticMarkup(<RoleBadge kind="ai" />);
    expect(html).toContain(CHIP_TONES.peach);
    expect(html).toContain(">AI<");
  });

  it("labels staff in the neutral tone", () => {
    const html = renderToStaticMarkup(<RoleBadge kind="staff" />);
    expect(html).toContain(CHIP_TONES.neutral);
    expect(html).toContain('data-role-badge="staff"');
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
    const onToggle = vi.fn();
    const mine = renderToStaticMarkup(<TextReaction kind="agree" count={3} mine onToggle={onToggle} />);
    expect(mine).toMatch(/^<button type="button" aria-pressed="true"/);
    expect(mine).toContain('<span class="sr-only">, 3 people</span>');
    const theirs = renderToStaticMarkup(<TextReaction kind="agree" count={3} onToggle={onToggle} />);
    expect(theirs).toContain('aria-pressed="false"');
    expect(theirs).toContain("pointer-coarse:min-h-11");
  });

  it("calls its handler when pressed", () => {
    const onToggle = vi.fn();
    const element = TextReaction({ kind: "congrats", count: 11, onToggle });
    element.props.onClick();
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("drops the tally at zero but still says so", () => {
    const html = renderToStaticMarkup(<TextReaction kind="agree" count={0} />);
    expect(html).not.toContain("tabular-nums");
    expect(html).toContain(", 0 people");
  });
});
