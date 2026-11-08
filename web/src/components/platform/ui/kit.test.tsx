// @vitest-environment happy-dom
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ButtonLink from "./ButtonLink";
import EmptyState from "./EmptyState";
import * as kit from "./index";
import Notice from "./Notice";
import Pill from "./Pill";
import PillNav from "./PillNav";
import { BUTTON_SIZES, BUTTON_VARIANTS, buttonClass, pillClass } from "./recipes";
import TabFile, { type FileTab } from "./TabFile";

const dom = (html: string) => {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
};

describe("buttonClass", () => {
  it("draws every variant and size from the same recipe Button uses", () => {
    for (const [variant, classes] of Object.entries(BUTTON_VARIANTS)) {
      for (const [size, sized] of Object.entries(BUTTON_SIZES)) {
        const out = buttonClass({ variant: variant as keyof typeof BUTTON_VARIANTS, size: size as keyof typeof BUTTON_SIZES });
        for (const name of `${classes} ${sized}`.split(" ")) expect(out).toContain(name);
        expect(out).toContain("focus-visible:outline-peach-ink");
        expect(out).toContain("pointer-coarse:min-h-11");
      }
    }
  });

  it("goes quiet the same way for every variant when disabled", () => {
    expect(buttonClass({ variant: "primary", disabled: true })).not.toContain("bg-primary");
    expect(buttonClass({ variant: "danger", disabled: true })).toContain("text-ink-muted");
  });

  it("makes lg a 44px target on every pointer", () => {
    expect(buttonClass({ size: "lg" })).toContain("h-11");
  });
});

describe("ButtonLink", () => {
  it("is a real link that looks like a button", () => {
    const html = renderToStaticMarkup(
      <ButtonLink href="/dashboard/mentoring" variant="primary" icon={<svg />} trailingIcon={<svg />}>
        Open Mentoring
      </ButtonLink>,
    );
    expect(html).toMatch(/^<a href="\/dashboard\/mentoring" data-variant="primary"/);
    expect(html).toContain("bg-primary");
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(2);
    expect(html).toContain("Open Mentoring");
  });

  it("passes link attributes through", () => {
    expect(renderToStaticMarkup(<ButtonLink href="/x" rel="noopener" target="_blank">Go</ButtonLink>)).toContain('rel="noopener" target="_blank"');
  });
});

describe("Pill", () => {
  it("is a toggle drawn from pillClass, pressed or not", () => {
    const root = dom(renderToStaticMarkup(<><Pill pressed>All</Pill><Pill pressed={false} count={2}>Requests</Pill></>));
    const [on, off] = [...root.querySelectorAll("button")];
    expect([on.getAttribute("aria-pressed"), off.getAttribute("aria-pressed")]).toEqual(["true", "false"]);
    expect([on.className, off.className]).toEqual([pillClass(true), pillClass(false)]);
    expect(off.textContent).toBe("Requests2");
  });

  it("hands its ref to the button, so a dialog can focus the filter that is on", async () => {
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const ref = createRef<HTMLButtonElement>();
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<Pill ref={ref} pressed data-filter="all">All</Pill>));
    expect(ref.current?.tagName).toBe("BUTTON");
    expect(ref.current?.dataset.filter).toBe("all");
    await act(async () => root.unmount());
  });
});

