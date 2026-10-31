import { forwardRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Button, { buttonClasses } from "./Button";
import CountBadge, { formatCount } from "./CountBadge";
import IconButton, { iconButtonName } from "./IconButton";

const html = renderToStaticMarkup;

describe("Button", () => {
  it("is a plain button by default, so it never submits a form by accident", () => {
    const markup = html(<Button>Save</Button>);
    expect(markup).toContain('type="button"');
    expect(markup).toContain('data-variant="quiet"');
  });

  it("still submits when asked to", () => {
    expect(html(<Button type="submit">Save</Button>)).toContain('type="submit"');
  });

  it.each([
    ["primary", "bg-primary text-dark"],
    ["quiet", "bg-ink-primary/7 text-ink-primary"],
    ["ghost", "bg-transparent text-sheet-ink-secondary"],
    ["danger", "bg-danger-ink/7"],
  ] as const)("draws the %s variant from brand tokens", (variant, classes) => {
    expect(html(<Button variant={variant}>Go</Button>)).toContain(classes);
  });

  it.each([
    ["sm", "h-8"],
    ["md", "h-[38px]"],
  ] as const)("draws the %s size and still grows to 44px under a finger", (size, height) => {
    const markup = html(<Button size={size}>Go</Button>);
    expect(markup).toContain(height);
    expect(markup).toContain("pointer-coarse:min-h-11");
  });

  it("hides its icon from screen readers, so the label is the whole name", () => {
    const markup = html(<Button icon={<svg data-icon="" />}>Share project</Button>);
    expect(markup).toMatch(/<span aria-hidden="true"[^>]*><svg data-icon=""/);
    expect(markup).toContain("Share project");
  });

  it("while loading, is busy and disabled, shows a spinner instead of the icon, and keeps its label", () => {
    const markup = html(
      <Button loading icon={<svg data-icon="" />}>
        Sending
      </Button>
    );
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("data-spinner");
    expect(markup).not.toContain("data-icon");
    expect(markup).toContain("Sending");
  });

  it("keeps a loading button in full colour; only truly unavailable ones fade", () => {
    expect(buttonClasses()).toContain("disabled:not-aria-busy:opacity-55");
  });

  it("stops the spinner turning when the reader prefers less motion", () => {
    const markup = html(<Button loading>Sending</Button>);
    expect(markup).toContain("motion-safe:animate-spin");
    expect(markup).not.toMatch(/(?<!motion-safe:)animate-spin/);
  });

  it("shows a visible focus ring", () => {
    expect(buttonClasses("primary")).toContain("focus-visible:outline-primary");
  });

  it("is not busy when not loading", () => {
    expect(html(<Button>Go</Button>)).not.toContain('aria-busy="');
  });

  it("lends its look to links", () => {
    expect(buttonClasses("primary", "sm")).toContain("bg-primary");
    expect(buttonClasses("primary", "sm")).toContain("h-8");
  });
});

describe("CountBadge", () => {
  it.each([
    [0, "0"],
    [7, "7"],
    [99, "99"],
    [100, "99+"],
    [3.7, "3"],
    [-2, "0"],
    [Number.NaN, "0"],
    [Number.POSITIVE_INFINITY, "0"],
  ])("formats %s as %s", (count, shown) => {
    expect(formatCount(count)).toBe(shown);
  });

  it("renders nothing for zero", () => {
    expect(html(<CountBadge count={0} />)).toBe("");
  });

  it("hides the bare number and speaks a sentence instead", () => {
    const markup = html(<CountBadge count={2} />);
    expect(markup).toMatch(/<span aria-hidden="true"[^>]*>2<\/span>/);
    expect(markup).toContain('<span class="sr-only">2 new</span>');
  });

  it("takes a custom spoken label", () => {
    expect(html(<CountBadge count={12} label="12 messages" />)).toContain(">12 messages<");
  });

  it("caps long counts for the eye and the ear alike", () => {
    const markup = html(<CountBadge count={140} />);
    expect(markup).toContain(">99+<");
    expect(markup).toContain(">99+ new<");
  });

  it("has a dot variant that says Unread", () => {
    const markup = html(<CountBadge variant="dot" />);
    expect(markup).toContain('data-count-badge="dot"');
    expect(markup).toContain(">Unread<");
  });

  it("styles only the glyph, so hiding it never silences the label", () => {
    const markup = html(<CountBadge count={3} className="hidden" />);
    expect(markup).toMatch(/<span aria-hidden="true" class="[^"]*hidden"/);
    expect(markup).toContain('<span class="sr-only">3 new</span>');
  });

  it("has a quiet tone without a fill", () => {
    const markup = html(<CountBadge count={12} tone="quiet" />);
    expect(markup).toContain("text-sheet-ink-muted");
    expect(markup).not.toContain("bg-primary");
  });
});

describe("IconButton", () => {
  const icon = <svg data-icon="" />;

  it("is named by its required label", () => {
    const markup = html(<IconButton label="Search" icon={icon} />);
    expect(markup).toContain('aria-label="Search"');
    expect(markup).toContain('title="Search"');
    expect(markup).toContain('type="button"');
  });

  it("refuses a blank label rather than render an unnamed button", () => {
    expect(() => html(<IconButton label="  " icon={icon} />)).toThrow(TypeError);
  });

  it("folds the corner count into its name and hides the drawn number", () => {
    const markup = html(<IconButton label="Attention" icon={icon} count={4} countNoun="waiting" />);
    expect(markup).toContain('aria-label="Attention, 4 waiting"');
    expect(markup).toMatch(/<span aria-hidden="true" data-corner="count"[^>]*>4<\/span>/);
  });

  it("names an unread dot", () => {
    const markup = html(<IconButton label="Thread" icon={icon} unread />);
    expect(markup).toContain('aria-label="Thread, unread"');
    expect(markup).toContain('data-corner="dot"');
  });

  it("prefers the count when both are given, and shows nothing for zero", () => {
    expect(iconButtonName("Bell", { count: 2, unread: true })).toBe("Bell, 2 new");
    expect(iconButtonName("Bell", { count: 0 })).toBe("Bell");
    expect(html(<IconButton label="Bell" icon={icon} count={0} />)).not.toContain("data-corner");
  });

  it("reports a toggle's state and turns warm white when pressed", () => {
    const pressed = html(<IconButton label="Members" icon={icon} pressed />);
    expect(pressed).toContain('aria-pressed="true"');
    expect(pressed).toContain("bg-ink-primary text-dark");
    expect(html(<IconButton label="Members" icon={icon} pressed={false} />)).toContain('aria-pressed="false"');
    expect(html(<IconButton label="Search" icon={icon} />)).not.toContain("aria-pressed");
  });

  it("is 44px square under a finger and keeps its icon out of the name", () => {
    const markup = html(<IconButton label="Search" icon={icon} />);
    expect(markup).toContain("pointer-coarse:min-h-11 pointer-coarse:min-w-11");
    expect(markup).toMatch(/<span aria-hidden="true" class="inline-flex"><svg data-icon=""/);
  });

  it("keeps a caller's tooltip", () => {
    expect(html(<IconButton label="Search" title="Search (Ctrl K)" icon={icon} />)).toContain(
      'title="Search (Ctrl K)"'
    );
  });
});

describe("icon slots", () => {
  function Glyph() {
    return <svg data-glyph="" />;
  }

  it("take an element, as React code passes them", () => {
    expect(html(<Button icon={<Glyph />}>Go</Button>)).toContain("data-glyph");
  });

  it("take a component, as Astro pages must pass them", () => {
    expect(html(<Button icon={Glyph}>Go</Button>)).toContain("data-glyph");
    expect(html(<IconButton label="Go" icon={Glyph} />)).toContain("data-glyph");
  });

  it("take a forwardRef icon, the shape Phosphor exports", () => {
    const Forwarded = forwardRef<SVGSVGElement>(function Forwarded(_props, ref) {
      return <svg ref={ref} data-forwarded="" />;
    });
    expect(html(<Button icon={Forwarded}>Go</Button>)).toContain("data-forwarded");
  });

  it("render nothing at all when empty", () => {
    expect(html(<Button>Go</Button>)).not.toContain("aria-hidden");
  });
});
