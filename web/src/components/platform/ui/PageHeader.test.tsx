import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Button from "./Button";
import PageHeader from "./PageHeader";
import PageTitle from "./PageTitle";

describe("PageTitle", () => {
  it("is the page's h1 in Mattone at 36–60px, wrapping instead of overflowing", () => {
    const html = renderToStaticMarkup(<PageTitle id="title">Mentor requests</PageTitle>);
    expect(html).toMatch(/^<h1 id="title" data-page-title="true" class="[^"]+">Mentor requests<\/h1>$/);
    // The room above and below is more than Mattone overhangs a 1.1 line box, which a browser hit-tests.
    for (const name of ["my-[0.2em]", "font-heading", "leading-[1.1]", "tracking-heading", "text-[clamp(1.75rem,9vw,2.25rem)]", "sm:text-5xl", "lg:text-6xl", "wrap-anywhere", "text-balance", "text-ink-primary"]) {
      expect(html).toContain(name);
    }
  });

  it("is a paragraph only when shown as an example, so a guide page keeps one h1", () => {
    expect(renderToStaticMarkup(<PageTitle as="p">Mentor requests</PageTitle>)).toMatch(/^<p data-page-title="true"/);
  });
});

describe("PageHeader", () => {
  it("puts the title, then the sentence, then the one action", () => {
    const html = renderToStaticMarkup(
      <PageHeader title="Programs" titleId="programs-title" action={<Button variant="primary">New program</Button>}>
        Every cohort, past and running.
      </PageHeader>,
    );
    expect(html).toMatch(/^<header data-page-header="true"/);
    expect(html).toContain('<h1 id="programs-title" data-page-title="true"');
    const order = ["Programs</h1>", "Every cohort, past and running.", "data-page-action", "New program"].map((part) => html.indexOf(part));
    expect(order.every((index) => index !== -1)).toBe(true);
    expect(order.toSorted((a, b) => a - b)).toEqual(order);
  });

  it("draws no empty boxes for a missing sentence or action", () => {
    const html = renderToStaticMarkup(<PageHeader title="Attention" />);
    expect(html).not.toContain("data-page-action");
    expect(html).not.toContain("text-ink-secondary");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });

  it("stacks on a phone and sets the action beside the title from 40rem", () => {
    const html = renderToStaticMarkup(<PageHeader title="Users" action={<Button>Export</Button>} />);
    expect(html).toContain("flex-col");
    expect(html).toContain("sm:flex-row");
  });

  it("passes titleAs through for the style guide's example", () => {
    expect(renderToStaticMarkup(<PageHeader title="Users" titleAs="p" />)).not.toContain("<h1");
  });
});