describe("PillNav", () => {
  const items = [
    { label: "Needs a decision", href: "/admin/moderation", current: true, count: 3 },
    { label: "Decided", href: "/admin/moderation?state=DECIDED", count: 0 },
  ];

  it("is a named list of links with the current view marked as the page", () => {
    const root = dom(renderToStaticMarkup(<PillNav label="Moderation lists" items={items} />));
    expect(root.querySelector("nav")!.getAttribute("aria-label")).toBe("Moderation lists");
    const links = [...root.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual(["page", null]);
    expect(links[0].className).toBe(pillClass(true));
    expect(links[1].className).toBe(pillClass(false));
  });

  it("reads a count with what it counts, and shows nothing for zero", () => {
    const links = [...dom(renderToStaticMarkup(<PillNav label="Lists" items={items} />)).querySelectorAll("a")];
    expect(links[0].textContent).toBe("Needs a decision3 3 waiting");
    expect(links[1].textContent).toBe("Decided");
  });

  it("refuses two current views", () => {
    expect(() => renderToStaticMarkup(<PillNav label="Lists" items={items.map((item) => ({ ...item, current: true }))} />)).toThrow(/at most one/);
  });
});

describe("Notice", () => {
  it("interrupts for a failure and waits its turn for a confirmation", () => {
    expect(renderToStaticMarkup(<Notice tone="danger" title="We couldn't send that" />)).toContain('role="alert"');
    expect(renderToStaticMarkup(<Notice tone="success">Saved.</Notice>)).toContain('role="status"');
  });

  it("is simply part of the page for information and cautions", () => {
    for (const tone of ["info", "warning"] as const) {
      expect(renderToStaticMarkup(<Notice tone={tone}>Read-only.</Notice>)).not.toContain("role=");
    }
  });

  it("lets a page choose how it is announced", () => {
    expect(renderToStaticMarkup(<Notice tone="info" announce="polite">Loading more.</Notice>)).toContain('role="status"');
    expect(renderToStaticMarkup(<Notice tone="danger" announce="none">Earlier failure.</Notice>)).not.toContain("role=");
  });

  it("says its tone in words, so the icon's colour is never the only signal", () => {
    const root = dom(renderToStaticMarkup(<Notice tone="warning" title="This can't be undone" />));
    expect(root.querySelector(".sr-only")!.textContent).toBe("Warning: ");
    expect(root.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("can take focus after a rejected submit, with the focus ring", () => {
    const html = renderToStaticMarkup(<Notice tone="danger" id="form-error" tabIndex={-1} title="Check two fields" />);
    expect(html).toContain('id="form-error" tabindex="-1"');
    expect(html).toContain("focus-visible:outline-peach-ink");
  });

  it("lands focus on a rejected submit's notice without any script", () => {
    const html = renderToStaticMarkup(<Notice tone="danger" focusOnLoad title="Two things to fix" />);
    expect(html).toContain('autofocus=""');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("focus-visible:outline-peach-ink");
  });

  it("writes body words in the secondary ink under a title, and primary without one", () => {
    expect(renderToStaticMarkup(<Notice title="T">Body</Notice>)).toContain('text-ink-secondary">Body');
    expect(renderToStaticMarkup(<Notice>Body</Notice>)).toContain('text-ink-primary">Body');
  });
});

describe("EmptyState", () => {
  it("says what belongs here, at the heading level the page needs", () => {
    const root = dom(
      renderToStaticMarkup(
        <EmptyState title="No requests yet" headingLevel={2} mark={<span>m</span>} action={<a href="/x">Find a mentor</a>}>
          Requests you send appear here.
        </EmptyState>,
      ),
    );
    expect(root.querySelector("h2")!.textContent).toBe("No requests yet");
    expect(root.querySelector("[aria-hidden=true]")!.textContent).toBe("m");
    expect(root.querySelector("a")!.textContent).toBe("Find a mentor");
  });

  it("is an h3 by default", () => {
    expect(renderToStaticMarkup(<EmptyState title="Nothing waiting" />)).toContain("<h3");
  });
});

describe("TabFile", () => {
  const tabs: FileTab[] = [
    { id: "principles", label: "Principles", href: "/style-guide", tone: "community" },
    { id: "components", label: "Components", href: "/style-guide/components", tone: "mentoring", marker: <i>m</i>, count: 2 },
  ];

  it("stands the tabs in the order given, with the active one current and the sheet in its tone", () => {
    const root = dom(renderToStaticMarkup(<TabFile tabs={tabs} active="components" label="Style guide"><p>page</p></TabFile>));
    expect([...root.querySelectorAll("[data-tab]")].map((tab) => tab.getAttribute("data-tab"))).toEqual(["principles", "components"]);
    expect(root.querySelector("[aria-current=page]")!.getAttribute("href")).toBe("/style-guide/components");
    expect(root.querySelector("[data-sheet]")!.getAttribute("data-space-tone")).toBe("mentoring");
    expect(root.querySelector("nav")!.getAttribute("aria-label")).toBe("Style guide");
  });

  it("hides markers from assistive tech and reads counts with their meaning", () => {
    const root = dom(renderToStaticMarkup(<TabFile tabs={tabs} active="principles" label="x"><p /></TabFile>));
    const components = root.querySelector('[data-tab="components"]')!;
    expect(components.querySelector("[aria-hidden=true]")!.textContent).toBe("m");
    expect(components.textContent).toContain("2 new");
  });

  it("refuses an active tab it does not hold unless told the sheet's tone", () => {
    expect(() => renderToStaticMarkup(<TabFile tabs={tabs} active="voice" label="x"><p /></TabFile>)).toThrow(/no tab "voice"/);
    const html = renderToStaticMarkup(<TabFile tabs={[]} active="voice" tone="profile" label="x"><p /></TabFile>);
    expect(html).toContain('data-space-tone="profile"');
  });

  it("refuses two tabs with one id", () => {
    expect(() => renderToStaticMarkup(<TabFile tabs={[tabs[0], tabs[0]]} active="principles" label="x"><p /></TabFile>)).toThrow(/unique/);
  });
});

describe("the kit's entry point", () => {
  it("exports every component file in the folder, so nothing is reachable only by deep import", () => {
    const index = readFileSync(join(__dirname, "index.ts"), "utf8");
    const components = readdirSync(__dirname)
      .filter((file) => /^[A-Z]\w*\.tsx$/.test(file))
      .map((file) => file.replace(/\.tsx$/, ""))
      // Field.tsx is a family of named fields rather than one default component.
      .filter((name) => name !== "Field");
    expect(components.length).toBeGreaterThan(15);
    for (const name of components) {
      expect(index, `${name}`).toMatch(new RegExp(`export \\{ default as ${name}\\b`));
      expect(kit, `${name}`).toHaveProperty(name);
    }
    for (const name of ["TextField", "TextAreaField", "SelectField", "Checkbox", "ChoiceGroup", "buttonClass", "pillClass", "FOCUS_RING", "cx"]) {
      expect(kit, `${name}`).toHaveProperty(name);
    }
  });
});
