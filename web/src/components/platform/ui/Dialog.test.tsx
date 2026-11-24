// @vitest-environment happy-dom
import { act, StrictMode, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Button from "./Button";
import Dialog, { dialogOpener } from "./Dialog";
import LiveAnnouncer, { useAnnouncer } from "./LiveAnnouncer";
import Menu, { MenuItem } from "./Menu";

let root: Root;
let container: HTMLDivElement;

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);
const dialog = () => $<HTMLDialogElement>("dialog")!;
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === name)!;

async function key(target: Element, name: string, init: KeyboardEventInit = {}) {
  let event!: KeyboardEvent;
  await act(async () => {
    event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
  });
  return event;
}

async function press(target: Element) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
}

/** The confirm step a call's host sees: a danger button opens the question, which asks again in its own words. */
const nothing = () => {};

function EndForEveryone({ onClose = nothing, onEnd = nothing }: { onClose?: () => void; onEnd?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button>Mute</Button>
      <Button variant="danger" onClick={() => setOpen(true)}>
        End for everyone
      </Button>
      <Dialog
        id="end-session"
        title="End for everyone?"
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        actions={
          <Button
            variant="danger"
            onClick={() => {
              onEnd();
              setOpen(false);
            }}
          >
            End session
          </Button>
        }
      >
        Everyone leaves at once, and the recording stops.
      </Dialog>
    </>
  );
}

async function mount(node: React.ReactNode) {
  await act(async () => root.render(node));
}

async function openEnd() {
  const trigger = button("End for everyone");
  trigger.focus();
  await press(trigger);
  return trigger;
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
  vi.useRealTimers();
});

