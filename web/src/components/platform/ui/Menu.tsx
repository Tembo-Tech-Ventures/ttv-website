import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import Button from "./Button";
import { cx } from "./cx";
import IconButton from "./IconButton";
import { FOCUS_RING } from "./recipes";
import { RAISED } from "./tones";

/*
 * A menu of actions behind one button: a message's "more", a composer's
 * "attach". The ARIA menu-button pattern, with nothing but CSS to place it: the
 * list opens under its button (or above, from a composer at the foot of the
 * screen), and turns over to the other side when the box it scrolls in has no
 * room. No portal and no floating library, so it is a few hundred bytes, not
 * tens of kilobytes.
 */

/**
 * One choice in a list: a menu item, or an option in a picker such as the
 * clip finder. Disabled choices stay readable, in the muted ink.
 */
export const MENU_ITEM = cx(
  "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-primary pointer-coarse:min-h-11",
  "transition-colors duration-150 motion-reduce:transition-none hover:bg-ink-primary/7 focus:bg-ink-primary/10",
  "aria-disabled:cursor-default aria-disabled:text-ink-muted aria-disabled:hover:bg-transparent",
  "disabled:cursor-default disabled:text-ink-muted disabled:hover:bg-transparent",
  FOCUS_RING,
);

type Side = "bottom" | "top";

type MenuContextValue = {
  /** Close the menu, give focus back to its button, then do what was chosen. */
  choose: (action?: () => void) => void;
};

const MenuContext = createContext<MenuContextValue>({ choose: (action) => action?.() });

type MenuProps = {
  /** The button's words, or with `iconOnly`, its whole accessible name. */
  label: string;
  icon?: ReactNode;
  /** A button with no room for words: an icon, named by `label`. */
  iconOnly?: boolean;
  variant?: "quiet" | "ghost";
  size?: "sm" | "md";
  /** Where the list opens: under the button, or above it. It turns over when there is no room. */
  placement?: Side;
  /** The edge of the button the list lines up with. */
  align?: "start" | "end";
  /** The button's id, which names the list. Generated when not given. */
  id?: string;
  /** The button, for a caller that returns focus to it later. */
  triggerRef?: MutableRefObject<HTMLButtonElement | null>;
  /** Classes for the button. */
  triggerClassName?: string;
  /** Classes for the wrapper, which the list is placed against. */
  className?: string;
  /** `MenuItem`s, in `MenuSection`s with a heading where the list has parts. */
  children: ReactNode;
};

/** How the list takes focus as it opens: the first or last item by keyboard, the list itself by pointer. */
type Opening = "first" | "last" | "list";

/** The enabled items, in order. */
function items(list: HTMLElement | null): HTMLElement[] {
  if (!list) return [];
  return [...list.querySelectorAll<HTMLElement>("[role^='menuitem']")].filter((item) => item.getAttribute("aria-disabled") !== "true");
}

/** The box that would clip the list: the nearest ancestor that scrolls or hides, within the window. */
function clipBox(element: HTMLElement): { top: number; bottom: number } {
  let node = element.parentElement;
  while (node && !/auto|scroll|hidden|clip/.test(getComputedStyle(node).overflowY)) node = node.parentElement;
  const box = node?.getBoundingClientRect();
  return { top: Math.max(box?.top ?? 0, 0), bottom: Math.min(box?.bottom ?? window.innerHeight, window.innerHeight) };
}

/** The side with room for the list: the one asked for, unless the other has more room and it needs it. */
function sideFor(root: HTMLElement, list: HTMLElement, wanted: Side): Side {
  const clip = clipBox(root);
  const button = root.getBoundingClientRect();
  const room = { bottom: clip.bottom - button.bottom, top: button.top - clip.top };
  const other: Side = wanted === "bottom" ? "top" : "bottom";
  return room[wanted] >= list.offsetHeight + 8 || room[wanted] >= room[other] ? wanted : other;
}

/**
 * A button that opens a list of actions. Arrow keys, Home and End move
 * through the items, Enter or Space chooses one, Escape closes and returns to
 * the button, and Tab or a press outside closes it. Opened by keyboard, the
 * first item takes focus.
 */
