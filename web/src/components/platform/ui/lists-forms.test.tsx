import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DataList, { DataListItem } from "./DataList";
import DataTable, { DataCell, DataRow, DataSelectCell, RowAction } from "./DataTable";
import { ChoiceCard, ChoiceGroup, FileField, PrefixField } from "./Field";
import Pager from "./Pager";

const columns = [{ label: "Name" }, { label: "Joined", align: "end" as const }, { label: "Actions", hidden: true }];

describe("DataTable", () => {
  const table = () =>
    renderToStaticMarkup(
      <DataTable caption="Users" columns={columns}>
        <DataRow>
          <DataCell label="Name" primary>
            <a href="/admin/users/u1">Wanjiku Mwangi</a>
          </DataCell>
          <DataCell label="Joined" align="end">
            3 Nov
          </DataCell>
          <DataCell label="">
            <RowAction href="/admin/users/u1" row="Wanjiku Mwangi">
              Open
            </RowAction>
          </DataCell>
        </DataRow>
      </DataTable>,
    );

  it("is a captioned table with its roles spelled out, so it stays a table when it stacks", () => {
    const html = table();
    expect(html).toContain('<table role="table"');
    expect(html).toContain('<caption class="sr-only">Users</caption>');
    expect(html).toContain('<thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col"');
    expect(html).toContain('<tr role="row" class="kit-table__row');
    expect(html.match(/<td role="cell"/g)).toHaveLength(3);
  });

  it("says each header in sentence case, aligns numbers to the end, and names a hidden column for screen readers", () => {
    const html = table();
    expect(html).toMatch(/<th[^>]*text-left[^>]*>Name<\/th>/);
    expect(html).toMatch(/<th[^>]*text-right[^>]*>Joined<\/th>/);
    expect(html).toMatch(/<th[^>]*><span class="sr-only">Actions<\/span><\/th>/);
    expect(html).not.toMatch(/\buppercase\b|tracking-/);
  });

  it("gives every cell its column's name for the stacked layout, and marks the one that names the row", () => {
    const html = table();
    expect(html).toContain('data-label="Name" data-primary="true"');
    expect(html).toContain('data-label="Joined"');
  });

  it("passes a row's own attributes through, such as a data attribute a test or script finds it by", () => {
    const html = renderToStaticMarkup(
      <DataRow data-application-status="PENDING">
        <DataCell label="Name">Wanjiku</DataCell>
      </DataRow>,
    );
    expect(html).toMatch(/^<tr data-application-status="PENDING" role="row"/);
  });

  it("names a row's action by its row, quietly", () => {
    const html = renderToStaticMarkup(
      <RowAction href="/x" row="Wanjiku Mwangi">
        Open
      </RowAction>,
    );
    expect(html).toMatch(/^<a href="\/x" data-row-action="true" class="[^"]*h-8[^"]*">Open<span class="sr-only"> Wanjiku Mwangi<\/span><\/a>$/);
    expect(html).not.toContain("bg-primary");
  });

  it("names a selection box by its row and lets it submit with a form elsewhere", () => {
    const html = renderToStaticMarkup(<DataSelectCell name="ids" value="a1" row="Wanjiku Mwangi" form="bulk" />);
    expect(html).toMatch(/<input type="checkbox" name="ids" form="bulk" aria-label="Select Wanjiku Mwangi" class="kit-choice [^"]*" value="a1"\/>/);
  });

  it("gives way to its empty state when there are no rows", () => {
    const html = renderToStaticMarkup(<DataTable caption="Users" columns={columns} isEmpty empty={<p>No people yet</p>} />);
    expect(html).toBe("<p>No people yet</p>");
  });
});

