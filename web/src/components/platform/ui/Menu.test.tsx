// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Menu, { MenuItem, MenuSection, MenuSeparator } from "./Menu";

let root: Root;
let container: HTMLDivElement;

const Icon = () => <svg data-icon="true" />;
const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const $$ = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const trigger = () => $<HTMLButtonElement>("button[aria-haspopup=menu]")!;
const items = () => $$("[role=menuitem]");

async function key(target: Element, name: string) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  });
}

/** A press: a pointer's click says how many clicks it was (`detail`); one from Enter or Space says 0. */
async function press(target: Element, detail = 1) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail }));
  });
}

const nothing = () => {};

function Actions({ onEdit = nothing, onReport = nothing }: { onEdit?: () => void; onReport?: () => void }) {
  return (
    <Menu label="Actions for Mercy's message" icon={<Icon />} iconOnly align="end">
      <MenuItem onSelect={onEdit}>Edit</MenuItem>
      <MenuSeparator />
      <MenuSection heading="React">
        <MenuItem>Useful</MenuItem>
        <MenuItem disabled>Reported</MenuItem>
        <MenuItem onSelect={onReport}>Report…</MenuItem>
      </MenuSection>
    </Menu>
  );
}

async function mount(node: React.ReactNode) {
  await act(async () => root.render(node));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Menu", () => {
  it("renders only its button until opened, named and marked as opening a menu", () => {
    const html = renderToStaticMarkup(<Actions />);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Actions for Mercy&#x27;s message"');
    expect(html).not.toContain("aria-controls");
    expect(html).not.toContain('role="menu"');
  });

  it("is a kit button: an IconButton without words, a Button with them, 44px on touch", () => {
    const icon = renderToStaticMarkup(<Actions />);
    expect(icon).toContain('data-variant="ghost"');
    expect(icon).toContain("pointer-coarse:min-w-11");
    expect(icon).toContain("pointer-coarse:min-h-11");
    const words = renderToStaticMarkup(
      <Menu label="Share project" icon={<Icon />}>
        <MenuItem>Chama ledger</MenuItem>
      </Menu>,
    );
    expect(words).toMatch(/<button[^>]*data-size="sm"[^>]*>.*Share project<\/button>/);
    expect(words).toContain("pointer-coarse:min-h-11");
  });

  it("opens by keyboard at the first item, labelled by its button, and moves with the arrows, Home and End", async () => {
    await mount(<Actions />);
    await key(trigger(), "ArrowDown");
    const menu = $("[role=menu]")!;
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-controls")).toBe(menu.id);
    expect(menu.getAttribute("aria-labelledby")).toBe(trigger().id);
    expect(document.activeElement).toBe(items()[0]);

    await key(document.activeElement!, "ArrowDown");
    expect(document.activeElement?.textContent).toBe("Useful");
    // A disabled item is read, but the arrows pass over it.
    await key(document.activeElement!, "ArrowDown");
    expect(document.activeElement?.textContent).toBe("Report…");
    await key(document.activeElement!, "ArrowDown");
    expect(document.activeElement?.textContent).toBe("Edit");
    await key(document.activeElement!, "ArrowUp");
    expect(document.activeElement?.textContent).toBe("Report…");
    await key(document.activeElement!, "Home");
    expect(document.activeElement?.textContent).toBe("Edit");
    await key(document.activeElement!, "End");
    expect(document.activeElement?.textContent).toBe("Report…");
  });

  it("opens at the last item with ArrowUp, and at the first from Enter or Space", async () => {
    await mount(<Actions />);
    await key(trigger(), "ArrowUp");
    expect(document.activeElement?.textContent).toBe("Report…");
    await key(document.activeElement!, "Escape");
    await press(trigger(), 0);
    expect(document.activeElement?.textContent).toBe("Edit");
  });

  it("opened by a pointer, focuses the list itself, from where the arrows start", async () => {
    await mount(<Actions />);
    await press(trigger());
    expect(document.activeElement).toBe($("[role=menu]"));
    await key(document.activeElement!, "ArrowDown");
    expect(document.activeElement?.textContent).toBe("Edit");
  });

  it("closes on Escape and gives focus back to its button", async () => {
    await mount(<Actions />);
    await key(trigger(), "ArrowDown");
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => {
      document.activeElement!.dispatchEvent(escape);
    });
    // Handled here, so a thread or a dialog around it does not close too.
    expect(escape.defaultPrevented).toBe(true);
    expect($("[role=menu]")).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger());
  });

  it("does what was chosen once it has closed, with focus back on its button", async () => {
    let focusedOnSelect: Element | null = null;
    const onReport = vi.fn(() => {
      focusedOnSelect = document.activeElement;
    });
    await mount(<Actions onReport={onReport} />);
    await press(trigger());
    await press(items().find((item) => item.textContent === "Report…")!);
    expect(onReport).toHaveBeenCalledOnce();
    expect(focusedOnSelect).toBe(trigger());
    expect($("[role=menu]")).toBeNull();
  });

  it("does nothing for a disabled item, and says it is disabled", async () => {
    await mount(<Actions />);
    await press(trigger());
    const reported = items().find((item) => item.textContent === "Reported")!;
    expect(reported.getAttribute("aria-disabled")).toBe("true");
    await press(reported);
    expect($("[role=menu]")).not.toBeNull();
  });

  it("closes on Tab, and on a press anywhere else", async () => {
    await mount(
      <>
        <Actions />
        <button type="button">Elsewhere</button>
      </>,
    );
    await key(trigger(), "ArrowDown");
    await key(document.activeElement!, "Tab");
    expect($("[role=menu]")).toBeNull();
    // Back on the button, so the Tab carries on from there.
    expect(document.activeElement).toBe(trigger());

    await press(trigger());
    await act(async () => {
      $$("button").find((button) => button.textContent === "Elsewhere")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect($("[role=menu]")).toBeNull();
  });

  it("toggles closed from its own button", async () => {
    await mount(<Actions />);
    await press(trigger());
    await press(trigger());
    expect($("[role=menu]")).toBeNull();
  });

  it("names each part by its heading, and keeps items out of the tab order", async () => {
    await mount(<Actions />);
    await press(trigger());
    const group = $("[role=group][aria-labelledby]")!;
    expect($(`#${CSS.escape(group.getAttribute("aria-labelledby")!)}`)?.textContent).toBe("React");
    expect(items().every((item) => item.tabIndex === -1)).toBe(true);
    expect($("[role=menu] hr")).not.toBeNull();
  });

  it("hands its button to a caller that returns focus to it later", async () => {
    let seen: HTMLButtonElement | null = null;
    function Caller() {
      const ref = useRef<HTMLButtonElement | null>(null);
      return (
        <>
          <Menu label="More" icon={<Icon />} iconOnly triggerRef={ref}>
            <MenuItem onSelect={() => (seen = ref.current)}>Edit</MenuItem>
          </Menu>
        </>
      );
    }
    await mount(<Caller />);
    await press(trigger());
    await press(items()[0]);
    expect(seen).toBe(trigger());
  });

  describe("where it opens", () => {
    // A button near the foot of the window, and a list taller than the room under it.
    beforeEach(() => {
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ top: 700, bottom: 732, left: 0, right: 40, width: 40, height: 32, x: 0, y: 700, toJSON: () => ({}) });
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(200);
      vi.stubGlobal("innerHeight", 768);
    });
    afterEach(() => vi.restoreAllMocks());

    it("opens above its button when asked, as from a composer at the foot of the screen", async () => {
      await mount(
        <Menu label="Attach work" icon={<Icon />} iconOnly placement="top">
          <MenuItem>Find a moment…</MenuItem>
        </Menu>,
      );
      await press(trigger());
      expect($("[data-side]")?.dataset.side).toBe("top");
      expect($("[data-side]")?.className).toContain("bottom-full");
    });

    it("turns over to the side with room when there is none under its button", async () => {
      await mount(<Actions />);
      await press(trigger());
      expect($("[data-side]")?.dataset.side).toBe("top");
      expect($("[data-side]")?.className).toContain("right-0");
    });
  });
});
