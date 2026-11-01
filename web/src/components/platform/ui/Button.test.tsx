import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Button, { BUTTON_VARIANTS } from "./Button";
import CountBadge from "./CountBadge";
import IconButton from "./IconButton";

const Icon = () => <svg data-icon="true" />;

describe("Button", () => {
  it("is a non-submitting quiet md button by default", () => {
    const html = renderToStaticMarkup(<Button>Keep</Button>);
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain('data-variant="quiet"');
    expect(html).toContain('data-size="md"');
    expect(html).toContain("h-10");
  });

  it.each(Object.entries(BUTTON_VARIANTS))("draws the %s variant from its own classes", (variant, classes) => {
    const html = renderToStaticMarkup(<Button variant={variant as keyof typeof BUTTON_VARIANTS}>Go</Button>);
    expect(html).toContain(`data-variant="${variant}"`);
    for (const name of classes.split(" ")) expect(html).toContain(name);
  });

  it("uses peach with dark ink for the primary action", () => {
    const html = renderToStaticMarkup(<Button variant="primary">Accept</Button>);
    expect(html).toContain("bg-primary");
    expect(html).toContain("text-dark");
  });

  it("is a small button when asked", () => {
    const html = renderToStaticMarkup(<Button size="sm">Keep</Button>);
    expect(html).toContain('data-size="sm"');
    expect(html).toContain("h-8");
    expect(html).not.toContain("h-10");
  });

  it("grows to a 44px target on touch screens whatever its size", () => {
    for (const size of ["sm", "md"] as const) {
      expect(renderToStaticMarkup(<Button size={size}>Go</Button>)).toContain("pointer-coarse:min-h-11");
    }
  });

  it("hides an icon from assistive tech, so the label is the whole name", () => {
    const html = renderToStaticMarkup(<Button icon={<Icon />}>Accept</Button>);
    expect(html).toMatch(/<span aria-hidden="true"[^>]*><svg data-icon="true"><\/svg><\/span>Accept/);
  });

  it("keeps focus while loading: busy and aria-disabled, never disabled", () => {
    const html = renderToStaticMarkup(
      <Button variant="primary" loading icon={<Icon />}>
        Sending
      </Button>,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toMatch(/\sdisabled=""/);
    expect(html).toContain("data-spinner");
    expect(html).not.toContain("data-icon");
    expect(html).toContain('<span class="sr-only">, working</span>');
  });

  it("only spins the loading mark when motion is welcome", () => {
    const html = renderToStaticMarkup(<Button loading>Saving</Button>);
    expect(html).toContain("motion-safe:animate-spin");
    expect(html).not.toMatch(/(?<!motion-safe:)animate-spin/);
  });

  it("ignores presses while loading", () => {
    const onClick = vi.fn();
    const element = Button({ loading: true, onClick, children: "Send" });
    const preventDefault = vi.fn();
    element.props.onClick({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("passes presses through when settled", () => {
    const onClick = vi.fn();
    const element = Button({ onClick, children: "Send" });
    element.props.onClick({ preventDefault: vi.fn() });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("goes quiet the same way in every variant when disabled", () => {
    const html = renderToStaticMarkup(
      <Button variant="primary" disabled>
        Closed
      </Button>,
    );
    expect(html).toMatch(/\sdisabled=""/);
    expect(html).toContain("text-ink-muted");
    expect(html).not.toContain("bg-primary");
  });

  it("shows a peach focus ring only for keyboard focus", () => {
    const html = renderToStaticMarkup(<Button>Keep</Button>);
    expect(html).toContain("focus-visible:outline-2");
    expect(html).toContain("focus-visible:outline-peach-ink");
  });

  it("drops colour transitions under reduced motion", () => {
    expect(renderToStaticMarkup(<Button>Keep</Button>)).toContain("motion-reduce:transition-none");
  });
});

describe("IconButton", () => {
  it("is named by its required label", () => {
    const html = renderToStaticMarkup(<IconButton label="Search" icon={<Icon />} />);
    expect(html).toContain('aria-label="Search"');
    expect(html).toContain('type="button"');
    expect(html).toMatch(/<span aria-hidden="true"[^>]*><svg/);
  });

  it("refuses a blank label rather than render a nameless button", () => {
    expect(() => renderToStaticMarkup(<IconButton label="  " icon={<Icon />} />)).toThrow(/needs a label/);
  });

  it("folds its badge into the name, because nothing inside an aria-label is read", () => {
    const html = renderToStaticMarkup(
      <IconButton label="Attention" icon={<Icon />} badge={4} badgeLabel="waiting" />,
    );
    expect(html).toContain('aria-label="Attention, 4 waiting"');
    expect(html).toMatch(/<span aria-hidden="true" class="absolute[^"]*">.*>4</);
  });

  it("names an unread dot too", () => {
    const html = renderToStaticMarkup(
      <IconButton label="Attention" icon={<Icon />} badge="dot" badgeLabel="something new" />,
    );
    expect(html).toContain('aria-label="Attention, something new"');
    expect(html).toContain('data-count-badge="dot"');
  });

  it("names the number the badge shows past 99, so the name holds what is visible (WCAG 2.5.3)", () => {
    const html = renderToStaticMarkup(
      <IconButton label="Attention" icon={<Icon />} badge={120} badgeLabel="waiting" />,
    );
    expect(html).toContain('aria-label="Attention, 99+ waiting"');
    expect(html).toMatch(/>99\+</);
  });

  it("reads a detail after the badge, and on its own without one", () => {
    const counted = renderToStaticMarkup(
      <IconButton label="Attention" icon={<Icon />} badge={2} badgeLabel="waiting" detail="1 to confirm" />,
    );
    expect(counted).toContain('aria-label="Attention, 2 waiting, 1 to confirm"');
    const alone = renderToStaticMarkup(<IconButton label="Attention" icon={<Icon />} detail="1 to confirm" />);
    expect(alone).toContain('aria-label="Attention, 1 to confirm"');
    expect(alone).not.toContain("data-count-badge");
  });

  it("shows no badge for zero", () => {
    const html = renderToStaticMarkup(<IconButton label="Attention" icon={<Icon />} badge={0} />);
    expect(html).toContain('aria-label="Attention"');
    expect(html).not.toContain("data-count-badge");
  });

  it("is a toggle only when given a pressed state", () => {
    expect(renderToStaticMarkup(<IconButton label="Pin" icon={<Icon />} />)).not.toContain("aria-pressed");
    const on = renderToStaticMarkup(<IconButton label="Pin" icon={<Icon />} pressed />);
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain("bg-ink-primary text-dark");
    expect(renderToStaticMarkup(<IconButton label="Pin" icon={<Icon />} pressed={false} />)).toContain(
      'aria-pressed="false"',
    );
  });

  it("is a 44px target on touch screens", () => {
    expect(renderToStaticMarkup(<IconButton label="Search" icon={<Icon />} size="sm" />)).toContain(
      "pointer-coarse:size-11",
    );
  });
});

describe("CountBadge", () => {
  it("reads its count with what is counted", () => {
    const html = renderToStaticMarkup(<CountBadge count={3} label="new" />);
    expect(html).toContain('<span aria-hidden="true">3</span>');
    expect(html).toContain('<span class="sr-only">3 new</span>');
  });

  it("caps what it shows but not what it says", () => {
    const html = renderToStaticMarkup(<CountBadge count={120} label="unread" />);
    expect(html).toContain('<span aria-hidden="true">99+</span>');
    expect(html).toContain('<span class="sr-only">120 unread</span>');
  });

  it("respects a custom cap", () => {
    expect(renderToStaticMarkup(<CountBadge count={12} max={9} label="new" />)).toContain(">9+<");
  });

  it.each([0, -2, 0.4, Number.NaN])("renders nothing for %s", (count) => {
    expect(renderToStaticMarkup(<CountBadge count={count} label="new" />)).toBe("");
  });

  it("draws a dot for news without a number, still named", () => {
    const html = renderToStaticMarkup(<CountBadge dot label="new activity" />);
    expect(html).toContain('data-count-badge="dot"');
    expect(html).toContain('<span class="sr-only">new activity</span>');
    expect(html).toContain('aria-hidden="true" class="size-2 rounded-full bg-primary"');
  });
});