describe("Dialog in a React island", () => {
  it("opens as a modal named by its title and described by its words", async () => {
    await mount(<EndForEveryone />);
    expect(dialog().open).toBe(false);
    await openEnd();
    expect(dialog().open).toBe(true);
    expect(dialog().getAttribute("aria-labelledby")).toBe("end-session-title");
    expect($("#end-session-title")!.textContent).toBe("End for everyone?");
    expect(dialog().getAttribute("aria-describedby")).toBe("end-session-description");
    expect($("#end-session-description")!.textContent).toBe("Everyone leaves at once, and the recording stops.");
    expect($("#end-session-title")!.tagName).toBe("H2");
  });

  it("puts focus on the way out first, not on the action", async () => {
    await mount(<EndForEveryone />);
    await openEnd();
    expect(document.activeElement).toBe(button("Cancel"));
    expect(dialog().contains(document.activeElement)).toBe(true);
  });

  it("starts on initialFocus when given", async () => {
    function WithField() {
      const field = useRef<HTMLInputElement>(null);
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Rename</Button>
          <Dialog id="rename" title="Rename the session" open={open} onClose={() => setOpen(false)} initialFocus={field}>
            <a href="#help">What makes a good name</a>
            <input ref={field} aria-label="Name" />
          </Dialog>
        </>
      );
    }
    await mount(<WithField />);
    await press(button("Rename"));
    expect(document.activeElement).toBe($("input"));
  });

  it("keeps Tab and Shift Tab inside", async () => {
    await mount(<EndForEveryone />);
    await openEnd();
    const cancel = button("Cancel");
    const end = button("End session");

    end.focus();
    const forward = await key(end, "Tab");
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);

    const back = await key(cancel, "Tab", { shiftKey: true });
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(end);

    // In the middle, Tab is the browser's to move.
    cancel.focus();
    const middle = await key(cancel, "Tab");
    expect(middle.defaultPrevented).toBe(false);
  });

  it("closes on Escape, says so once, and returns focus to the button that opened it", async () => {
    const onClose = vi.fn();
    await mount(<EndForEveryone onClose={onClose} />);
    const trigger = await openEnd();
    const escape = await key(document.activeElement!, "Escape");
    expect(escape.defaultPrevented).toBe(true);
    expect(dialog().open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it("leaves Escape to a menu open inside it, and stays open", async () => {
    function WithMenu() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog id="person" title="Kevin Omondi" open={open} onClose={() => setOpen(false)}>
          <Menu label="More for Kevin Omondi">
            <MenuItem>Stop their screen share</MenuItem>
          </Menu>
        </Dialog>
      );
    }
    await mount(<WithMenu />);
    await press(button("More for Kevin Omondi"));
    const item = $("[role=menuitem]")!;
    await key(item, "Escape");
    expect(dialog().open).toBe(true);
    // The menu took its Escape; the next one is the dialog's.
    await key(document.activeElement!, "Escape");
    expect(dialog().open).toBe(false);
  });

  it("closes from the way out, and from a press on the backdrop", async () => {
    const onClose = vi.fn();
    await mount(<EndForEveryone onClose={onClose} />);
    const trigger = await openEnd();
    await press(button("Cancel"));
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe(trigger);

    await openEnd();
    await press(dialog());
    expect(dialog().open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("returns focus when the caller closes it after the action, without calling onClose", async () => {
    const onClose = vi.fn();
    const onEnd = vi.fn();
    await mount(<EndForEveryone onClose={onClose} onEnd={onEnd} />);
    const trigger = await openEnd();
    await press(button("End session"));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(dialog().open).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("sends focus to returnFocus when the opener will be gone", async () => {
    function FromAMenu() {
      const more = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(false);
      return (
        <>
          <Menu label="More" triggerRef={more}>
            <MenuItem onSelect={() => setOpen(true)}>Stop recording…</MenuItem>
          </Menu>
          <Dialog id="stop" title="Stop recording?" open={open} onClose={() => setOpen(false)} returnFocus={more} />
        </>
      );
    }
    await mount(<FromAMenu />);
    await press(button("More"));
    await press($("[role=menuitem]")!);
    expect(dialog().open).toBe(true);
    await key(document.activeElement!, "Escape");
    expect(document.activeElement).toBe(button("More"));
  });

  it("returns focus when it is taken away while open", async () => {
    function Removable() {
      const [shown, setShown] = useState(true);
      return (
        <>
          <Button onClick={() => setShown(false)}>Hide</Button>
          {shown && <Dialog id="gone" title="Leaving?" open onClose={() => {}} />}
        </>
      );
    }
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    await mount(<Removable />);
    expect(dialog().open).toBe(true);
    await act(async () => button("Hide").click());
    expect($("dialog")).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("carries the page's announcements while open, and only those said after it opened", async () => {
    vi.useFakeTimers();
    function Room() {
      const voice = useAnnouncer();
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => voice?.say("Recording started", { priority: "assertive" })}>Record</Button>
          <Button onClick={() => setOpen(true)}>End for everyone</Button>
          <Dialog id="end" title="End for everyone?" open={open} onClose={() => setOpen(false)}>
            <Button onClick={() => voice?.say("1 minute left", { priority: "assertive" })}>Warn</Button>
          </Dialog>
        </>
      );
    }
    await mount(
      <LiveAnnouncer>
        <Room />
      </LiveAnnouncer>,
    );
    await press(button("Record"));
    await press(button("End for everyone"));
    const inside = () => dialog().querySelector('[data-live-announcer="dialog"] [role=alert]')!;
    expect(inside().textContent).toBe("");
    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    await press(button("Warn"));
    expect(inside().textContent).toBe("1 minute left");
  });
});

describe("Dialog, edge cases", () => {
  it("returns focus on close under StrictMode, whose rehearsal unmount moves nothing", async () => {
    const onClose = vi.fn();
    await mount(
      <StrictMode>
        <EndForEveryone onClose={onClose} />
      </StrictMode>,
    );
    const trigger = await openEnd();
    expect(document.activeElement).toBe(button("Cancel"));
    await key(document.activeElement!, "Escape");
    expect(dialog().open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps focus inside when it mounts open under StrictMode, and gives it back on close", async () => {
    const outside = document.createElement("button");
    outside.textContent = "Leave";
    document.body.appendChild(outside);
    outside.focus();
    function OpenAtOnce() {
      const [open, setOpen] = useState(true);
      return <Dialog id="at-once" title="Stop recording?" open={open} onClose={() => setOpen(false)} />;
    }
    await mount(
      <StrictMode>
        <OpenAtOnce />
      </StrictMode>,
    );
    expect(dialog().open).toBe(true);
    expect(document.activeElement).toBe(button("Cancel"));
    await key(document.activeElement!, "Escape");
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("ignores a close event that arrives after it was opened again", async () => {
    const onClose = vi.fn();
    let setOpen!: (open: boolean) => void;
    function Flicker() {
      const [open, set] = useState(true);
      setOpen = set;
      return <Dialog id="flicker" title="Stop recording?" open={open} onClose={onClose} />;
    }
    await mount(<Flicker />);
    await act(async () => setOpen(false));
    await act(async () => setOpen(true));
    expect(dialog().open).toBe(true);
    // A browser fires close after the fact: here it lands once the dialog is open again.
    await act(async () => {
      dialog().dispatchEvent(new Event("close"));
    });
    expect(dialog().open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not call onClose when the caller closed it", async () => {
    const onClose = vi.fn();
    let setOpen!: (open: boolean) => void;
    function Closed() {
      const [open, set] = useState(true);
      setOpen = set;
      return <Dialog id="closed" title="Stop recording?" open={open} onClose={onClose} />;
    }
    await mount(<Closed />);
    await act(async () => setOpen(false));
    expect(dialog().open).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves an Escape that ends an input method's composition alone", async () => {
    await mount(<EndForEveryone />);
    await openEnd();
    const escape = await key(document.activeElement!, "Escape", { isComposing: true });
    expect(escape.defaultPrevented).toBe(false);
    expect(dialog().open).toBe(true);
  });
});

describe("Dialog on a static page", () => {
  const markup = renderToStaticMarkup(
    <>
      <Button variant="danger" {...dialogOpener("stop-recording")}>
        Stop recording
      </Button>
      <Dialog
        id="stop-recording"
        title="Stop recording?"
        actions={
          <form method="post">
            <Button variant="danger" type="submit">
              Stop recording
            </Button>
          </form>
        }
      >
        The rest of the call isn&apos;t recorded.
      </Dialog>
    </>,
  );

  it("is opened by the browser's own command, with no script", () => {
    expect(markup).toContain('commandfor="stop-recording"');
    expect(markup).toContain('command="show-modal"');
    expect(markup).toMatch(/<dialog[^>]* id="stop-recording"/);
    expect(markup).not.toMatch(/<dialog[^>]* open/);
  });

  it("closes through a method=dialog form, which the browser handles", () => {
    expect(markup).toMatch(/<form method="dialog"[^>]*><button type="submit"[^>]*>Cancel<\/button><\/form>/);
  });

  it("takes no focus on load and draws no live regions while closed", () => {
    expect(markup).not.toContain("autofocus");
    expect(markup).not.toContain("data-live-announcer");
  });

  it("leaves aria-describedby off when it has no words to describe", () => {
    expect(renderToStaticMarkup(<Dialog id="bare" title="Leave the call?" />)).not.toContain("aria-describedby");
  });
});