export default function Menu({
  label,
  icon,
  iconOnly = false,
  variant = "ghost",
  size = "sm",
  placement = "bottom",
  align = "start",
  id,
  triggerRef,
  triggerClassName,
  className,
  children,
}: MenuProps) {
  const generated = useId();
  const buttonId = id ?? `${generated}-menu-button`;
  const listId = `${buttonId}-list`;
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<Side>(placement);
  const opening = useRef<Opening>("list");

  // The button is the wrapper's first child: Button and IconButton take no ref.
  const trigger = useCallback(() => {
    const first = root.current?.firstElementChild;
    return first instanceof HTMLButtonElement ? first : null;
  }, []);

  // The caller's handle on the button, kept to the one that is on the page.
  useLayoutEffect(() => {
    if (!triggerRef) return;
    triggerRef.current = trigger();
    return () => {
      triggerRef.current = null;
    };
  }, [triggerRef, trigger]);

  const close = useCallback((focusButton: boolean) => {
    setOpen(false);
    if (focusButton) trigger()?.focus();
  }, [trigger]);

  function show(how: Opening) {
    opening.current = how;
    setSide(placement);
    setOpen(true);
  }

  // Placed before it paints: under or over the button, wherever it has room.
  useLayoutEffect(() => {
    if (!open || !root.current || !list.current) return;
    setSide(sideFor(root.current, list.current, placement));
  }, [open, placement]);

  // Then focus goes in, as the opening asked.
  useEffect(() => {
    if (!open) return;
    const all = items(list.current);
    const target = opening.current === "first" ? all[0] : opening.current === "last" ? all.at(-1) : undefined;
    (target ?? list.current)?.focus();
  }, [open]);

  // A press anywhere else closes it, and leaves focus where the press put it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, close]);

  const context = useMemo<MenuContextValue>(() => ({
    choose: (action) => {
      close(true);
      action?.();
    },
  }), [close]);

  function onTriggerClick(event: MouseEvent<HTMLButtonElement>) {
    if (open) {
      close(false);
      return;
    }
    // A click with no pointer (`detail` 0) came from Enter or Space: start at the first item.
    show(event.detail === 0 ? "first" : "list");
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    show(event.key === "ArrowDown" ? "first" : "last");
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const all = items(list.current);
    const at = all.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => all[(index + all.length) % all.length]?.focus();
    switch (event.key) {
      case "ArrowDown":
        move(at + 1);
        break;
      case "ArrowUp":
        move(at < 0 ? -1 : at - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(-1);
        break;
      case "Escape":
        close(true);
        break;
      case "Tab":
        // Back to the button, then on with the Tab: the list's items are not stops of their own.
        close(true);
        return;
      default:
        return;
    }
    event.preventDefault();
  }

  const shared = {
    id: buttonId,
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    "aria-controls": open ? listId : undefined,
    onClick: onTriggerClick,
    onKeyDown: onTriggerKeyDown,
  };

  return (
    <div ref={root} className={cx("relative inline-flex", className)} data-menu={open ? "open" : "closed"}>
      {iconOnly ? (
        <IconButton {...shared} label={label} icon={icon} variant={variant} size={size} className={triggerClassName} />
      ) : (
        <Button {...shared} variant={variant} size={size} icon={icon} className={triggerClassName}>
          {label}
        </Button>
      )}
      {open && (
        // An opaque surface, the sheet's own colour, so the list reads over whatever it covers.
        <div
          className={cx(
            "absolute z-60 w-max min-w-52 max-w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-hairline bg-(--sheet)",
            side === "bottom" ? "top-full mt-1" : "bottom-full mb-1.5",
            align === "end" ? "right-0" : "left-0",
          )}
          data-side={side}
        >
          <div
            ref={list}
            id={listId}
            role="menu"
            aria-labelledby={buttonId}
            tabIndex={-1}
            onKeyDown={onListKeyDown}
            className={cx("flex flex-col p-1.5 outline-none", RAISED)}
          >
            <MenuContext.Provider value={context}>{children}</MenuContext.Provider>
          </div>
        </div>
      )}
    </div>
  );
}

type MenuItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "role" | "onSelect" | "onClick" | "className" | "disabled"> & {
  children: ReactNode;
  /** What choosing it does. The menu has closed and its button has focus by then. */
  onSelect?: () => void;
  /** Shown and read, but not chosen: "Reported", or a project already attached. */
  disabled?: boolean;
  /** A leading icon, hidden from assistive tech. */
  icon?: ReactNode;
  tone?: "default" | "danger";
  className?: string;
};

/** One action in a `Menu`. */
export function MenuItem({ children, onSelect, disabled = false, icon, tone = "default", className, ...rest }: MenuItemProps) {
  const { choose } = useContext(MenuContext);
  return (
    <button
      {...rest}
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) choose(onSelect);
      }}
      className={cx(MENU_ITEM, tone === "danger" && "text-danger-ink", className)}
    >
      {icon && (
        <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0 text-ink-muted">
          {icon}
        </span>
      )}
      <span className="min-w-0">{children}</span>
    </button>
  );
}

/** A named part of a `Menu`: a group its heading labels, as in "React" over the reactions. */
export function MenuSection({ heading, children }: { heading?: ReactNode; children: ReactNode }) {
  const headingId = useId();
  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a group of menu items: a fieldset would put a form's parts inside a menu
    <div role="group" aria-labelledby={heading ? headingId : undefined} className="flex flex-col">
      {heading && (
        <div id={headingId} role="presentation" className="px-3 pt-1.5 pb-1 text-xs font-semibold text-ink-muted">
          {heading}
        </div>
      )}
      {children}
    </div>
  );
}

/** A hairline between parts of a `Menu`. */
export function MenuSeparator() {
  return <hr className="mx-2 my-1 h-px border-0 bg-hairline" />;
}
