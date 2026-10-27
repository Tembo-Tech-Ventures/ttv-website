import { navHeight } from "./scenes";

/**
 * Keeps in-page navigation honest while the sheets are stacked.
 *
 * A stuck sheet is drawn far from where it sits in the document (a tall sheet
 * sticks at a large negative offset), and browsers scroll anchors and focused
 * elements to where they are *drawn*. Jumping back up then lands under a later
 * sheet. Here every anchor click, hash change, initial hash and focus move is
 * routed through the element's position in the flow instead:
 *
 * - layout is read once with stacking switched off (`hd-flow`), synchronously,
 *   so nothing is ever painted that way;
 * - an item in a sticky card stack is brought to its own sticky slot, so the
 *   next card is not yet over it;
 * - the scroll never goes past the point where the element's sheet starts to
 *   stick, so the next sheet is never over it either.
 */
const GAP = 24;
const STACK_ITEM = ".hd-bstack--file > li, [data-hd-values] > li";

interface FlowBox {
  top: number;
  height: number;
}

export function initNavigation(root: HTMLElement, lead: () => number, motionAllowed: () => boolean): () => void {
  const sheets = [...root.querySelectorAll<HTMLElement>("[data-hd-sheet]")];
  // Set while we move focus ourselves, so our own focus does not re-route.
  let routing = false;

  /** Document positions with every sticky layer and recede transform switched off. */
  function readFlow(elements: Element[]): FlowBox[] {
    root.classList.add("hd-flow");
    const boxes = elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top + window.scrollY, height: box.height };
    });
    root.classList.remove("hd-flow");
    return boxes;
  }

  /** Where to scroll so `target` is fully readable, uncovered and below the nav. */
  function scrollTopFor(target: HTMLElement): number {
    const nav = navHeight();
    const vh = window.innerHeight;
    const sheet = target.closest<HTMLElement>("[data-hd-sheet]");
    const item = target.closest<HTMLElement>(STACK_ITEM);
    const [targetBox, sheetBox, itemBox] = readFlow([target, sheet ?? target, item ?? target]);
    let top = targetBox.top - nav - GAP;
    if (item && getComputedStyle(item).position === "sticky") {
      // Park the stack item in its own sticky slot: the next item is still below it.
      top = itemBox.top - (Number.parseFloat(getComputedStyle(item).top) || nav);
    }
    const index = sheet ? sheets.indexOf(sheet) : -1;
    if (sheet && index >= 0 && index < sheets.length - 1 && root.classList.contains("hd-stacked")) {
      // Past this point the sheet sticks and the next one starts to cover it.
      const stick = Math.min(nav, vh - lead() - sheetBox.height);
      top = Math.min(top, sheetBox.top - stick);
    }
    return Math.max(0, Math.round(top));
  }

  function bringIntoView(target: HTMLElement, smooth: boolean) {
    window.scrollTo({ top: scrollTopFor(target), behavior: smooth && motionAllowed() ? "smooth" : "instant" });
  }

  function targetFor(hash: string): HTMLElement | null {
    if (!hash || hash === "#") return null;
    const id = decodeURIComponent(hash.slice(1));
    const element = document.getElementById(id);
    return element && root.contains(element) ? element : null;
  }

  /** The "Meet the builders" link can go straight to the cohort picked in the hero deck. */
  function resolve(link: HTMLAnchorElement, target: HTMLElement): HTMLElement {
    const cohort = root.dataset.hdCohort;
    if (!cohort || !link.hasAttribute("data-hd-cohort-jump")) return target;
    const cards = [...root.querySelectorAll<HTMLElement>(`[data-hd-cohort="${cohort}"]`)];
    return cards.find((card) => card.offsetHeight > 0) ?? target;
  }

  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href^="#"]');
    if (!link) return;
    const target = targetFor(link.getAttribute("href") ?? "");
    if (!target) return;
    event.preventDefault();
    const destination = resolve(link, target);
    if (window.location.hash !== link.hash) history.pushState(null, "", link.hash);
    bringIntoView(destination, true);
    routing = true;
    focusWithoutScroll(destination);
    routing = false;
  };

  const onHashChange = () => {
    const target = targetFor(window.location.hash);
    if (target) bringIntoView(target, false);
  };

  const onFocusIn = (event: FocusEvent) => {
    const element = event.target as HTMLElement | null;
    if (routing || !element || element === root || !root.contains(element)) return;
    // Let the browser's own focus scroll finish, then check what is drawn.
    requestAnimationFrame(() => {
      if (document.activeElement === element && obscured(element)) bringIntoView(element, false);
    });
  };

  document.addEventListener("click", onClick);
  window.addEventListener("hashchange", onHashChange);
  root.addEventListener("focusin", onFocusIn);
  const initial = targetFor(window.location.hash);
  if (initial) requestAnimationFrame(() => bringIntoView(initial, false));

  return () => {
    document.removeEventListener("click", onClick);
    window.removeEventListener("hashchange", onHashChange);
    root.removeEventListener("focusin", onFocusIn);
  };
}

/** Covered by something else, cut off by the nav, or off screen. */
function obscured(element: HTMLElement): boolean {
  const box = element.getBoundingClientRect();
  const nav = navHeight();
  if (box.height === 0 || box.top < nav) return true;
  if (box.bottom > window.innerHeight && box.height < window.innerHeight - nav) return true;
  const x = Math.min(Math.max(box.left + box.width / 2, 0), window.innerWidth - 1);
  const y = box.top + Math.min(box.height / 2, 20);
  const hit = document.elementFromPoint(x, y);
  return !hit || !(element.contains(hit) || hit.contains(element));
}

function focusWithoutScroll(target: HTMLElement) {
  if (!target.matches("a[href], button, [tabindex]")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}