describe("DataList", () => {
  it("is a named list whose items are headings that link, with facts, a status and actions", () => {
    const html = renderToStaticMarkup(
      <DataList label="Feedback notes">
        <DataListItem title="Slow on my phone" href="/admin/feedback/f1" meta="Wanjiku · 3 Nov" status={<span data-chip="peach">New</span>} actions={<a href="/r">Reply</a>}>
          It takes a while.
        </DataListItem>
      </DataList>,
    );
    expect(html).toMatch(/^<ul aria-label="Feedback notes" data-data-list="true"/);
    expect(html).toMatch(/<h3[^>]*><a href="\/admin\/feedback\/f1"[^>]*>Slow on my phone<\/a><\/h3><span data-chip="peach">New<\/span>/);
    expect(html).toContain("Wanjiku · 3 Nov");
    expect(html).toContain("It takes a while.");
    expect(html).toContain('<a href="/r">Reply</a>');
  });

  it("fits the page's outline and gives way to its empty state", () => {
    expect(renderToStaticMarkup(<DataListItem title="Slow" headingLevel={2} />)).toContain("<h2");
    expect(renderToStaticMarkup(<DataList label="Notes" isEmpty empty={<p>None</p>} />)).toBe("<p>None</p>");
  });
});

describe("Pager", () => {
  it("links to the pages either side, says where the reader is, and leaves out an end rather than disabling it", () => {
    const html = renderToStaticMarkup(<Pager previousHref="/a?page=1" nextHref={null} summary="21–40 of 133" />);
    expect(html).toMatch(/^<nav aria-label="Pages" data-pager="true"/);
    expect(html).toContain('<a rel="prev" href="/a?page=1"');
    expect(html).not.toContain("Next");
    expect(html).toContain("21–40 of 133");
  });

  it("draws nothing for a list that fits on one page", () => {
    expect(renderToStaticMarkup(<Pager />)).toBe("");
  });

  it("goes back to the first page of a list paged by cursor, never to a guessed previous one", () => {
    const html = renderToStaticMarkup(<Pager firstHref="/members" nextHref="/members?cursor=c" summary="25–48 of 57" label="More members" />);
    expect(html).toMatch(/^<nav aria-label="More members" data-pager="true"/);
    expect(/<a [^>]*rel="first"[^>]*>/.exec(html)?.[0]).toContain('href="/members"');
    expect(/<a [^>]*rel="next"[^>]*>/.exec(html)?.[0]).toContain('href="/members?cursor=c"');
    expect(html).toContain(">First page<");
    expect(html).not.toContain("Previous");
    expect(renderToStaticMarkup(<Pager firstHref="/members" />)).toContain('rel="first"');
  });
});

