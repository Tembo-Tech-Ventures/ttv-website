import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BackLink from "./BackLink";
import { confirmHref, confirmingAction, withoutConfirm } from "./confirm";
import ConfirmStep from "./ConfirmStep";
import DescriptionList, { DescriptionItem } from "./DescriptionList";
import { linkClass } from "./recipes";
import StatusChip from "./StatusChip";

describe("BackLink", () => {
  it("is a plain link up to the list, its arrow hidden, quiet and a 44px target on touch", () => {
    const html = renderToStaticMarkup(<BackLink href="/admin/programs">Cohorts</BackLink>);
    expect(html).toMatch(/^<a href="\/admin\/programs" data-back-link="true" class="[^"]*text-ink-secondary[^"]*pointer-coarse:min-h-11[^"]*focus-visible:outline-peach-ink[^"]*">/);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("<span>Cohorts</span>");
    expect(html).not.toContain("text-primary");
  });

  it("stays above a title's overhanging line box, so a press on it is never the title's", () => {
    expect(renderToStaticMarkup(<BackLink href="/admin">Admin</BackLink>)).toMatch(/class="relative /);
  });
});

describe("linkClass", () => {
  it("is ink and underlined, never peach, with the kit's focus ring", () => {
    const classes = linkClass("ml-1");
    expect(classes).toContain("text-ink-primary");
    expect(classes).toContain("underline");
    expect(classes).toContain("focus-visible:outline-peach-ink");
    expect(classes).toMatch(/ ml-1$/);
    expect(classes).not.toMatch(/\btext-(primary|peach-ink)\b/);
  });
});

describe("DescriptionList", () => {
  it("is a real dl whose every fact is read with its name, from items or children", () => {
    const html = renderToStaticMarkup(
      <DescriptionList items={[{ term: "Applied", detail: "3 Nov" }]}>
        <DescriptionItem term="Cohort">
          <a href="/admin/programs/c5">Cohort 05</a>
        </DescriptionItem>
      </DescriptionList>,
    );
    expect(html).toMatch(/^<dl data-description-list="true"/);
    expect(html.match(/<div data-description-item="true"[^>]*><dt[^>]*>[^<]+<\/dt><dd[^>]*>/g)).toHaveLength(2);
    expect(html.indexOf("Applied")).toBeLessThan(html.indexOf("Cohort 05"));
  });

  it("stacks on a phone, sets the name beside the fact from 40rem, and wraps a long fact", () => {
    const html = renderToStaticMarkup(<DescriptionItem term="Email">a-very-long-address@invalid.ttv</DescriptionItem>);
    expect(html).toContain("sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]");
    expect(html).toContain("break-words");
  });
});

describe("StatusChip", () => {
  it("says a status by its one name, in its tone", () => {
    expect(renderToStaticMarkup(<StatusChip domain="application" status="APPROVED" />)).toMatch(
      /^<span data-chip="success"[^>]*><span class="truncate"><span data-status="APPROVED">Accepted<\/span><\/span><\/span>$/,
    );
    expect(renderToStaticMarkup(<StatusChip domain="recording" status="failed" />)).toContain('data-chip="danger"');
    expect(renderToStaticMarkup(<StatusChip domain="feedback" status="NEW" />)).toContain(">New<");
  });
});

describe("ConfirmStep", () => {
  const render = () =>
    renderToStaticMarkup(
      <ConfirmStep title="Remove David Kamau from Cohort 05?" confirmLabel="Remove from cohort" cancelHref="/admin/programs/c5" action="/admin/programs/c5" fields={{ intent: "remove-mentor", userId: "u2" }}>
        He loses the cohort's channels. You can add him again.
      </ConfirmStep>,
    );

  it("is a warning that takes focus, then a form that posts the hidden fields", () => {
    const html = render();
    expect(html).toMatch(/^<div data-confirm-step="true"[^>]*><div autofocus="" tabindex="-1" role="region" aria-label="Remove David Kamau from Cohort 05\?" data-notice="warning"/);
    expect(html).toContain('<form method="post" action="/admin/programs/c5" class="flex flex-wrap gap-2">');
    expect(html).toContain('<input type="hidden" name="intent" value="remove-mentor"/><input type="hidden" name="userId" value="u2"/>');
  });

  it("keeps its buttons off the warning tint, where a hovered danger button would not clear 4.5:1", () => {
    const notice = /<div autofocus=""[\s\S]*?<\/div><\/div><\/div>/.exec(render())?.[0] ?? "";
    expect(notice).not.toBe("");
    expect(notice).toContain("He loses the cohort");
    expect(notice).not.toContain("<form");
    expect(notice).not.toContain("<button");
  });

  it("offers one danger submit that says what happens, then a ghost Cancel link", () => {
    const html = render();
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html).toMatch(/data-variant="danger"[^>]*>Remove from cohort<\/button><a href="\/admin\/programs\/c5" data-variant="ghost"[^>]*>Cancel<\/a>/);
    expect(html).not.toContain("bg-primary");
  });
});

describe("the confirm step's address", () => {
  const page = new URL("https://ttv.invalid/admin/programs/c5?tab=staff#roster");

  it("asks with ?confirm=, keeping the page's other parameters and dropping the fragment", () => {
    expect(confirmHref(page, "remove-mentor")).toBe("/admin/programs/c5?tab=staff&confirm=remove-mentor");
  });

  it("only answers to an action the page offers", () => {
    const asking = new URL("https://ttv.invalid/admin/programs/c5?confirm=remove-mentor");
    expect(confirmingAction(asking, ["remove-mentor", "archive"] as const)).toBe("remove-mentor");
    expect(confirmingAction(asking, ["archive"] as const)).toBeNull();
    expect(confirmingAction(page, ["remove-mentor"] as const)).toBeNull();
  });

  it("cancels back to the same page without the step", () => {
    expect(withoutConfirm(new URL("https://ttv.invalid/admin/programs/c5?confirm=archive&tab=staff"))).toBe("/admin/programs/c5?tab=staff");
  });
});