describe("FileField", () => {
  it("is the browser's own picker, labelled, with its button drawn quiet and a 44px target", () => {
    const html = renderToStaticMarkup(<FileField name="recording" label="Recording" hint="An MP4, up to 2 GB." accept="video/mp4" required />);
    expect(html).toMatch(/<label for="recording"[^>]*>Recording<\/label>/);
    expect(html).toMatch(/<input accept="video\/mp4" required="" aria-describedby="recording-hint" id="recording" name="recording" type="file" class="[^"]*min-h-11[^"]*file:bg-ink-primary\/6/);
  });
});

describe("PrefixField", () => {
  it("shows its fixed start before the control and reads it with the field, without sending it", () => {
    const html = renderToStaticMarkup(<PrefixField name="handle" label="Your public address" prefix="tembotechventures.com/talent/" defaultValue="wanjiku" />);
    expect(html).toContain('<span id="handle-prefix" data-prefix="true"');
    expect(html).toContain('aria-describedby="handle-prefix"');
    expect(html).toMatch(/<input[^>]*name="handle"[^>]*value="wanjiku"/);
    expect(html).not.toMatch(/value="tembotechventures/);
  });
});

describe("ChoiceCard", () => {
  it("is one large label around its box, chosen by its box as well as its colour", () => {
    const html = renderToStaticMarkup(<ChoiceCard name="intent" value="mentor" label="Mentoring" hint="Give time." defaultChecked />);
    expect(html).toMatch(/^<label for="intent-mentor" data-choice-card="radio" class="[^"]*has-checked:border-peach-ink/);
    expect(html).toContain('type="radio" class="kit-choice');
    expect(html).toContain('checked=""');
  });

  it("keeps its hint at 4.5:1 on its tint, in the secondary ink", () => {
    const html = renderToStaticMarkup(<ChoiceCard name="intent" value="mentor" label="Mentoring" hint="Give time." />);
    expect(html).toMatch(/<p id="intent-mentor-hint" class="[^"]*text-ink-secondary[^"]*">Give time.<\/p>/);
    expect(html).not.toContain("text-ink-muted");
  });

  it("is named by its title alone, and described by its hint and detail", () => {
    const html = renderToStaticMarkup(
      <ChoiceCard type="checkbox" name="intent" value="mentor" label="Mentor" hint="Review shared work." detail={<span>Needs team approval</span>} />,
    );
    expect(html).toContain('aria-labelledby="intent-mentor-label"');
    expect(html).toMatch(/<span id="intent-mentor-label"[^>]*>Mentor<\/span>/);
    expect(html).toContain('aria-describedby="intent-mentor-detail intent-mentor-hint"');
    expect(html).toMatch(/<span id="intent-mentor-detail"[^>]*><span>Needs team approval<\/span><\/span>/);
  });

  it("sets a mark beside its words, hidden from assistive tech", () => {
    const html = renderToStaticMarkup(<ChoiceCard name="intent" value="mentor" label="Mentor" mark={<i data-mark />} />);
    expect(html).toMatch(/<span aria-hidden="true" class="inline-flex shrink-0"><i data-mark="true"><\/i><\/span>/);
    expect(renderToStaticMarkup(<ChoiceCard name="intent" value="mentor" label="Mentor" />)).not.toContain('<span aria-hidden="true" class="inline-flex shrink-0">');
  });

  it("lays a ChoiceGroup out as cards, two to a row from 40rem", () => {
    const html = renderToStaticMarkup(
      <ChoiceGroup name="intent" label="How will you take part?" appearance="cards" options={[{ value: "cohort", label: "In a cohort" }, { value: "mentor", label: "Mentoring" }]} />,
    );
    expect(html).toContain("grid gap-3 sm:grid-cols-2");
    expect(html.match(/data-choice-card="radio"/g)).toHaveLength(2);
  });
});

describe("filled", () => {
  it("treats nothing, an empty string and an empty Astro slot as empty, and anything else as there", async () => {
    const { createElement } = await import("react");
    const { filled } = await import("./slot");
    const Slot = (props: { value: unknown }) => createElement("astro-slot", null, String(props.value));
    for (const empty of [null, undefined, false, "", createElement(Slot, { value: "" }), createElement(Slot, { value: new String("  \n ") })]) {
      expect.soft(filled(empty)).toBe(false);
    }
    for (const something of ["Save", 0, createElement("a", { href: "/x" }), createElement(Slot, { value: new String("<a>Go</a>") })]) {
      expect.soft(filled(something)).toBe(true);
    }
  });
});

describe("SelectField with groups", () => {
  it("sets options under their heading, and leaves out an empty group", async () => {
    const { SelectField } = await import("./Field");
    const html = renderToStaticMarkup(
      <SelectField
        name="person"
        label="Person"
        placeholder="Choose a person"
        options={[
          { group: "Community mentors", options: [{ value: "u1", label: "David Kamau" }] },
          { group: "Everyone else", options: [] },
          { value: "u2", label: "Lucy Chebet" },
        ]}
      />,
    );
    expect(html).toContain('<option value="">Choose a person</option><optgroup label="Community mentors"><option value="u1">David Kamau</option></optgroup><option value="u2">Lucy Chebet</option>');
    expect(html).not.toContain("Everyone else");
  });
});

describe("ConfirmStep with a selection", () => {
  it("repeats a field's name for each value, so a confirmed selection posts every row", async () => {
    const { default: ConfirmStep } = await import("./ConfirmStep");
    const html = renderToStaticMarkup(
      <ConfirmStep title="Complete 2 applications?" confirmLabel="Complete 2 applications" cancelHref="/x" fields={{ action: "bulk-complete", applicationIds: ["a1", "a2"] }} focusOnLoad={false} />,
    );
    expect(html).toContain('<input type="hidden" name="action" value="bulk-complete"/><input type="hidden" name="applicationIds" value="a1"/><input type="hidden" name="applicationIds" value="a2"/>');
  });
});
